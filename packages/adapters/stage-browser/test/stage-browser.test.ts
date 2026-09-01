// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  asAssetId,
  asCueExecutionId,
  asCueId,
  asRunId,
} from "@stackchan-stage/domain";
import { createBrowserStagePort } from "../src";

describe("Browser Stage adapter", () => {
  it("stylesheetで指定されたStage rootの配置を上書きしない", () => {
    const style = document.createElement("style");
    style.textContent = ".positioned-stage-root { position: absolute; }";
    document.head.append(style);
    const root = document.createElement("div");
    root.className = "positioned-stage-root";
    document.body.append(root);

    const stage = createBrowserStagePort({
      root,
      resolveAsset: async () => undefined,
    });

    expect(getComputedStyle(root).position).toBe("absolute");
    expect(root.style.position).toBe("");
    void stage.dispose();
    root.remove();
    style.remove();
  });

  it("背景transition終了後に旧layerを破棄する", async () => {
    const root = document.createElement("div");
    const cancel = vi.fn();
    const animateElement = vi.fn(() => ({
      cancel,
      finished: Promise.resolve(),
    }));
    const stage = createBrowserStagePort({
      root,
      resolveAsset: async () => new Blob(["image"], { type: "image/png" }),
      createObjectUrl: (blob) => `blob:test-${blob.size}`,
      revokeObjectUrl: vi.fn(),
      animateElement,
    });
    await stage.execute({
      runId: asRunId("run-1"),
      cueExecutionId: asCueExecutionId("execution-1"),
      cue: {
        id: asCueId("cue-1"),
        kind: "backdrop.set",
        assetId: asAssetId("asset-1"),
        transition: { kind: "cut" },
      },
    });
    await stage.execute({
      runId: asRunId("run-1"),
      cueExecutionId: asCueExecutionId("execution-2"),
      cue: {
        id: asCueId("cue-2"),
        kind: "backdrop.set",
        assetId: asAssetId("asset-2"),
        transition: { kind: "fade", durationMs: 300 },
      },
    });

    expect(root.querySelectorAll("[data-stage-backdrop]")).toHaveLength(1);
    expect(
      root.querySelector<HTMLElement>("[data-stage-backdrop]")?.dataset
        .stageBackdrop,
    ).toBe("asset-2");
    expect(animateElement).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancelで進行中のWeb Animationを停止する", async () => {
    const root = document.createElement("div");
    let rejectFinished!: (error: Error) => void;
    const cancel = vi.fn(() =>
      rejectFinished(new DOMException("cancelled", "AbortError")),
    );
    const animateElement = vi.fn(() => ({
      cancel,
      finished: new Promise<never>((_resolve, reject) => {
        rejectFinished = reject;
      }),
    }));
    const stage = createBrowserStagePort({
      root,
      resolveAsset: async () => "https://example.test/backdrop.png",
      animateElement,
    });
    const executionId = asCueExecutionId("execution-1");
    const executing = stage.execute({
      runId: asRunId("run-1"),
      cueExecutionId: executionId,
      cue: {
        id: asCueId("cue-1"),
        kind: "backdrop.set",
        assetId: asAssetId("asset-1"),
        transition: { kind: "fade", durationMs: 500 },
      },
    });
    await vi.waitFor(() => expect(animateElement).toHaveBeenCalledOnce());
    await stage.cancel(executionId);

    await expect(executing).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("BGMをdecodeしてloop・音量・fadeを適用し停止する", async () => {
    const root = document.createElement("div");
    const decoded = {} as AudioBuffer;
    const source = {
      buffer: null,
      loop: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const gain = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: {
        value: 0.4,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
    };
    const audioContext = {
      currentTime: 1.5,
      destination: {},
      decodeAudioData: vi.fn(async () => decoded),
      createBufferSource: vi.fn(() => source),
      createGain: vi.fn(() => gain),
    } as unknown as AudioContext;
    const stage = createBrowserStagePort({
      root,
      audioContext,
      resolveAsset: async () =>
        ({
          arrayBuffer: async () =>
            new TextEncoder().encode("demo music").buffer,
        }) as Blob,
    });

    await stage.execute({
      runId: asRunId("run-music"),
      cueExecutionId: asCueExecutionId("execution-music-start"),
      cue: {
        id: asCueId("cue-music-start"),
        kind: "music.start",
        assetId: asAssetId("asset-music"),
        loop: true,
        volume: 0.18,
        fadeInMs: 0,
      },
    });

    expect(audioContext.decodeAudioData).toHaveBeenCalledOnce();
    expect(source.buffer).toBe(decoded);
    expect(source.loop).toBe(true);
    expect(source.start).toHaveBeenCalledOnce();
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.18, 1.5);

    await stage.execute({
      runId: asRunId("run-music"),
      cueExecutionId: asCueExecutionId("execution-music-stop"),
      cue: {
        id: asCueId("cue-music-stop"),
        kind: "music.stop",
        fadeOutMs: 0,
      },
    });
    expect(source.stop).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
  });
});
