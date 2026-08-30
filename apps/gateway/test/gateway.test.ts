import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { createGatewayServer } from "../src/server";

const token = "test-token-at-least-16-characters";
const sessionId = "test-session";

type InboxItem = { data: Buffer; isBinary: boolean };
type InboxWaiter = {
  resolve: (item: InboxItem) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const inboxes = new WeakMap<
  WebSocket,
  { queued: InboxItem[]; waiters: InboxWaiter[] }
>();

const openSocket = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const inbox = { queued: [] as InboxItem[], waiters: [] as InboxWaiter[] };
    inboxes.set(socket, inbox);
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      const item = { data, isBinary };
      const waiter = inbox.waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(item);
      } else inbox.queued.push(item);
    });
    socket.on("close", (code) => {
      inbox.waiters.splice(0).forEach((waiter) => {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`socket closed before message (${code})`));
      });
    });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });

const nextMessage = (
  socket: WebSocket,
  label = "WebSocket message",
): Promise<{ data: Buffer; isBinary: boolean }> =>
  new Promise((resolve, reject) => {
    const inbox = inboxes.get(socket);
    if (!inbox) return reject(new Error("missing socket inbox"));
    const queued = inbox.queued.shift();
    if (queued) return resolve(queued);
    const timer = setTimeout(() => {
      const index = inbox.waiters.findIndex(
        (waiter) => waiter.resolve === resolve,
      );
      if (index >= 0) inbox.waiters.splice(index, 1);
      reject(new Error(`timed out waiting for ${label}`));
    }, 1_000);
    inbox.waiters.push({ resolve, reject, timer });
  });

const nextJson = async (socket: WebSocket, label?: string) =>
  JSON.parse((await nextMessage(socket, label)).data.toString()) as Record<
    string,
    unknown
  >;

const endpoint = (port: number, path: string, suppliedToken = token) =>
  `ws://127.0.0.1:${port}${path}?sessionId=${sessionId}&token=${encodeURIComponent(suppliedToken)}`;

const actorHello = {
  type: "actor.hello",
  protocolVersion: 1,
  sessionId,
  actor: {
    id: "device-1",
    name: "Device 1",
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
      expressions: ["neutral"],
      motion: { presets: ["nod"] },
      lighting: { setColor: true, effects: [] },
    },
  },
};

const cueExecute = {
  type: "cue.execute",
  protocolVersion: 1,
  sessionId,
  runId: "run-1",
  cueExecutionId: "execution-1",
  actorId: "device-1",
  cue: {
    id: "cue-1",
    kind: "expression",
    roleId: "role-1",
    expression: "neutral",
  },
};

describe("Local Gateway", () => {
  it("Control WSでhello/cue/playback-ended completionを中継する", async () => {
    const server = createGatewayServer({
      host: "127.0.0.1",
      port: 0,
      token,
      logger: { info() {}, warn() {}, error() {} },
    });
    const { port } = await server.listen();
    const browser = await openSocket(endpoint(port, "/browser/control"));
    expect(await nextJson(browser, "gateway.ready")).toMatchObject({
      type: "gateway.ready",
    });
    const device = await openSocket(endpoint(port, "/device/control"));
    const accepted = nextJson(device, "session.accepted");
    const online = nextJson(browser, "actor.online");
    device.send(JSON.stringify(actorHello));
    expect(await accepted).toMatchObject({ type: "session.accepted" });
    expect(await online).toMatchObject({
      type: "actor.online",
      actor: { id: "device-1" },
    });

    device.once("message", (data) => {
      const request = JSON.parse(data.toString());
      expect(request).toMatchObject(cueExecute);
      device.send(
        JSON.stringify({
          type: "cue.completed",
          protocolVersion: 1,
          sessionId,
          runId: request.runId,
          cueExecutionId: request.cueExecutionId,
          actorId: "device-1",
        }),
      );
    });
    const completed = nextJson(browser, "cue.completed");
    browser.send(JSON.stringify(cueExecute));
    expect(await completed).toMatchObject({
      type: "cue.completed",
      cueExecutionId: "execution-1",
    });
    browser.close();
    device.close();
    await server.close();
  });

  it("Media WSでcredit以内のOpus packetだけを転送する", async () => {
    const server = createGatewayServer({
      host: "127.0.0.1",
      port: 0,
      token,
      logger: { info() {}, warn() {}, error() {} },
    });
    const { port } = await server.listen();
    const deviceControl = await openSocket(endpoint(port, "/device/control"));
    const accepted = nextJson(deviceControl);
    deviceControl.send(JSON.stringify(actorHello));
    await accepted;
    const deviceMedia = await openSocket(endpoint(port, "/device/media"));
    deviceMedia.send(
      JSON.stringify({
        type: "media.hello",
        protocolVersion: 1,
        sessionId,
        actorId: "device-1",
      }),
    );
    const browserMedia = await openSocket(endpoint(port, "/browser/media"));
    const audioOpen = {
      type: "audio.open",
      protocolVersion: 1,
      sessionId,
      actorId: "device-1",
      streamId: "stream-1",
      cueExecutionId: "execution-1",
      format: {
        codec: "opus",
        sampleRate: 24_000,
        channels: 1,
        frameDurationMs: 20,
      },
      packetCount: 1,
    };
    const opened = nextJson(deviceMedia);
    browserMedia.send(JSON.stringify(audioOpen));
    expect(await opened).toMatchObject({
      type: "audio.open",
      streamId: "stream-1",
    });
    const credited = nextJson(browserMedia);
    deviceMedia.send(
      JSON.stringify({
        type: "audio.credit",
        protocolVersion: 1,
        sessionId,
        actorId: "device-1",
        streamId: "stream-1",
        packets: 1,
      }),
    );
    expect(await credited).toMatchObject({ type: "audio.credit", packets: 1 });
    const packetPromise = nextMessage(deviceMedia);
    browserMedia.send(new Uint8Array([0xf8, 0xff, 0xfe]), { binary: true });
    const packet = await packetPromise;
    expect(packet.isBinary).toBe(true);
    expect([...packet.data]).toEqual([0xf8, 0xff, 0xfe]);

    browserMedia.close();
    deviceMedia.close();
    deviceControl.close();
    await server.close();
  });

  it("token不一致のupgradeを拒否する", async () => {
    const server = createGatewayServer({
      host: "127.0.0.1",
      port: 0,
      token,
      logger: { info() {}, warn() {}, error() {} },
    });
    const { port } = await server.listen();
    await expect(
      openSocket(endpoint(port, "/browser/control", "wrong-token")),
    ).rejects.toThrow();
    await server.close();
  });

  it("creditなしのbinary packetをpolicy violationで切断する", async () => {
    const server = createGatewayServer({
      host: "127.0.0.1",
      port: 0,
      token,
      logger: { info() {}, warn() {}, error() {} },
    });
    const { port } = await server.listen();
    const deviceControl = await openSocket(endpoint(port, "/device/control"));
    const accepted = nextJson(deviceControl);
    deviceControl.send(JSON.stringify(actorHello));
    await accepted;
    const deviceMedia = await openSocket(endpoint(port, "/device/media"));
    deviceMedia.send(
      JSON.stringify({
        type: "media.hello",
        protocolVersion: 1,
        sessionId,
        actorId: "device-1",
      }),
    );
    const browserMedia = await openSocket(endpoint(port, "/browser/media"));
    const opened = nextJson(deviceMedia);
    browserMedia.send(
      JSON.stringify({
        type: "audio.open",
        protocolVersion: 1,
        sessionId,
        actorId: "device-1",
        streamId: "stream-1",
        cueExecutionId: "execution-1",
        format: {
          codec: "opus",
          sampleRate: 24_000,
          channels: 1,
          frameDurationMs: 20,
        },
        packetCount: 1,
      }),
    );
    await opened;
    const closed = new Promise<number>((resolve) =>
      browserMedia.once("close", resolve),
    );
    browserMedia.send(new Uint8Array([1]), { binary: true });
    await expect(closed).resolves.toBe(1008);
    deviceMedia.close();
    deviceControl.close();
    await server.close();
  });
});
