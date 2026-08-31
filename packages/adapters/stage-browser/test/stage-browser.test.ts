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
});
