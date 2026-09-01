import { describe, expect, it } from "vitest";

import { cueDropBoundary } from "./cue-reorder";

describe("Cue drag reorder", () => {
  it("コマンド上半分を直前の挿入位置にする", () => {
    expect(
      cueDropBoundary({ cueIndex: 2, pointerY: 110, top: 100, height: 60 }),
    ).toBe(2);
  });

  it("コマンド下半分を直後の挿入位置にする", () => {
    expect(
      cueDropBoundary({ cueIndex: 2, pointerY: 150, top: 100, height: 60 }),
    ).toBe(3);
  });
});
