import {
  asActorId,
  asCueId,
  asLaneId,
  asRoleId,
  asScenarioId,
  asSceneId,
  type CastPlan,
  type Scenario,
} from "@stackchan-stage/domain";

export const simulatorActorId = asActorId("wasm-actor");
export const narratorRoleId = asRoleId("narrator");
export const guestRoleId = asRoleId("guest");

export const defaultScenario = (): Scenario => ({
  schemaVersion: 1,
  id: asScenarioId("scenario-first-stage"),
  title: "はじめての舞台",
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
              id: asCueId("cue-smile"),
              kind: "expression",
              roleId: narratorRoleId,
              expression: "HAPPY",
            },
            {
              id: asCueId("cue-greeting"),
              kind: "speech",
              roleId: narratorRoleId,
              text: "ようこそ、スタックチャン・ステージへ。",
              direction: "明るく、開演を知らせるように",
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
      id: asSceneId("scene-finale"),
      title: "フィナーレ",
      lanes: [
        {
          id: asLaneId("lane-finale"),
          name: "本線",
          cues: [
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
          ],
        },
      ],
    },
  ],
  assets: [],
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
