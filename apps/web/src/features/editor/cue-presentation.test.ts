import { describe, expect, it } from "vitest";

import {
  asCueId,
  asRoleId,
  type Cue,
  type Role,
} from "@stackchan-stage/domain";

import { cueScriptText, motionPresetOptions } from "./cue-presentation";

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
    ["tilt", "語り手　首をかしげる"],
    ["look-around", "語り手　あたりを見回す"],
    ["clap", "語り手　拍手する"],
    ["thinking", "語り手　手を添えて考える"],
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
