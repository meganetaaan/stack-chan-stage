import {
  deepFreeze,
  asCueExecutionId,
  issue,
  ownRecordValue,
  type ValidationIssue,
} from "../shared";
import { createAudioFingerprint } from "../assets/fingerprint";
import { DEFAULT_AUDIO_FORMAT, type ResolvedSceneCast } from "../casting/types";
import { resolveSceneCast } from "../casting/resolve-cast";
import { validateCueForActor } from "../casting/validate-capabilities";
import type { Cue, VoiceProfileRef } from "../scenario/types";
import { validateScenario } from "../scenario/validation";
import type {
  CompileRunInput,
  CompileRunResult,
  PlannedCue,
  PlannedSpeech,
  RunPlan,
} from "./types";

export const timeoutForCue = (cue: Cue): number => {
  switch (cue.kind) {
    case "speech":
      return Math.max(
        30_000,
        Math.min(180_000, cue.text.length * 650 + 10_000),
      );
    case "motion":
      return cue.motion.kind === "pose"
        ? Math.max(10_000, cue.motion.durationMs + 5_000)
        : 30_000;
    case "lighting.play":
      return 60_000;
    case "backdrop.set":
      return cue.transition.kind === "cut"
        ? 5_000
        : cue.transition.durationMs + 5_000;
    case "music.start":
      return cue.fadeInMs + 10_000;
    case "music.stop":
      return cue.fadeOutMs + 10_000;
    case "pause":
      return cue.durationMs + 2_000;
    default:
      return 10_000;
  }
};

const voiceForCue = (
  cue: Extract<Cue, { kind: "speech" }>,
  input: CompileRunInput,
): VoiceProfileRef | undefined =>
  cue.voiceOverride ??
  input.scenario.roles.find((role) => role.id === cue.roleId)?.voice;

export const compileRun = (input: CompileRunInput): CompileRunResult => {
  const issues: ValidationIssue[] = [...validateScenario(input.scenario)];
  const selected = new Set(input.sceneIds);
  const duplicateSelections = input.sceneIds.filter(
    (id, index) => input.sceneIds.indexOf(id) !== index,
  );
  duplicateSelections.forEach((id) =>
    issues.push(
      issue("run.duplicate_scene", `Scene ${id} が重複選択されています`, [
        "sceneIds",
      ]),
    ),
  );

  const scenes = input.scenario.scenes.filter((scene) =>
    selected.has(scene.id),
  );
  for (const id of input.sceneIds) {
    if (!input.scenario.scenes.some((scene) => scene.id === id)) {
      issues.push(
        issue("run.scene_not_found", `Scene ${id} が存在しません`, [
          "sceneIds",
        ]),
      );
    }
  }
  if (scenes.length === 0)
    issues.push(
      issue("run.no_scenes", "上演するSceneを1件以上選択してください", [
        "sceneIds",
      ]),
    );

  const actorById = new Map(input.actors.map((actor) => [actor.id, actor]));
  const casts: ResolvedSceneCast[] = [];
  for (const scene of scenes) {
    const result = resolveSceneCast(
      scene,
      input.scenario.roles,
      input.castPlan,
    );
    if (result.ok) casts.push(result.cast);
    else issues.push(...result.issues);
  }

  const runId = input.runId;
  const planned: PlannedCue[] = [];
  const speech: PlannedSpeech[] = [];

  scenes.forEach((scene) => {
    const cast = casts.find((entry) => entry.sceneId === scene.id);
    const lane = scene.lanes[0];
    if (!lane || !cast) return;
    lane.cues.forEach((cue, cueIndex) => {
      const executionId = asCueExecutionId(
        `${runId}:${scene.id}:${cue.id}:${cueIndex}`,
      );
      const roleId = "roleId" in cue ? cue.roleId : undefined;
      const actorId = roleId
        ? ownRecordValue(cast.assignments, roleId)
        : undefined;
      const actor = actorId ? actorById.get(actorId) : undefined;

      if (roleId && !actorId) {
        issues.push(
          issue(
            "cast.unresolved_cue_role",
            `Cue ${cue.id} のRole ${roleId} が未配役です`,
            ["scenes", scene.id, "cues", cue.id],
          ),
        );
      } else if (actorId && !actor) {
        issues.push(
          issue(
            "actor.not_found",
            `Actor ${actorId} がregistryに存在しません`,
            ["actors", actorId],
          ),
        );
      } else if (actor && actor.availability !== "online") {
        issues.push(
          issue(
            "actor.offline",
            `Actor「${actor?.name ?? actorId}」はofflineです`,
            ["actors", actorId ?? "unknown"],
          ),
        );
      } else if (actor) {
        issues.push(...validateCueForActor(cue, actor));
      }

      let plannedSpeech: PlannedSpeech | undefined;
      if (cue.kind === "speech") {
        const voice = voiceForCue(cue, input);
        if (!voice) {
          issues.push(
            issue(
              "speech.voice_missing",
              `Speech Cue ${cue.id} にVoice設定がありません`,
              ["scenes", scene.id, "cues", cue.id],
            ),
          );
        } else {
          const fingerprint = createAudioFingerprint({
            text: cue.text,
            ...(cue.direction === undefined
              ? {}
              : { direction: cue.direction }),
            voice,
            ...(voice.model === undefined ? {} : { model: voice.model }),
            format: DEFAULT_AUDIO_FORMAT,
          });
          plannedSpeech = {
            cueId: cue.id,
            executionId,
            fingerprint,
            text: cue.text,
            ...(cue.direction === undefined
              ? {}
              : { direction: cue.direction }),
            voice,
            estimatedBytes: Math.max(2_400, cue.text.length * 1_200),
          };
          speech.push(plannedSpeech);
        }
      }

      planned.push({
        sceneId: scene.id,
        laneId: lane.id,
        cueIndex,
        cue,
        executionId,
        ...(actorId === undefined ? {} : { actorId }),
        timeoutMs: timeoutForCue(cue),
        ...(plannedSpeech === undefined ? {} : { speech: plannedSpeech }),
      });
    });
  });

  if (issues.some((entry) => entry.severity === "error"))
    return { ok: false, issues };

  const plan: RunPlan = {
    id: runId,
    scenario: input.scenario,
    sceneIds: scenes.map((scene) => scene.id),
    casts,
    actors: input.actors,
    assets: input.assets ?? input.scenario.assets,
    cues: planned,
    speech,
  };
  return { ok: true, plan: deepFreeze(plan) as RunPlan };
};
