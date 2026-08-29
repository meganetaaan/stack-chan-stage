import type {
  ActorId,
  AssetId,
  CueId,
  LaneId,
  RoleId,
  ScenarioId,
  SceneId,
} from "../shared";

export type VoiceProfileRef = Readonly<{
  provider: string;
  voiceId: string;
  model?: string;
  locale?: string;
}>;

export type Role = Readonly<{
  id: RoleId;
  name: string;
  description?: string;
  voice?: VoiceProfileRef;
}>;

export type SpeechCue = Readonly<{
  kind: "speech";
  roleId: RoleId;
  text: string;
  direction?: string;
  voiceOverride?: VoiceProfileRef;
}>;

export type ExpressionCue = Readonly<{
  kind: "expression";
  roleId: RoleId;
  expression: string;
}>;

export type MotionCue = Readonly<{
  kind: "motion";
  roleId: RoleId;
  motion:
    | Readonly<{ kind: "preset"; name: string }>
    | Readonly<{
        kind: "pose";
        yaw: number;
        pitch: number;
        roll?: number;
        durationMs: number;
      }>;
}>;

export type LightingSetCue = Readonly<{
  kind: "lighting.set";
  roleId: RoleId;
  color: string;
  brightness: number;
}>;

export type LightingPlayCue = Readonly<{
  kind: "lighting.play";
  roleId: RoleId;
  effect: string;
  parameters?: Readonly<Record<string, string | number | boolean>>;
}>;

export type BackdropCue = Readonly<{
  kind: "backdrop.set";
  assetId: AssetId;
  transition:
    | Readonly<{ kind: "cut" }>
    | Readonly<{ kind: "fade"; durationMs: number }>
    | Readonly<{
        kind: "slide";
        direction: "left" | "right" | "up" | "down";
        durationMs: number;
      }>;
}>;

export type MusicStartCue = Readonly<{
  kind: "music.start";
  assetId: AssetId;
  loop: boolean;
  volume: number;
  fadeInMs: number;
}>;

export type MusicStopCue = Readonly<{
  kind: "music.stop";
  fadeOutMs: number;
}>;

export type PauseCue = Readonly<{
  kind: "pause";
  durationMs: number;
}>;

export type Cue = Readonly<
  { id: CueId; label?: string } & (
    | SpeechCue
    | ExpressionCue
    | MotionCue
    | LightingSetCue
    | LightingPlayCue
    | BackdropCue
    | MusicStartCue
    | MusicStopCue
    | PauseCue
  )
>;

export type CueLane = Readonly<{
  id: LaneId;
  name: string;
  cues: readonly Cue[];
}>;

export type Scene = Readonly<{
  id: SceneId;
  title: string;
  lanes: readonly [CueLane, ...CueLane[]];
}>;

export type AssetKind = "backdrop" | "music";

export type AssetMetadata = Readonly<{
  id: AssetId;
  kind: AssetKind;
  name: string;
  mimeType: string;
  byteSize: number;
  digest: string;
  sourceUrl?: string;
  license?: string;
}>;

export type Scenario = Readonly<{
  schemaVersion: 1;
  id: ScenarioId;
  title: string;
  roles: readonly Role[];
  scenes: readonly Scene[];
  assets: readonly AssetMetadata[];
}>;

export type CastScope = Readonly<{
  assignments: Readonly<Partial<Record<string, ActorId>>>;
  standInActorId?: ActorId;
}>;

export type CastPlan = Readonly<{
  global: CastScope;
  scenes: Readonly<Partial<Record<string, CastScope>>>;
}>;

export const emptyCastPlan = (): CastPlan => ({
  global: { assignments: {} },
  scenes: {},
});
