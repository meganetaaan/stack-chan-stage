import { describe, expect, it } from "vitest";

import {
  asCueExecutionId,
  asCueId,
  asLaneId,
  asRoleId,
  asRunId,
  asScenarioId,
  asSceneId,
  type RunPlan,
} from "@stackchan-stage/domain";
import { applyPreviewSpeechMode } from "./preview-speech-mode";

const sceneId = asSceneId("scene-1");
const laneId = asLaneId("lane-1");
const roleId = asRoleId("narrator");
const speechCueId = asCueId("cue-speech");

const plan = (): RunPlan => {
  const speech = {
    cueId: speechCueId,
    executionId: asCueExecutionId("run-1:scene-1:cue-speech:0"),
    fingerprint: "speech-fingerprint",
    text: "こんにちは",
    voice: { provider: "browser", voiceId: "default", locale: "ja-JP" },
    estimatedBytes: 4_800,
  };
  return {
    id: asRunId("run-1"),
    scenario: {
      schemaVersion: 1,
      id: asScenarioId("scenario-1"),
      title: "テスト演目",
      roles: [{ id: roleId, name: "語り手", voice: speech.voice }],
      scenes: [
        {
          id: sceneId,
          title: "第一場",
          lanes: [
            {
              id: laneId,
              name: "本線",
              cues: [
                {
                  id: speechCueId,
                  kind: "speech",
                  roleId,
                  text: speech.text,
                },
                {
                  id: asCueId("cue-expression"),
                  kind: "expression",
                  roleId,
                  expression: "HAPPY",
                },
              ],
            },
          ],
        },
      ],
      assets: [],
    },
    sceneIds: [sceneId],
    casts: [],
    actors: [],
    assets: [],
    cues: [
      {
        sceneId,
        laneId,
        cueIndex: 0,
        cue: {
          id: speechCueId,
          kind: "speech",
          roleId,
          text: speech.text,
        },
        executionId: speech.executionId,
        timeoutMs: 30_000,
        speech,
      },
      {
        sceneId,
        laneId,
        cueIndex: 1,
        cue: {
          id: asCueId("cue-expression"),
          kind: "expression",
          roleId,
          expression: "HAPPY",
        },
        executionId: asCueExecutionId("run-1:scene-1:cue-expression:1"),
        timeoutMs: 10_000,
      },
    ],
    speech: [speech],
  };
};

describe("applyPreviewSpeechMode", () => {
  it("audibleではRunPlanを変更しない", () => {
    const original = plan();
    const result = applyPreviewSpeechMode(original, "audible");

    expect(result.plan).toBe(original);
    expect(result.warnings).toEqual([]);
    expect(result.skippedCueIds).toEqual([]);
  });

  it("skipではSpeech Cueだけを除外し、警告とCue IDを返す", () => {
    const result = applyPreviewSpeechMode(plan(), "skip");

    expect(result.plan.cues.map((entry) => entry.cue.kind)).toEqual([
      "expression",
    ]);
    expect(result.plan.speech).toEqual([]);
    expect(result.skippedCueIds).toEqual([speechCueId]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "speech.skipped",
        severity: "warning",
      }),
    ]);
  });
});
