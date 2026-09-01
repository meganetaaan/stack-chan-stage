import {
  asActorId,
  asAssetId,
  asCueId,
  asLaneId,
  asRoleId,
  asScenarioId,
  asSceneId,
  type AssetKind,
  type AssetMetadata,
  type CastPlan,
  type Scenario,
} from "@stackchan-stage/domain";

import demoAssetDefinitions from "./demo-assets.json";

export const simulatorActorId = asActorId("wasm-actor");
export const narratorRoleId = asRoleId("narrator");
export const guestRoleId = asRoleId("guest");

export const openWebBackdropAssetId = asAssetId(
  "asset-112ad9726dd07c40e653c0b3",
);
export const revisionLoopBackdropAssetId = asAssetId(
  "asset-098175752ee272ec0455bf6a",
);
export const finaleBackdropAssetId = asAssetId(
  "asset-82e872b655d3c86f88bb07c2",
);
export const demoMusicAssetId = asAssetId("asset-8928e571a725a5f78bbb57bb");

type DemoAssetDefinition = Readonly<{
  id: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  byteSize: number;
  digest: string;
  path: string;
  sourcePath: string;
  license: string;
}>;

const demoAssets = (baseUrl: string | URL): readonly AssetMetadata[] =>
  (demoAssetDefinitions as readonly DemoAssetDefinition[]).map(
    ({ path, sourcePath: _sourcePath, ...definition }) => ({
      ...definition,
      id: asAssetId(definition.id),
      sourceUrl: new URL(path, baseUrl).href,
    }),
  );

export const defaultScenario = (baseUrl: string | URL): Scenario => ({
  schemaVersion: 1,
  id: asScenarioId("scenario-first-stage"),
  title: "WebMCPとつくる舞台",
  roles: [
    {
      id: narratorRoleId,
      name: "語り手",
      description: "舞台を進行する役",
      voice: { provider: "browser", voiceId: "default", locale: "ja-JP" },
    },
    {
      id: guestRoleId,
      name: "ゲスト",
      description: "もうひとりの登場人物",
      voice: { provider: "browser", voiceId: "default", locale: "ja-JP" },
    },
  ],
  scenes: [
    {
      id: asSceneId("scene-opening"),
      title: "開演",
      lanes: [
        {
          id: asLaneId("lane-opening"),
          name: "本線",
          cues: [
            {
              id: asCueId("cue-opening-backdrop"),
              kind: "backdrop.set",
              assetId: openWebBackdropAssetId,
              transition: { kind: "fade", durationMs: 600 },
            },
            {
              id: asCueId("cue-opening-music"),
              kind: "music.start",
              assetId: demoMusicAssetId,
              loop: true,
              volume: 0.18,
              fadeInMs: 500,
            },
            {
              id: asCueId("cue-smile"),
              kind: "expression",
              roleId: narratorRoleId,
              expression: "HAPPY",
            },
            {
              id: asCueId("cue-greeting"),
              kind: "speech",
              roleId: narratorRoleId,
              text: "ようこそ。人とAIが一緒につくる、Stack-chan Stageです。",
              direction: "明るく、短く開演を知らせるように",
            },
            {
              id: asCueId("cue-nod"),
              kind: "motion",
              roleId: narratorRoleId,
              motion: { kind: "preset", name: "nod" },
            },
          ],
        },
      ],
    },
    {
      id: asSceneId("scene-collaboration"),
      title: "共同演出",
      lanes: [
        {
          id: asLaneId("lane-collaboration"),
          name: "本線",
          cues: [
            {
              id: asCueId("cue-collaboration-backdrop"),
              kind: "backdrop.set",
              assetId: openWebBackdropAssetId,
              transition: { kind: "fade", durationMs: 400 },
            },
            {
              id: asCueId("cue-collaboration-expression"),
              kind: "expression",
              roleId: narratorRoleId,
              expression: "DOUBTFUL",
            },
            {
              id: asCueId("cue-collaboration-line"),
              kind: "speech",
              roleId: narratorRoleId,
              text: "この場面は、まだ下書きです。",
              direction: "続きを考えながら",
            },
            {
              id: asCueId("cue-collaboration-motion"),
              kind: "motion",
              roleId: narratorRoleId,
              motion: { kind: "preset", name: "thinking" },
            },
          ],
        },
      ],
    },
    {
      id: asSceneId("scene-finale"),
      title: "フィナーレ",
      lanes: [
        {
          id: asLaneId("lane-finale"),
          name: "本線",
          cues: [
            {
              id: asCueId("cue-finale-backdrop"),
              kind: "backdrop.set",
              assetId: finaleBackdropAssetId,
              transition: { kind: "fade", durationMs: 600 },
            },
            {
              id: asCueId("cue-guest-happy"),
              kind: "expression",
              roleId: guestRoleId,
              expression: "HAPPY",
            },
            {
              id: asCueId("cue-bow"),
              kind: "motion",
              roleId: guestRoleId,
              motion: { kind: "preset", name: "bow" },
            },
            {
              id: asCueId("cue-finale-music-stop"),
              kind: "music.stop",
              fadeOutMs: 500,
            },
          ],
        },
      ],
    },
  ],
  assets: demoAssets(baseUrl),
});

export const defaultCastPlan = (): CastPlan => ({
  global: {
    assignments: {
      [narratorRoleId]: simulatorActorId,
      [guestRoleId]: simulatorActorId,
    },
  },
  scenes: {},
});
