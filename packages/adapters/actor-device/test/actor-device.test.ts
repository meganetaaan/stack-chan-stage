import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import {
  createGatewayServer,
  type GatewayServer,
} from "../../../../apps/gateway/src/server";
import {
  asActorId,
  asAssetId,
  asCueExecutionId,
  asCueId,
  asRoleId,
  asRunId,
} from "@stackchan-stage/domain";
import {
  decodeControlMessage,
  decodeMediaMessage,
  type CueExecuteMessage,
} from "@stackchan-stage/protocol";
import { createDeviceActorAdapter, type WebSocketFactory } from "../src";

const sessionId = "session-device-adapter";
const token = "adapter-secret";
const actorId = asActorId("device-1");
const sockets: WebSocket[] = [];
let server: GatewayServer | undefined;

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server?.close();
  server = undefined;
});

const openSocket = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });

const createNodeWebSocket: WebSocketFactory = (url) => {
  const socket = new WebSocket(url);
  sockets.push(socket);
  return {
    getReadyState: () => socket.readyState,
    getBufferedAmount: () => socket.bufferedAmount,
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onOpen: (listener) => socket.on("open", listener),
    onClose: (listener) => socket.on("close", listener),
    onError: (listener) => socket.on("error", listener),
    onMessage: (listener) => socket.on("message", (data) => listener(data)),
  };
};

const rawDataBytes = (data: WebSocket.RawData): Uint8Array => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) {
    const byteLength = data.reduce((total, part) => total + part.byteLength, 0);
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const part of data) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return bytes;
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};

const waitForControlMessage = (socket: WebSocket, type: string) =>
  new Promise<void>((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData, binary: boolean) => {
      if (binary) return;
      const decoded = decodeControlMessage(data.toString());
      if (!decoded.ok) {
        socket.off("message", onMessage);
        reject(new Error(decoded.message));
        return;
      }
      if (decoded.value.type !== type) return;
      socket.off("message", onMessage);
      resolve();
    };
    socket.on("message", onMessage);
    socket.once("close", () =>
      reject(new Error(`Socket closed before ${type}`)),
    );
  });

const until = async (condition: () => boolean) => {
  const expires = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > expires)
      throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("Device Actor adapter", () => {
  it("Gateway経由でActor発見、credit付きOpus転送、再生終了eventを扱う", async () => {
    server = createGatewayServer({
      host: "127.0.0.1",
      port: 0,
      token,
      logger: { info() {}, warn() {}, error() {} },
    });
    const address = await server.listen();
    const base = `ws://127.0.0.1:${address.port}`;
    const deviceControl = await openSocket(
      `${base}/device/control?token=${token}&sessionId=${sessionId}`,
    );
    const accepted = waitForControlMessage(deviceControl, "session.accepted");
    deviceControl.send(
      JSON.stringify({
        type: "actor.hello",
        protocolVersion: 1,
        sessionId,
        actor: {
          id: actorId,
          name: "Physical Stack-chan",
          capabilities: {
            protocolVersion: 1,
            speech: {
              formats: [
                {
                  codec: "opus",
                  sampleRate: 24_000,
                  channels: 1,
                  frameDurationMs: 20,
                },
              ],
              streaming: true,
              playbackEndedAck: true,
            },
          },
        },
      }),
    );
    await accepted;
    const deviceMedia = await openSocket(
      `${base}/device/media?token=${token}&sessionId=${sessionId}`,
    );
    deviceMedia.send(
      JSON.stringify({
        type: "media.hello",
        protocolVersion: 1,
        sessionId,
        actorId,
      }),
    );

    const receivedPackets: Uint8Array[] = [];
    let execution: CueExecuteMessage | undefined;
    deviceControl.on("message", (data, binary) => {
      if (binary) return;
      const decoded = decodeControlMessage(data.toString());
      if (!decoded.ok) throw new Error(decoded.message);
      const message = decoded.value;
      if (message.type !== "cue.execute") return;
      execution = message;
      deviceControl.send(
        JSON.stringify({
          type: "cue.accepted",
          protocolVersion: 1,
          sessionId,
          runId: message.runId,
          cueExecutionId: message.cueExecutionId,
          actorId: message.actorId,
          duplicate: false,
        }),
      );
    });
    deviceMedia.on("message", (data, binary) => {
      if (binary) {
        receivedPackets.push(rawDataBytes(data));
        return;
      }
      const decoded = decodeMediaMessage(data.toString());
      if (!decoded.ok) throw new Error(decoded.message);
      const message = decoded.value;
      if (message.type === "audio.open") {
        deviceMedia.send(
          JSON.stringify({
            type: "audio.credit",
            protocolVersion: 1,
            sessionId,
            actorId,
            streamId: message.streamId,
            packets: 2,
          }),
        );
      }
      if (message.type === "audio.end" && execution) {
        for (const type of ["cue.started", "cue.completed"])
          deviceControl.send(
            JSON.stringify({
              type,
              protocolVersion: 1,
              sessionId,
              runId: execution.runId,
              cueExecutionId: execution.cueExecutionId,
              actorId: execution.actorId,
            }),
          );
      }
    });

    const adapter = createDeviceActorAdapter({
      gatewayUrl: base,
      token,
      sessionId,
      createWebSocket: createNodeWebSocket,
      resolveAudio: async () => ({
        id: asAssetId("audio-1"),
        fingerprint: "fingerprint-1",
        mimeType: "audio/ogg; codecs=opus",
        byteSize: 4,
        providerData: {
          kind: "opus-packets",
          format: {
            codec: "opus",
            sampleRate: 24_000,
            channels: 1,
            frameDurationMs: 20,
          },
          packets: [Uint8Array.of(1, 2), Uint8Array.of(3, 4)],
        },
      }),
    });
    const discovered: Array<readonly { id: string; availability: string }[]> =
      [];
    adapter.subscribeActors((actors) => discovered.push(actors));
    await adapter.listActors();
    await until(() =>
      discovered.some((actors) => actors.some((actor) => actor.id === actorId)),
    );
    await adapter.connect(actorId);
    const abort = new AbortController();
    const events = adapter.events(abort.signal)[Symbol.asyncIterator]();

    await adapter.execute({
      protocolVersion: 1,
      runId: asRunId("run-1"),
      cueExecutionId: asCueExecutionId("execution-1"),
      actorId,
      cue: {
        id: asCueId("cue-1"),
        kind: "speech",
        roleId: asRoleId("role-1"),
        text: "こんにちは",
      },
      speech: {
        cueId: asCueId("cue-1"),
        executionId: asCueExecutionId("execution-1"),
        fingerprint: "fingerprint-1",
        text: "こんにちは",
        voice: { provider: "test", voiceId: "voice-1" },
        estimatedBytes: 4,
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
    expect(receivedPackets).toEqual([Uint8Array.of(1, 2), Uint8Array.of(3, 4)]);

    abort.abort();
    adapter.dispose();
  });
});
