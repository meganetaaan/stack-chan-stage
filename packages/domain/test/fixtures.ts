import {
  asActorId,
  asAssetId,
  asCueId,
  asLaneId,
  asRoleId,
  asScenarioId,
  asSceneId,
  type Actor,
  type CastPlan,
  type Scenario,
} from "../src";

export const narratorId = asRoleId("role-narrator");
export const guestId = asRoleId("role-guest");
export const actorId = asActorId("actor-wasm-1");
export const secondActorId = asActorId("actor-device-1");
export const sceneId = asSceneId("scene-opening");

export const scenarioFixture = (): Scenario => ({
  schemaVersion: 1,
  id: asScenarioId("scenario-demo"),
  title: "月食のステージ",
  roles: [
    {
      id: narratorId,
      name: "ナレーター",
      voice: { provider: "browser", voiceId: "ja-JP", locale: "ja-JP" },
    },
    {
      id: guestId,
      name: "ゲスト",
      voice: { provider: "browser", voiceId: "ja-JP", locale: "ja-JP" },
    },
  ],
  assets: [
    {
      id: asAssetId("asset-night"),
      kind: "backdrop",
      name: "夜空",
      mimeType: "image/webp",
      byteSize: 1200,
      digest: "sha256-night",
    },
    {
      id: asAssetId("asset-bgm"),
      kind: "music",
      name: "静かなBGM",
      mimeType: "audio/ogg",
      byteSize: 2400,
      digest: "sha256-bgm",
    },
  ],
  scenes: [
    {
      id: sceneId,
      title: "オープニング",
      lanes: [
        {
          id: asLaneId("lane-main"),
          name: "Main",
          cues: [
            {
              id: asCueId("cue-backdrop"),
              kind: "backdrop.set",
              assetId: asAssetId("asset-night"),
              transition: { kind: "fade", durationMs: 300 },
            },
            {
              id: asCueId("cue-speech"),
              kind: "speech",
              roleId: narratorId,
              text: "今夜は月食です。",
            },
            {
              id: asCueId("cue-expression"),
              kind: "expression",
              roleId: guestId,
              expression: "surprised",
            },
            {
              id: asCueId("cue-motion"),
              kind: "motion",
              roleId: narratorId,
              motion: { kind: "preset", name: "nod" },
            },
            {
              id: asCueId("cue-pause"),
              kind: "pause",
              durationMs: 100,
            },
          ],
        },
      ],
    },
  ],
});

export const actorFixture = (overrides: Partial<Actor> = {}): Actor => ({
  id: actorId,
  name: "WASM ｽﾀｯｸﾁｬﾝ",
  kind: "wasm",
  availability: "online",
  capabilities: {
    protocolVersion: 1,
    speech: {
      formats: [
        { codec: "opus", sampleRate: 24_000, channels: 1, frameDurationMs: 20 },
      ],
      streaming: false,
      playbackEndedAck: true,
    },
    expressions: ["neutral", "happy", "surprised"],
    motion: {
      presets: ["nod", "wave", "look-around"],
      pose: { axes: ["yaw", "pitch", "roll"], duration: true },
    },
    lighting: { setColor: true, effects: ["pulse", "rainbow"] },
  },
  ...overrides,
});

export const castFixture = (): CastPlan => ({
  global: {
    assignments: {
      [narratorId]: actorId,
      [guestId]: actorId,
    },
  },
  scenes: {},
});
