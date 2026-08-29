import type {
  Actor,
  ActorCueCommand,
  ActorId,
  AssetId,
  CastPlan,
  CueExecutionId,
  PlannedSpeech,
  RuntimeState,
  Scenario,
  StageCueCommand,
} from "@stackchan-stage/domain";

export type ActorEvent =
  | Readonly<{
      type: "cue.accepted";
      actorId: ActorId;
      executionId: CueExecutionId;
    }>
  | Readonly<{
      type: "cue.started";
      actorId: ActorId;
      executionId: CueExecutionId;
    }>
  | Readonly<{
      type: "cue.completed";
      actorId: ActorId;
      executionId: CueExecutionId;
    }>
  | Readonly<{
      type: "cue.failed";
      actorId: ActorId;
      executionId: CueExecutionId;
      code: string;
      message: string;
      retryable: boolean;
    }>
  | Readonly<{ type: "actor.disconnected"; actorId: ActorId }>;

export type ActorPort = Readonly<{
  listActors: () => Promise<readonly Actor[]>;
  connect: (actorId: ActorId) => Promise<void>;
  execute: (command: ActorCueCommand) => Promise<void>;
  cancel: (executionId: CueExecutionId, actorId: ActorId) => Promise<void>;
  events: (signal?: AbortSignal) => AsyncIterable<ActorEvent>;
}>;

export type StagePort = Readonly<{
  execute: (command: StageCueCommand) => Promise<void>;
  cancel: (executionId: CueExecutionId) => Promise<void>;
  stopAll: () => Promise<void>;
}>;

export type PreparedAudio = Readonly<{
  id: AssetId;
  fingerprint: string;
  mimeType: string;
  byteSize: number;
  data?: Uint8Array;
  sourceUrl?: string;
  providerData?: unknown;
}>;

export type AudioPreparationPort = Readonly<{
  get: (fingerprint: string) => Promise<PreparedAudio | undefined>;
  prepare: (
    request: PlannedSpeech,
    signal?: AbortSignal,
  ) => Promise<PreparedAudio>;
  release: (assetId: AssetId) => Promise<void>;
}>;

export type ProjectSnapshot = Readonly<{
  scenario: Scenario;
  castPlan: CastPlan;
  revision: number;
}>;

export type ProjectStorePort = Readonly<{
  load: () => Promise<ProjectSnapshot | undefined>;
  save: (snapshot: ProjectSnapshot) => Promise<void>;
  saveBlob: (assetId: AssetId, blob: Blob) => Promise<void>;
  loadBlob: (assetId: AssetId) => Promise<Blob | undefined>;
}>;

export type RuntimeObserver = (state: RuntimeState) => void;
