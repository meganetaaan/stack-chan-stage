import { describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "@stackchan-stage/domain";
import { waitForRunEnd, type RunEndCoordinator } from "./wait-for-run-end";

describe("waitForRunEnd", () => {
  it("購読前に終端状態へ遷移済みでも現在状態を返す", async () => {
    const state: RuntimeState = { status: "idle" };
    const unsubscribe = vi.fn();
    const coordinator: RunEndCoordinator = {
      getState: () => state,
      stop: vi.fn(async () => undefined),
      subscribe: vi.fn(() => unsubscribe),
    };

    await expect(
      waitForRunEnd(coordinator, new AbortController().signal),
    ).resolves.toEqual(state);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
