import { describe, expect, it, vi } from "vitest";

import {
  asAssetId,
  asCueExecutionId,
  asCueId,
  asRoleId,
  asRunId,
} from "@stackchan-stage/domain";
import {
  createHostStageBridge,
  createWasmActorAdapter,
  DEFAULT_WASM_ACTOR,
} from "../src";

describe("WASM Actor adapter", () => {
  it("汎用的な10種類のmotion presetを公開する", () => {
    expect(DEFAULT_WASM_ACTOR.capabilities.motion?.presets).toEqual([
      "neutral",
      "nod",
      "shake",
      "tilt",
      "bow",
      "look-around",
      "look-left",
      "look-right",
      "clap",
      "thinking",
    ]);
  });

  it("Host.Stage境界で不正なeventを拒否する", () => {
    const bridge = createHostStageBridge(vi.fn(async () => {}));

    expect(() =>
      bridge.emitEvent({ type: "cue.completed", protocolVersion: 1 }),
    ).toThrow("Host.Stage event is invalid");
    bridge.dispose();
  });

  it("Host.Stage command/event bridgeをActorPortへ正規化する", async () => {
    const playback = vi.fn(async (_audio, options) => options.onStarted?.());
    const bridge = createHostStageBridge(playback);
    bridge.subscribeCommand((command) => {
      if (command.type !== "cue.execute") return;
      for (const type of [
        "cue.accepted",
        "cue.started",
        "cue.completed",
      ] as const)
        bridge.emitEvent({
          type,
          protocolVersion: 1,
          sessionId: command.sessionId,
          runId: command.runId,
          cueExecutionId: command.cueExecutionId,
          actorId: command.actorId,
        });
    });
    const adapter = createWasmActorAdapter({
      bridge,
      resolveAudio: async () => undefined,
    });
    const abort = new AbortController();
    const events = adapter.events(abort.signal)[Symbol.asyncIterator]();
    const [actor] = await adapter.listActors();

    await adapter.execute({
      protocolVersion: 1,
      runId: asRunId("run-1"),
      cueExecutionId: asCueExecutionId("execution-1"),
      actorId: actor!.id,
      cue: {
        id: asCueId("cue-1"),
        kind: "expression",
        roleId: asRoleId("role-1"),
        expression: "HAPPY",
      },
    });

    await expect(events.next()).resolves.toMatchObject({
      value: { type: "cue.accepted" },
    });
    await expect(events.next()).resolves.toMatchObject({
      value: { type: "cue.started" },
    });
    await expect(events.next()).resolves.toMatchObject({
      value: { type: "cue.completed" },
    });
    abort.abort();
    adapter.dispose();
  });

  it("prepared audioをstream IDに束縛し、再生終了まで待つ", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = vi.fn();
    const playback = vi.fn(async (_audio, options) => {
      options.onStarted?.();
      await blocked;
    });
    const bridge = createHostStageBridge(playback);
    bridge.registerAudio("stream-1", {
      id: asAssetId("audio-1"),
      fingerprint: "fingerprint-1",
      mimeType: "audio/ogg; codecs=opus",
      byteSize: 3,
      data: Uint8Array.of(1, 2, 3),
    });

    const playing = bridge.playAudio("stream-1", started);
    await Promise.resolve();
    expect(started).toHaveBeenCalledOnce();
    let settled = false;
    void playing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await playing;
    expect(playback).toHaveBeenCalledOnce();
  });
});
