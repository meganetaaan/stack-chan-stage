import type { Actor, ResolvedSceneCast } from "../casting/types";
import type {
  ActorId,
  CueExecutionId,
  CueId,
  LaneId,
  RoleId,
  RunId,
  SceneId,
  ValidationIssue,
} from "../shared";
import type {
  AssetMetadata,
  Cue,
  Scenario,
  VoiceProfileRef,
} from "../scenario/types";

export type PlannedSpeech = Readonly<{
  cueId: CueId;
  executionId: CueExecutionId;
  fingerprint: string;
  text: string;
  direction?: string;
  voice: VoiceProfileRef;
  estimatedBytes: number;
}>;

export type PlannedCue = Readonly<{
  sceneId: SceneId;
  laneId: LaneId;
  cueIndex: number;
  cue: Cue;
  executionId: CueExecutionId;
  actorId?: ActorId;
  timeoutMs: number;
  speech?: PlannedSpeech;
}>;

export type RunPlan = Readonly<{
  id: RunId;
  scenario: Scenario;
  sceneIds: readonly SceneId[];
  casts: readonly ResolvedSceneCast[];
  actors: readonly Actor[];
  assets: readonly AssetMetadata[];
  cues: readonly PlannedCue[];
  speech: readonly PlannedSpeech[];
}>;

export type CompileRunInput = Readonly<{
  scenario: Scenario;
  sceneIds: readonly SceneId[];
  castPlan: import("../scenario/types").CastPlan;
  actors: readonly Actor[];
  assets?: readonly AssetMetadata[];
}>;

export type CompileRunResult =
  | Readonly<{ ok: true; plan: RunPlan }>
  | Readonly<{ ok: false; issues: readonly ValidationIssue[] }>;

export type RuntimeFailure = Readonly<{
  code: string;
  message: string;
  executionId?: CueExecutionId;
}>;

type RuntimeBase = Readonly<{
  plan: RunPlan;
  preparedAudio: readonly string[];
}>;

export type RuntimeState =
  | Readonly<{ status: "idle" }>
  | (RuntimeBase & Readonly<{ status: "preparing" }>)
  | (RuntimeBase & Readonly<{ status: "ready" }>)
  | (RuntimeBase &
      Readonly<{ status: "playing"; cursor: number; active: PlannedCue }>)
  | (RuntimeBase &
      Readonly<{
        status: "buffering";
        cursor: number;
        waitingFor: PlannedSpeech;
      }>)
  | (RuntimeBase &
      Readonly<{ status: "stopping"; cursor?: number; active?: PlannedCue }>)
  | (RuntimeBase & Readonly<{ status: "completed" }>)
  | (RuntimeBase & Readonly<{ status: "failed"; failure: RuntimeFailure }>);

export type RuntimeEvent =
  | Readonly<{ type: "RUN_REQUESTED"; plan: RunPlan }>
  | Readonly<{ type: "AUDIO_READY"; fingerprint: string }>
  | Readonly<{
      type: "AUDIO_PREPARE_FAILED";
      fingerprint: string;
      message: string;
      required: boolean;
    }>
  | Readonly<{ type: "PLAY_REQUESTED" }>
  | Readonly<{ type: "CUE_STARTED"; executionId: CueExecutionId }>
  | Readonly<{ type: "CUE_COMPLETED"; executionId: CueExecutionId }>
  | Readonly<{
      type: "CUE_FAILED";
      executionId: CueExecutionId;
      message: string;
    }>
  | Readonly<{ type: "CUE_TIMEOUT"; executionId: CueExecutionId }>
  | Readonly<{ type: "ACTOR_DISCONNECTED"; actorId: ActorId }>
  | Readonly<{ type: "STOP_REQUESTED" }>
  | Readonly<{ type: "CLEANUP_COMPLETED" }>
  | Readonly<{ type: "RESET" }>;

export type ActorCueCommand = Readonly<{
  protocolVersion: 1;
  runId: RunId;
  cueExecutionId: CueExecutionId;
  actorId: ActorId;
  cue: Cue;
  speech?: PlannedSpeech;
}>;

export type StageCueCommand = Readonly<{
  runId: RunId;
  cueExecutionId: CueExecutionId;
  cue: Extract<Cue, { kind: "backdrop.set" | "music.start" | "music.stop" }>;
}>;

export type RuntimeEffect =
  | Readonly<{ type: "actor.connect"; actorId: ActorId }>
  | Readonly<{
      type: "actor.execute";
      command: ActorCueCommand;
      timeoutMs: number;
    }>
  | Readonly<{
      type: "actor.cancel";
      executionId: CueExecutionId;
      actorId: ActorId;
    }>
  | Readonly<{
      type: "stage.execute";
      command: StageCueCommand;
      timeoutMs: number;
    }>
  | Readonly<{ type: "audio.prepare"; speech: PlannedSpeech }>
  | Readonly<{ type: "audio.prefetch"; speech: readonly PlannedSpeech[] }>
  | Readonly<{
      type: "timer.start";
      timerId: string;
      executionId: CueExecutionId;
      durationMs: number;
    }>
  | Readonly<{ type: "run.cleanup"; runId: RunId }>;

export type RuntimeTransition = Readonly<{
  state: RuntimeState;
  effects: readonly RuntimeEffect[];
}>;

export type RoleCue = Extract<Cue, { roleId: RoleId }>;
