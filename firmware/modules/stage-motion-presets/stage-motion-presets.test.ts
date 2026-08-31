import { describe, expect, it, vi } from "vitest";

import { createStageMotion } from "./stage-motion-presets.js";

describe("Stage motion presets", () => {
  it("nodの各姿勢を指定時間ずつ保ってから次へ進む", async () => {
    const events: string[] = [];
    const robot = {
      motion: {
        setPose: vi.fn(async ({ rotation }, seconds) => {
          events.push(`pose:${rotation.p}:${seconds}`);
        }),
      },
    };
    const delay = vi.fn(async (milliseconds: number) => {
      events.push(`delay:${milliseconds}`);
    });
    const motion = createStageMotion(delay);

    await motion.playPreset(robot, "nod");

    expect(events).toEqual([
      "pose:0.18:0.22",
      "delay:220",
      "pose:-0.12:0.22",
      "delay:220",
      "pose:0:0.22",
      "delay:220",
    ]);
  });

  it("任意poseも移動時間が経過するまで完了しない", async () => {
    let releaseDelay: (() => void) | undefined;
    const robot = {
      motion: { setPose: vi.fn(async () => undefined) },
    };
    const motion = createStageMotion(
      () => new Promise<void>((resolve) => (releaseDelay = resolve)),
    );

    let completed = false;
    const moving = motion
      .setPose(robot, 0.1, 0.2, 0, 400)
      .then(() => (completed = true));
    await Promise.resolve();

    expect(completed).toBe(false);
    releaseDelay?.();
    await moving;
    expect(completed).toBe(true);
  });
});
