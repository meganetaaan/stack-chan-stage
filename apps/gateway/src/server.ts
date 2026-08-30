import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
} from "node:http";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import {
  MAX_OPUS_PACKET_BYTES,
  decodeControlMessage,
  decodeMediaMessage,
  encodeControlMessage,
  encodeMediaMessage,
  validateOpusPacket,
  type ActorHelloMessage,
  type ControlMessage,
  type MediaMessage,
} from "@stackchan-stage/protocol";

type Channel =
  "browser-control" | "browser-media" | "device-control" | "device-media";

type DeviceConnection = {
  hello: ActorHelloMessage;
  control: WebSocket;
  media?: WebSocket;
  lastSeenAt: number;
};

type BrowserMediaTarget = {
  actorId: string;
  streamId: string;
  credit: number;
};

type Session = {
  id: string;
  browsersControl: Set<WebSocket>;
  browsersMedia: Set<WebSocket>;
  devices: Map<string, DeviceConnection>;
  browserMediaTargets: Map<WebSocket, BrowserMediaTarget>;
};

export type GatewayServerOptions = Readonly<{
  host?: string;
  port?: number;
  token?: string;
  heartbeatIntervalMs?: number;
  maximumBufferedBytes?: number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}>;

export type GatewayServer = Readonly<{
  token: string;
  listen: () => Promise<{ host: string; port: number }>;
  close: () => Promise<void>;
  address: () => { host: string; port: number } | undefined;
}>;

const routeChannel = (path: string): Channel | undefined => {
  const routes: Record<string, Channel> = {
    "/browser/control": "browser-control",
    "/browser/media": "browser-media",
    "/device/control": "device-control",
    "/device/media": "device-media",
  };
  return routes[path];
};

const constantTimeEqual = (left: string | null, right: string): boolean => {
  if (left === null) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};

const rawToBytes = (raw: RawData): Uint8Array => {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw));
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
};

const sendJson = (socket: WebSocket, value: ControlMessage | MediaMessage) => {
  if (socket.readyState !== WebSocket.OPEN) return;
  const mediaTypes = new Set([
    "media.hello",
    "audio.open",
    "audio.credit",
    "audio.end",
    "audio.abort",
  ]);
  const encoded = mediaTypes.has(value.type)
    ? encodeMediaMessage(value as MediaMessage)
    : encodeControlMessage(value as ControlMessage);
  socket.send(encoded);
};

const rejectUpgrade = (
  socket: import("node:stream").Duplex,
  status: number,
  message: string,
) => {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
};

export const createGatewayServer = (
  options: GatewayServerOptions = {},
): GatewayServer => {
  const host = options.host ?? "0.0.0.0";
  const port = options.port ?? 8787;
  const token = options.token ?? randomBytes(24).toString("base64url");
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
  const maximumBufferedBytes = options.maximumBufferedBytes ?? 1024 * 1024;
  const logger = options.logger ?? console;
  const sessions = new Map<string, Session>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  let heartbeatSequence = 0;
  let boundAddress: { host: string; port: number } | undefined;

  const sessionFor = (id: string): Session => {
    const current = sessions.get(id);
    if (current) return current;
    const created: Session = {
      id,
      browsersControl: new Set(),
      browsersMedia: new Set(),
      devices: new Map(),
      browserMediaTargets: new Map(),
    };
    sessions.set(id, created);
    return created;
  };

  const broadcastControl = (session: Session, message: ControlMessage) => {
    for (const browser of session.browsersControl) sendJson(browser, message);
  };

  const removeEmptySession = (session: Session) => {
    if (
      session.browsersControl.size === 0 &&
      session.browsersMedia.size === 0 &&
      session.devices.size === 0
    ) {
      sessions.delete(session.id);
    }
  };

  const actorOffline = (session: Session, actorId: string, reason: string) => {
    const current = session.devices.get(actorId);
    if (!current) return;
    session.devices.delete(actorId);
    current.media?.close(1012, reason);
    for (const [browser, target] of session.browserMediaTargets) {
      if (target.actorId === actorId)
        session.browserMediaTargets.delete(browser);
    }
    broadcastControl(session, {
      type: "actor.offline",
      protocolVersion: 1,
      sessionId: session.id,
      actorId: current.hello.actor.id,
      reason,
    });
    removeEmptySession(session);
  };

  const attachBrowserControl = (socket: WebSocket, session: Session) => {
    session.browsersControl.add(socket);
    sendJson(socket, {
      type: "gateway.ready",
      protocolVersion: 1,
      sessionId: session.id,
    });
    for (const device of session.devices.values()) {
      sendJson(socket, {
        type: "actor.online",
        protocolVersion: 1,
        sessionId: session.id,
        actor: device.hello.actor,
      });
    }
    socket.on("message", (raw, isBinary) => {
      if (isBinary)
        return socket.close(
          1003,
          "Binary data is not valid on control channel",
        );
      const decoded = decodeControlMessage(rawToBytes(raw));
      if (!decoded.ok) return socket.close(1007, decoded.code);
      const message = decoded.value;
      if (message.sessionId !== session.id)
        return socket.close(1008, "session mismatch");
      if (
        message.type !== "cue.execute" &&
        message.type !== "cue.cancel" &&
        message.type !== "heartbeat.ack"
      ) {
        return socket.close(1008, "message direction is not allowed");
      }
      if (message.type === "heartbeat.ack") return;
      const device = session.devices.get(message.actorId);
      if (!device || device.control.readyState !== WebSocket.OPEN) {
        if (message.type === "cue.execute") {
          sendJson(socket, {
            type: "cue.failed",
            protocolVersion: 1,
            sessionId: session.id,
            runId: message.runId,
            cueExecutionId: message.cueExecutionId,
            actorId: message.actorId,
            code: "actor_offline",
            message: `Actor ${message.actorId} is offline`,
            retryable: true,
          });
        }
        return;
      }
      sendJson(device.control, message);
    });
    socket.on("close", () => {
      session.browsersControl.delete(socket);
      removeEmptySession(session);
    });
  };

  const attachDeviceControl = (socket: WebSocket, session: Session) => {
    let actorId: string | undefined;
    socket.on("message", (raw, isBinary) => {
      if (isBinary)
        return socket.close(
          1003,
          "Binary data is not valid on control channel",
        );
      const decoded = decodeControlMessage(rawToBytes(raw));
      if (!decoded.ok) return socket.close(1007, decoded.code);
      const message = decoded.value;
      if (message.sessionId !== session.id)
        return socket.close(1008, "session mismatch");
      if (!actorId) {
        if (message.type !== "actor.hello")
          return socket.close(1008, "actor.hello must be first");
        actorId = message.actor.id;
        const previous = session.devices.get(actorId);
        previous?.control.close(1012, "Actor reconnected");
        session.devices.set(actorId, {
          hello: message,
          control: socket,
          lastSeenAt: Date.now(),
        });
        sendJson(socket, {
          type: "session.accepted",
          protocolVersion: 1,
          sessionId: session.id,
          heartbeatIntervalMs,
        });
        broadcastControl(session, {
          type: "actor.online",
          protocolVersion: 1,
          sessionId: session.id,
          actor: message.actor,
        });
        return;
      }
      const device = session.devices.get(actorId);
      if (!device || device.control !== socket) return;
      device.lastSeenAt = Date.now();
      if (message.type === "heartbeat.ack") return;
      if (
        ![
          "cue.accepted",
          "cue.started",
          "cue.completed",
          "cue.failed",
        ].includes(message.type)
      ) {
        return socket.close(1008, "message direction is not allowed");
      }
      if ("actorId" in message && message.actorId !== actorId)
        return socket.close(1008, "actor mismatch");
      broadcastControl(session, message);
    });
    socket.on("close", () => {
      if (actorId && session.devices.get(actorId)?.control === socket)
        actorOffline(session, actorId, "control disconnected");
    });
  };

  const attachBrowserMedia = (socket: WebSocket, session: Session) => {
    session.browsersMedia.add(socket);
    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        const packet = validateOpusPacket(rawToBytes(raw));
        if (!packet.ok) return socket.close(1009, packet.code);
        const target = session.browserMediaTargets.get(socket);
        if (!target || target.credit <= 0)
          return socket.close(1008, "audio credit exceeded");
        const device = session.devices.get(target.actorId);
        if (!device?.media || device.media.readyState !== WebSocket.OPEN)
          return socket.close(1011, "device media offline");
        if (device.media.bufferedAmount > maximumBufferedBytes)
          return socket.close(1013, "gateway media buffer full");
        target.credit -= 1;
        device.media.send(packet.value, { binary: true });
        return;
      }
      const decoded = decodeMediaMessage(rawToBytes(raw));
      if (!decoded.ok) return socket.close(1007, decoded.code);
      const message = decoded.value;
      if (message.sessionId !== session.id)
        return socket.close(1008, "session mismatch");
      if (
        message.type !== "audio.open" &&
        message.type !== "audio.end" &&
        message.type !== "audio.abort"
      ) {
        return socket.close(1008, "message direction is not allowed");
      }
      const device = session.devices.get(message.actorId);
      if (!device?.media || device.media.readyState !== WebSocket.OPEN)
        return socket.close(1011, "device media offline");
      if (message.type === "audio.open") {
        const conflict = [...session.browserMediaTargets.entries()].some(
          ([browser, target]) =>
            browser !== socket && target.actorId === message.actorId,
        );
        if (conflict)
          return socket.close(
            1008,
            "actor already has an active speech stream",
          );
        session.browserMediaTargets.set(socket, {
          actorId: message.actorId,
          streamId: message.streamId,
          credit: 0,
        });
      } else {
        const target = session.browserMediaTargets.get(socket);
        if (
          !target ||
          target.actorId !== message.actorId ||
          target.streamId !== message.streamId
        ) {
          return socket.close(1008, "stream mismatch");
        }
        session.browserMediaTargets.delete(socket);
      }
      sendJson(device.media, message);
    });
    socket.on("close", () => {
      session.browsersMedia.delete(socket);
      session.browserMediaTargets.delete(socket);
      removeEmptySession(session);
    });
  };

  const attachDeviceMedia = (socket: WebSocket, session: Session) => {
    let actorId: string | undefined;
    socket.on("message", (raw, isBinary) => {
      if (isBinary)
        return socket.close(1008, "device binary uplink is not supported");
      const decoded = decodeMediaMessage(rawToBytes(raw));
      if (!decoded.ok) return socket.close(1007, decoded.code);
      const message = decoded.value;
      if (message.sessionId !== session.id)
        return socket.close(1008, "session mismatch");
      if (!actorId) {
        if (message.type !== "media.hello")
          return socket.close(1008, "media.hello must be first");
        const device = session.devices.get(message.actorId);
        if (!device)
          return socket.close(1008, "control channel must connect first");
        actorId = message.actorId;
        device.media?.close(1012, "Media reconnected");
        device.media = socket;
        return;
      }
      if (message.actorId !== actorId)
        return socket.close(1008, "actor mismatch");
      if (message.type !== "audio.credit")
        return socket.close(1008, "message direction is not allowed");
      for (const [browser, target] of session.browserMediaTargets) {
        if (
          target.actorId === actorId &&
          target.streamId === message.streamId
        ) {
          target.credit += message.packets;
          sendJson(browser, message);
        }
      }
    });
    socket.on("close", () => {
      if (!actorId) return;
      const device = session.devices.get(actorId);
      if (device?.media === socket) delete device.media;
    });
  };

  const attach = (socket: WebSocket, channel: Channel, sessionId: string) => {
    socket.binaryType = "arraybuffer";
    const session = sessionFor(sessionId);
    switch (channel) {
      case "browser-control":
        attachBrowserControl(socket, session);
        break;
      case "browser-media":
        attachBrowserMedia(socket, session);
        break;
      case "device-control":
        attachDeviceControl(socket, session);
        break;
      case "device-media":
        attachDeviceMedia(socket, session);
        break;
    }
  };

  const http: HttpServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      const actors = [...sessions.values()].reduce(
        (sum, session) => sum + session.devices.size,
        0,
      );
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          status: "ok",
          protocolVersion: 1,
          sessions: sessions.size,
          actors,
        }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  http.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    const channel = routeChannel(url.pathname);
    if (!channel) return rejectUpgrade(socket, 404, "Not Found");
    if (!constantTimeEqual(url.searchParams.get("token"), token))
      return rejectUpgrade(socket, 401, "Unauthorized");
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId || sessionId.length > 128)
      return rejectUpgrade(socket, 400, "Bad Request");
    wss.handleUpgrade(request, socket, head, (websocket) =>
      attach(websocket, channel, sessionId),
    );
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    heartbeatSequence += 1;
    for (const session of sessions.values()) {
      for (const [actorId, device] of session.devices) {
        if (now - device.lastSeenAt > heartbeatIntervalMs * 3) {
          device.control.terminate();
          actorOffline(session, actorId, "heartbeat timeout");
          continue;
        }
        sendJson(device.control, {
          type: "heartbeat",
          protocolVersion: 1,
          sessionId: session.id,
          sequence: heartbeatSequence,
          sentAt: now,
        });
      }
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();

  return {
    token,
    listen: () =>
      new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => {
          http.off("error", reject);
          const address = http.address();
          const actualPort =
            typeof address === "object" && address ? address.port : port;
          boundAddress = { host, port: actualPort };
          logger.info(`[gateway] listening on ${host}:${actualPort}`);
          resolve(boundAddress);
        });
      }),
    close: async () => {
      clearInterval(heartbeat);
      for (const session of sessions.values()) {
        for (const socket of [
          ...session.browsersControl,
          ...session.browsersMedia,
        ])
          socket.terminate();
        for (const device of session.devices.values()) {
          device.control.terminate();
          device.media?.terminate();
        }
      }
      await new Promise<void>((resolve, reject) => {
        wss.close();
        http.close((error) => (error ? reject(error) : resolve()));
      });
      sessions.clear();
      boundAddress = undefined;
    },
    address: () => boundAddress,
  };
};
