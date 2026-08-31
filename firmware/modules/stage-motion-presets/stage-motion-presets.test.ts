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

  it.each([
    [
      "tilt",
      [
        "pose:0:0.04:0.2:0.32",
        "delay:320",
        "delay:450",
        "pose:0:0:0:0.32",
        "delay:320",
      ],
    ],
    [
      "look-around",
      [
        "pose:-0.3:0.03:0:0.35",
        "delay:350",
        "delay:200",
        "pose:0.3:0.03:0:0.55",
        "delay:550",
        "delay:200",
        "pose:0:0:0:0.35",
        "delay:350",
      ],
    ],
  ])("%sは汎用的な身振りを再生して正面へ戻る", async (name, expected) => {
    const events: string[] = [];
    const robot = {
      motion: {
        setPose: vi.fn(async ({ rotation }, seconds) => {
          events.push(
            `pose:${rotation.y}:${rotation.p}:${rotation.r}:${seconds}`,
          );
        }),
      },
    };
    const motion = createStageMotion(async (milliseconds: number) => {
      events.push(`delay:${milliseconds}`);
    });

    await motion.playPreset(robot, name);

    expect(events).toEqual(expected);
  });

  it.each([
    ["clap", 1650],
    ["thinking", 2800],
  ])("%sは手のアニメーションを再生後に隠す", async (name, durationMs) => {
    const setHandAnimation = vi.fn();
    const delay = vi.fn(async () => undefined);
    const motion = createStageMotion(delay);

    await motion.playPreset({ ui: { setHandAnimation } }, name);

    expect(setHandAnimation.mock.calls).toEqual([[name], ["none"]]);
    expect(delay).toHaveBeenCalledWith(durationMs);
  });

  it("手のアニメーション中に失敗してもスプライトを隠す", async () => {
    const setHandAnimation = vi.fn();
    const motion = createStageMotion(async () => {
      throw new Error("cancelled");
    });

    await expect(
      motion.playPreset({ ui: { setHandAnimation } }, "clap"),
    ).rejects.toThrow("cancelled");
    expect(setHandAnimation.mock.calls).toEqual([["clap"], ["none"]]);
  });
});
