import { describe, expect, it, vi } from "vitest";

import { createStageMediaReceiver } from "./stage-media-receiver.js";

const openMessage = {
  type: "audio.open",
  protocolVersion: 1,
  sessionId: "session-1",
  actorId: "actor-1",
  streamId: "stream-1",
  cueExecutionId: "execution-1",
  format: {
    codec: "opus",
    sampleRate: 24_000,
    channels: 1,
    frameDurationMs: 20,
  },
  packetCount: 2,
};

describe("stage media receiver", () => {
  it("bounds packets with credit and resolves only after playback has finished", async () => {
    const packetResolvers: Array<() => void> = [];
    let finishPlayback!: () => void;
    const finished = new Promise<void>((resolve) => {
      finishPlayback = resolve;
    });
    const player = {
      open: vi.fn(async () => {}),
      writePacket: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            packetResolvers.push(resolve);
          }),
      ),
      finishPlayback: vi.fn(() => finished),
      abort: vi.fn(async () => {}),
    };
    const sent: Array<Record<string, unknown>> = [];
    const receiver = createStageMediaReceiver({
      actorId: "actor-1",
      sessionId: "session-1",
      player,
      send: (message: Record<string, unknown>) => sent.push(message),
      initialPacketCredit: 2,
    });
    const started = vi.fn();
    let playbackResolved = false;
    const playback = receiver.awaitPlayback("stream-1", started).then(() => {
      playbackResolved = true;
    });

    await receiver.handleJson(openMessage);
    const first = receiver.receivePacket(Uint8Array.of(1));
    const second = receiver.receivePacket(Uint8Array.of(2));
    expect(() => receiver.receivePacket(Uint8Array.of(3))).toThrowError(
      /credit exceeded/i,
    );
    expect(started).toHaveBeenCalledOnce();
    expect(sent).toEqual([
      expect.objectContaining({
        type: "audio.credit",
        streamId: "stream-1",
        packets: 2,
      }),
    ]);

    const ending = receiver.handleJson({
      type: "audio.end",
      protocolVersion: 1,
      sessionId: "session-1",
      actorId: "actor-1",
      streamId: "stream-1",
    });
    packetResolvers.forEach((resolve) => resolve());
    await Promise.all([first, second]);
    expect(player.finishPlayback).toHaveBeenCalledOnce();
    expect(playbackResolved).toBe(false);

    finishPlayback();
    await Promise.all([ending, playback]);
    expect(playbackResolved).toBe(true);
  });

  it("rejects an early end with a packet-count error", async () => {
    const receiver = createStageMediaReceiver({
      actorId: "actor-1",
      sessionId: "session-1",
      player: {
        open: async () => {},
        writePacket: async () => {},
        finishPlayback: async () => {},
        abort: async () => {},
      },
      send: () => {},
    });
    await receiver.handleJson(openMessage);

    await expect(
      receiver.handleJson({
        ...openMessage,
        type: "audio.end",
        streamId: "stream-1",
      }),
    ).rejects.toMatchObject({ code: "packet_count_mismatch" });
  });
});
