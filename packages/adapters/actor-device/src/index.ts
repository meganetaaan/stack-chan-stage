import type {
  ActorEvent,
  ActorPort,
  PreparedAudio,
} from "@stackchan-stage/application";
import {
  type Actor,
  type ActorCueCommand,
  type ActorId,
  type CueExecutionId,
} from "@stackchan-stage/domain";
import {
  MAX_OPUS_PACKET_BYTES,
  decodeControlMessage,
  decodeMediaMessage,
  encodeControlMessage,
  encodeMediaMessage,
  type ControlMessage,
  type MediaMessage,
} from "@stackchan-stage/protocol";
import { z } from "zod";

export type WebSocketLike = Readonly<{
  getReadyState: () => number;
  getBufferedAmount: () => number;
  send: (data: string | ArrayBuffer | ArrayBufferView) => void;
  close: (code?: number, reason?: string) => void;
  onOpen: (listener: () => void) => void;
  onClose: (listener: () => void) => void;
  onError: (listener: () => void) => void;
  onMessage: (listener: (data: unknown) => void) => void;
}>;

export type WebSocketFactory = (url: string) => WebSocketLike;

const createBrowserWebSocket: WebSocketFactory = (url) => {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  return {
    getReadyState: () => socket.readyState,
    getBufferedAmount: () => socket.bufferedAmount,
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onOpen: (listener) => socket.addEventListener("open", listener),
    onClose: (listener) => socket.addEventListener("close", listener),
    onError: (listener) => socket.addEventListener("error", listener),
    onMessage: (listener) =>
      socket.addEventListener("message", (event) => listener(event.data)),
  };
};

type AsyncQueue<T> = ReturnType<typeof createAsyncQueue<T>>;

const createAsyncQueue = <T>() => {
  const values: T[] = [];
  const waiters: Array<(value: IteratorResult<T>) => void> = [];
  let closed = false;
  return {
    push(value: T) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ done: false, value });
      else values.push(value);
    },
    iterable(signal?: AbortSignal): AsyncIterable<T> {
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => {
              const value = values.shift();
              if (value !== undefined)
                return Promise.resolve({ done: false as const, value });
              if (closed || signal?.aborted)
                return Promise.resolve({
                  done: true as const,
                  value: undefined,
                });
              return new Promise<IteratorResult<T>>((resolve) => {
                const abort = () => resolve({ done: true, value: undefined });
                signal?.addEventListener("abort", abort, { once: true });
                waiters.push((result) => {
                  signal?.removeEventListener("abort", abort);
                  resolve(result);
                });
              });
            },
          };
        },
      };
    },
    close() {
      closed = true;
      while (waiters.length > 0)
        waiters.shift()?.({ done: true, value: undefined });
    },
  };
};

const decodeSocketData = async (
  data: unknown,
): Promise<string | Uint8Array> => {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== "undefined" && data instanceof Blob)
    return new Uint8Array(await data.arrayBuffer());
  throw new Error("Unsupported WebSocket message payload");
};

const socketUrl = (
  gatewayUrl: string,
  path: string,
  token: string,
  sessionId: string,
) => {
  const url = new URL(`${gatewayUrl.replace(/\/$/, "")}${path}`);
  url.searchParams.set("token", token);
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
};

const opusProviderDataSchema = z
  .object({
    kind: z.literal("opus-packets"),
    format: z
      .object({
        codec: z.literal("opus"),
        sampleRate: z.number().int().positive().max(96_000),
        channels: z.literal(1),
        frameDurationMs: z.number().int().positive().max(120),
      })
      .strict(),
    packets: z
      .array(
        z
          .instanceof(Uint8Array)
          .refine(
            (packet) =>
              packet.byteLength > 0 &&
              packet.byteLength <= MAX_OPUS_PACKET_BYTES,
            `Opus packet must contain between 1 and ${MAX_OPUS_PACKET_BYTES} bytes`,
          ),
      )
      .min(1),
  })
  .loose();

type ActiveMedia = {
  actorId: ActorId;
  executionId: CueExecutionId;
  streamId: string;
  packets: readonly Uint8Array[];
  nextPacket: number;
  credit: number;
  pumping: boolean;
};

export type DeviceActorAdapter = ActorPort &
  Readonly<{
    subscribeActors: (
      listener: (actors: readonly Actor[]) => void,
    ) => () => void;
    dispose: () => void;
  }>;

export const createDeviceActorAdapter = ({
  gatewayUrl,
  token,
  sessionId,
  resolveAudio,
  createWebSocket = createBrowserWebSocket,
  maximumBufferedBytes = 512 * 1024,
}: Readonly<{
  gatewayUrl: string;
  token: string;
  sessionId: string;
  resolveAudio: (fingerprint: string) => Promise<PreparedAudio | undefined>;
  createWebSocket?: WebSocketFactory;
  maximumBufferedBytes?: number;
}>): DeviceActorAdapter => {
  const actors = new Map<ActorId, Actor>();
  const actorListeners = new Set<(actors: readonly Actor[]) => void>();
  const queue: AsyncQueue<ActorEvent> = createAsyncQueue<ActorEvent>();
  const executions = new Map<CueExecutionId, ActorCueCommand>();
  let control: WebSocketLike | undefined;
  let media: WebSocketLike | undefined;
  let connection: Promise<void> | undefined;
  let activeMedia: ActiveMedia | undefined;
  let disposed = false;

  const actorSnapshot = () => [...actors.values()];
  const notifyActors = () => {
    const snapshot = actorSnapshot();
    for (const listener of actorListeners) listener(snapshot);
  };

  const sendControl = (message: ControlMessage) => {
    if (control?.getReadyState() !== 1)
      throw new Error("Gateway control socket is not open");
    control.send(encodeControlMessage(message));
  };
  const sendMedia = (message: MediaMessage) => {
    if (media?.getReadyState() !== 1)
      throw new Error("Gateway media socket is not open");
    media.send(encodeMediaMessage(message));
  };

  const failActiveMedia = (message: string) => {
    const active = activeMedia;
    if (!active) return;
    activeMedia = undefined;
    queue.push({
      type: "cue.failed",
      actorId: active.actorId,
      executionId: active.executionId,
      code: "media_transport_failed",
      message,
      retryable: true,
    });
  };

  const pumpMedia = () => {
    const active = activeMedia;
    if (!active || active.pumping || media?.getReadyState() !== 1) return;
    active.pumping = true;
    try {
      while (
        activeMedia === active &&
        active.credit > 0 &&
        active.nextPacket < active.packets.length &&
        media.getBufferedAmount() <= maximumBufferedBytes
      ) {
        media.send(active.packets[active.nextPacket]!);
        active.nextPacket += 1;
        active.credit -= 1;
      }
      if (
        activeMedia === active &&
        active.nextPacket === active.packets.length
      ) {
        sendMedia({
          type: "audio.end",
          protocolVersion: 1,
          sessionId,
          actorId: active.actorId,
          streamId: active.streamId,
        });
        activeMedia = undefined;
      }
    } catch (error) {
      failActiveMedia(error instanceof Error ? error.message : String(error));
    } finally {
      active.pumping = false;
    }
  };

  const handleControl = async (data: unknown) => {
    const decoded = decodeControlMessage(await decodeSocketData(data));
    if (!decoded.ok) throw new Error(decoded.message);
    const message = decoded.value;
    if (message.sessionId !== sessionId) return;
    switch (message.type) {
      case "actor.online": {
        const existing = actors.get(message.actor.id);
        actors.set(message.actor.id, {
          id: message.actor.id,
          name: message.actor.name,
          kind: "device",
          availability: "online",
          capabilities: message.actor.capabilities,
        });
        if (!existing || existing.availability !== "online") notifyActors();
        break;
      }
      case "actor.offline": {
        const current = actors.get(message.actorId);
        if (current)
          actors.set(message.actorId, { ...current, availability: "offline" });
        queue.push({ type: "actor.disconnected", actorId: message.actorId });
        notifyActors();
        break;
      }
      case "cue.accepted":
      case "cue.started":
      case "cue.completed":
        queue.push({
          type: message.type,
          actorId: message.actorId,
          executionId: message.cueExecutionId,
        });
        if (message.type === "cue.completed")
          executions.delete(message.cueExecutionId);
        break;
      case "cue.failed":
        queue.push({
          type: "cue.failed",
          actorId: message.actorId,
          executionId: message.cueExecutionId,
          code: message.code,
          message: message.message,
          retryable: message.retryable,
        });
        executions.delete(message.cueExecutionId);
        if (activeMedia?.executionId === message.cueExecutionId)
          activeMedia = undefined;
        break;
    }
  };

  const handleMedia = async (data: unknown) => {
    const decoded = decodeMediaMessage(await decodeSocketData(data));
    if (!decoded.ok) throw new Error(decoded.message);
    const message = decoded.value;
    if (message.type !== "audio.credit" || message.sessionId !== sessionId)
      return;
    const active = activeMedia;
    if (
      !active ||
      active.actorId !== message.actorId ||
      active.streamId !== message.streamId
    )
      return;
    active.credit += message.packets;
    pumpMedia();
  };

  const markDisconnected = () => {
    for (const [id, actor] of actors) {
      if (actor.availability === "offline") continue;
      actors.set(id, { ...actor, availability: "offline" });
      queue.push({ type: "actor.disconnected", actorId: id });
    }
    notifyActors();
  };

  const ensureConnected = () => {
    if (disposed)
      return Promise.reject(new Error("Device Actor adapter is disposed"));
    if (control?.getReadyState() === 1 && media?.getReadyState() === 1)
      return Promise.resolve();
    if (connection) return connection;
    connection = new Promise<void>((resolve, reject) => {
      let controlOpen = false;
      let mediaOpen = false;
      let settled = false;
      const ready = () => {
        if (controlOpen && mediaOpen && !settled) {
          settled = true;
          resolve();
        }
      };
      const failed = () => {
        if (settled) return;
        settled = true;
        connection = undefined;
        reject(new Error("Could not connect to the local gateway"));
      };
      control = createWebSocket(
        socketUrl(gatewayUrl, "/browser/control", token, sessionId),
      );
      media = createWebSocket(
        socketUrl(gatewayUrl, "/browser/media", token, sessionId),
      );
      control.onOpen(() => {
        controlOpen = true;
        ready();
      });
      media.onOpen(() => {
        mediaOpen = true;
        ready();
      });
      control.onMessage((data) => {
        void handleControl(data).catch((error) => {
          control?.close(
            1007,
            error instanceof Error ? error.message : String(error),
          );
        });
      });
      media.onMessage((data) => {
        void handleMedia(data).catch((error) => {
          media?.close(
            1007,
            error instanceof Error ? error.message : String(error),
          );
        });
      });
      control.onError(failed);
      media.onError(failed);
      control.onClose(() => {
        connection = undefined;
        markDisconnected();
      });
      media.onClose(() => {
        connection = undefined;
        failActiveMedia("Gateway media socket disconnected");
      });
    });
    return connection;
  };

  return {
    async listActors() {
      await ensureConnected();
      return actorSnapshot();
    },
    async connect(actorId) {
      await ensureConnected();
      const actor = actors.get(actorId);
      if (!actor || actor.availability !== "online")
        throw new Error(`Device Actor ${actorId} is offline`);
    },
    async execute(command) {
      await ensureConnected();
      await this.connect(command.actorId);
      executions.set(command.cueExecutionId, command);
      if (!command.speech) {
        sendControl({
          type: "cue.execute",
          protocolVersion: 1,
          sessionId,
          runId: command.runId,
          cueExecutionId: command.cueExecutionId,
          actorId: command.actorId,
          cue: command.cue,
        });
        return;
      }
      if (activeMedia)
        throw new Error("Another physical speech stream is active");
      const prepared = await resolveAudio(command.speech.fingerprint);
      if (!prepared)
        throw new Error("Physical Actor speech requires prepared Opus packets");
      const providerResult = opusProviderDataSchema.safeParse(
        prepared.providerData,
      );
      if (!providerResult.success)
        throw new TypeError(
          `Physical Actor speech metadata is invalid: ${z.prettifyError(providerResult.error)}`,
        );
      const provider = providerResult.data;
      const streamId = `device:${command.cueExecutionId}`;
      activeMedia = {
        actorId: command.actorId,
        executionId: command.cueExecutionId,
        streamId,
        packets: provider.packets,
        nextPacket: 0,
        credit: 0,
        pumping: false,
      };
      sendControl({
        type: "cue.execute",
        protocolVersion: 1,
        sessionId,
        runId: command.runId,
        cueExecutionId: command.cueExecutionId,
        actorId: command.actorId,
        cue: command.cue,
        audio: {
          streamId,
          fingerprint: prepared.fingerprint,
          format: provider.format,
          packetCount: provider.packets.length,
          byteLength: prepared.byteSize,
        },
      });
      sendMedia({
        type: "audio.open",
        protocolVersion: 1,
        sessionId,
        actorId: command.actorId,
        streamId,
        cueExecutionId: command.cueExecutionId,
        format: provider.format,
        packetCount: provider.packets.length,
      });
    },
    async cancel(executionId, actorId) {
      await ensureConnected();
      const command = executions.get(executionId);
      if (!command) return;
      if (activeMedia?.executionId === executionId) {
        sendMedia({
          type: "audio.abort",
          protocolVersion: 1,
          sessionId,
          actorId,
          streamId: activeMedia.streamId,
          reason: "Cue cancelled by runtime",
        });
        activeMedia = undefined;
      }
      sendControl({
        type: "cue.cancel",
        protocolVersion: 1,
        sessionId,
        runId: command.runId,
        cueExecutionId: executionId,
        actorId,
      });
    },
    events: (signal) => queue.iterable(signal),
    subscribeActors(listener) {
      actorListeners.add(listener);
      listener(actorSnapshot());
      return () => actorListeners.delete(listener);
    },
    dispose() {
      disposed = true;
      control?.close(1000, "Adapter disposed");
      media?.close(1000, "Adapter disposed");
      queue.close();
      actorListeners.clear();
      actors.clear();
      executions.clear();
      activeMedia = undefined;
    },
  };
};
