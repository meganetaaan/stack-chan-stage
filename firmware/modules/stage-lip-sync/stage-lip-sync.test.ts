import { describe, expect, it, vi } from "vitest";

import { createStageLipSync } from "./stage-lip-sync.js";

describe("Stage speech lip sync", () => {
  it("音声の再生開始から終了まで口を動かし、最後に閉じる", async () => {
    const events: string[] = [];
    const pendingDelays: Array<() => void> = [];
    const face = {
      setMouthOpen: vi.fn((level: number) => events.push(`mouth:${level}`)),
    };
    const delay = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          pendingDelays.push(resolve);
        }),
    );
    let startPlayback: (() => void) | undefined;
    let finishPlayback: (() => void) | undefined;
    const playback = vi.fn(
      (onStarted: () => void) =>
        new Promise<void>((resolve) => {
          startPlayback = onStarted;
          finishPlayback = resolve;
        }),
    );
    const markStarted = vi.fn(() => events.push("started"));
    const lipSync = createStageLipSync(delay, {
      intervalMs: 90,
      levels: [0.25, 0.8],
    });

    const playing = lipSync.play(face, playback, markStarted);
    await Promise.resolve();
    expect(events).toEqual([]);

    startPlayback?.();
    expect(events).toEqual(["started", "mouth:0.25"]);
    expect(delay).toHaveBeenCalledWith(90);

    pendingDelays.shift()?.();
    await Promise.resolve();
    expect(events).toEqual(["started", "mouth:0.25", "mouth:0.8"]);

    finishPlayback?.();
    await Promise.resolve();
    expect(events.at(-1)).toBe("mouth:0");

    pendingDelays.shift()?.();
    await playing;
    expect(face.setMouthOpen).toHaveBeenLastCalledWith(0);
  });

  it("再生開始前に失敗した場合も口を閉じる", async () => {
    const face = { setMouthOpen: vi.fn() };
    const playbackError = new Error("playback failed");
    const lipSync = createStageLipSync(vi.fn());

    await expect(
      lipSync.play(
        face,
        async () => {
          throw playbackError;
        },
        vi.fn(),
      ),
    ).rejects.toBe(playbackError);
    expect(face.setMouthOpen).toHaveBeenCalledOnce();
    expect(face.setMouthOpen).toHaveBeenLastCalledWith(0);
  });
});
