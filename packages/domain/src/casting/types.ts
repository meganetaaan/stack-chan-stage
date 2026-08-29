import type { ActorId, SceneId } from "../shared";

export type AudioFormat = Readonly<{
  codec: "opus";
  sampleRate: number;
  channels: 1;
  frameDurationMs: number;
}>;

export type ActorCapabilities = Readonly<{
  protocolVersion: 1;
  speech?: Readonly<{
    formats: readonly AudioFormat[];
    streaming: boolean;
    playbackEndedAck: boolean;
  }>;
  expressions?: readonly string[];
  motion?: Readonly<{
    presets: readonly string[];
    pose?: Readonly<{
      axes: readonly ("yaw" | "pitch" | "roll")[];
      duration: boolean;
    }>;
  }>;
  lighting?: Readonly<{
    setColor: boolean;
    effects: readonly string[];
  }>;
}>;

export type Actor = Readonly<{
  id: ActorId;
  name: string;
  kind: "wasm" | "device";
  availability: "online" | "offline";
  capabilities: ActorCapabilities;
}>;

export type ResolvedSceneCast = Readonly<{
  sceneId: SceneId;
  assignments: Readonly<Record<string, ActorId>>;
}>;

export type CapabilityRequirement =
  | Readonly<{ kind: "speech"; format: AudioFormat; playbackEndedAck: true }>
  | Readonly<{ kind: "expression"; expression: string }>
  | Readonly<{ kind: "motion.preset"; name: string }>
  | Readonly<{
      kind: "motion.pose";
      axes: readonly ("yaw" | "pitch" | "roll")[];
      duration: true;
    }>
  | Readonly<{ kind: "lighting.set" }>
  | Readonly<{ kind: "lighting.play"; effect: string }>;

export const DEFAULT_AUDIO_FORMAT: AudioFormat = {
  codec: "opus",
  sampleRate: 24_000,
  channels: 1,
  frameDurationMs: 20,
};
