import { describe, expect, it } from "vitest";

import {
  asAssetId,
  asCueId,
  asRoleId,
  type Cue,
  type Role,
} from "@stackchan-stage/domain";

import {
  cueScriptLines,
  cueScriptText,
  motionPresetOptions,
} from "./cue-presentation";

describe("motion preset presentation", () => {
  const roleId = asRoleId("narrator");
  const roles: readonly Role[] = [{ id: roleId, name: "語り手" }];

  it("汎用的な10種類を日本語の動作名で選べる", () => {
    expect(motionPresetOptions).toEqual([
      { name: "neutral", label: "正面を向く" },
      { name: "nod", label: "うなずく" },
      { name: "shake", label: "首を横に振る" },
      { name: "tilt", label: "首をかしげる" },
      { name: "bow", label: "お辞儀する" },
      { name: "look-around", label: "あたりを見回す" },
      { name: "look-left", label: "左を見る" },
      { name: "look-right", label: "右を見る" },
      { name: "clap", label: "拍手する" },
      { name: "thinking", label: "手を添えて考える" },
    ]);
  });

  it.each([
    ["tilt", "語り手（首をかしげる）"],
    ["look-around", "語り手（あたりを見回す）"],
    ["clap", "語り手（拍手する）"],
    ["thinking", "語り手（手を添えて考える）"],
  ])("%sを台本らしい文として表示する", (name, expected) => {
    const cue: Cue = {
      id: asCueId(`cue-${name}`),
      kind: "motion",
      roleId,
      motion: { kind: "preset", name },
    };

    expect(cueScriptText(cue, roles)).toBe(expected);
  });
});

describe("cueScriptLines", () => {
  const narratorRoleId = asRoleId("narrator");
  const guestRoleId = asRoleId("guest");
  const roles: readonly Role[] = [
    { id: narratorRoleId, name: "語り手" },
    { id: guestRoleId, name: "ゲスト" },
  ];
  const smileCue: Cue = {
    id: asCueId("cue-smile"),
    kind: "expression",
    roleId: narratorRoleId,
    expression: "HAPPY",
  };
  const openingCue: Cue = {
    id: asCueId("cue-opening"),
    kind: "speech",
    roleId: narratorRoleId,
    text: "ようこそ、スタックチャン・ステージへ",
  };
  const introductionCue: Cue = {
    id: asCueId("cue-introduction"),
    kind: "speech",
    roleId: narratorRoleId,
    text: "今日はWebMCPを紹介します",
  };

  const cues: readonly Cue[] = [
    openingCue,
    smileCue,
    {
      id: asCueId("cue-pause"),
      kind: "pause",
      durationMs: 1_000,
    },
    introductionCue,
    {
      id: asCueId("cue-guest"),
      kind: "speech",
      roleId: guestRoleId,
      text: "よろしくお願いします",
    },
    {
      id: asCueId("cue-nod"),
      kind: "motion",
      roleId: guestRoleId,
      motion: { kind: "preset", name: "nod" },
    },
  ];

  it("同じRoleの連続行ではRole名を台本らしく省略する", () => {
    const lines = cueScriptLines(cues, roles);

    expect(lines.map(({ text }) => text)).toEqual([
      "語り手「ようこそ、スタックチャン・ステージへ」",
      "（笑顔）",
      "1秒、間を置く",
      "「今日はWebMCPを紹介します」",
      "ゲスト「よろしくお願いします」",
      "（うなずく）",
    ]);
    expect(lines.map(({ groupPosition }) => groupPosition)).toEqual([
      "start",
      "middle",
      "middle",
      "end",
      "start",
      "end",
    ]);
  });

  it("間を置く行は直前Roleの字下げとグループを維持する", () => {
    const lines = cueScriptLines(cues, roles);

    expect(lines[2]).toMatchObject({
      continuesRole: true,
      roleName: "語り手",
      roleNameVisible: false,
      bodyText: "1秒、間を置く",
    });
    expect(lines[3]?.continuesRole).toBe(true);
  });

  it("照明コマンドも同じRoleの本文位置へ揃える", () => {
    const lightingCue: Cue = {
      id: asCueId("cue-lighting"),
      kind: "lighting.set",
      roleId: narratorRoleId,
      color: "#ffffff",
      brightness: 0.8,
    };
    const firstLine = cueScriptLines([lightingCue], roles)[0];
    const continuedLine = cueScriptLines([openingCue, lightingCue], roles)[1];

    expect(firstLine).toMatchObject({
      text: "語り手のライト　#ffffff / 80%",
      bodyText: "のライト　#ffffff / 80%",
      roleNameVisible: true,
    });
    expect(continuedLine).toMatchObject({
      text: "ライト　#ffffff / 80%",
      bodyText: "ライト　#ffffff / 80%",
      roleNameVisible: false,
      fullText: "語り手のライト　#ffffff / 80%",
    });
  });

  it("背景やBGMは演者グループを終了し次の行でRole名を再表示する", () => {
    const lines = cueScriptLines(
      [
        openingCue,
        {
          id: asCueId("cue-backdrop"),
          kind: "backdrop.set",
          assetId: asAssetId("backdrop"),
          transition: { kind: "cut" },
        },
        introductionCue,
      ],
      roles,
    );

    expect(
      lines.map(({ text, groupPosition }) => [text, groupPosition]),
    ).toEqual([
      ["語り手「ようこそ、スタックチャン・ステージへ」", "single"],
      ["「backdrop」へ切り替える", "none"],
      ["語り手「今日はWebMCPを紹介します」", "single"],
    ]);
  });

  it("LaneごとにRole名の表示をリセットする", () => {
    expect(cueScriptLines(cues.slice(0, 2), roles)[0]?.text).toBe(
      "語り手「ようこそ、スタックチャン・ステージへ」",
    );
    expect(cueScriptLines(cues.slice(3, 4), roles)[0]?.text).toBe(
      "語り手「今日はWebMCPを紹介します」",
    );
  });

  it("単独表示とアクセシビリティ向けには省略前の文を保持する", () => {
    const lines = cueScriptLines(cues, roles);

    expect(lines[1]?.fullText).toBe("語り手（笑顔）");
    expect(cueScriptText(smileCue, roles)).toBe("語り手（笑顔）");
  });
});
