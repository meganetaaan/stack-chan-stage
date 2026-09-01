import { describe, expect, it } from "vitest";

import { cueDropBoundary, cueListEdgeDropBoundary } from "./cue-reorder";

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

  it("台本より上を先頭、下を末尾の挿入位置にする", () => {
    const bounds = { top: 100, bottom: 400, cueCount: 4 };
    expect(cueListEdgeDropBoundary({ ...bounds, pointerY: 80 })).toBe(0);
    expect(cueListEdgeDropBoundary({ ...bounds, pointerY: 420 })).toBe(4);
    expect(
      cueListEdgeDropBoundary({ ...bounds, pointerY: 250 }),
    ).toBeUndefined();
  });
});
