import type {
  ActorEvent,
  ActorPort,
  PreparedAudio,
} from "@stackchan-stage/application";
import {
  asActorId,
  asCueExecutionId,
  type Actor,
  type ActorCueCommand,
  type ActorId,
  type CueExecutionId,
} from "@stackchan-stage/domain";
import { z } from "zod";

export type StageCommand = Readonly<{
  type: "cue.execute" | "cue.cancel";
  protocolVersion: 1;
  sessionId: string;
  runId: string;
  cueExecutionId: string;
  actorId: string;
  cue?: ActorCueCommand["cue"];
  audio?: Readonly<{
    streamId: string;
    fingerprint: string;
    format: Readonly<{
      codec: "opus";
      sampleRate: number;
      channels: 1;
      frameDurationMs: number;
    }>;
    packetCount: number;
    byteLength: number;
  }>;
}>;

const stageEventSchema = z
  .object({
    type: z.enum([
      "cue.accepted",
      "cue.started",
      "cue.completed",
      "cue.failed",
    ]),
    protocolVersion: z.literal(1),
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    cueExecutionId: z.string().min(1),
    actorId: z.string().min(1),
    duplicate: z.boolean().optional(),
    code: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
    retryable: z.boolean().optional(),
  })
  .strict();

export type StageEvent = Readonly<z.output<typeof stageEventSchema>>;

export type PreparedAudioPlayback = (
  audio: PreparedAudio,
  options: Readonly<{ signal: AbortSignal; onStarted?: () => void }>,
) => Promise<void>;

export type HostStageBridge = Readonly<{
  subscribeCommand: (listener: (command: StageCommand) => void) => () => void;
  dispatchCommand: (command: StageCommand) => void;
  emitEvent: (event: unknown) => void;
  subscribeEvent: (listener: (event: StageEvent) => void) => () => void;
  registerAudio: (streamId: string, audio: PreparedAudio) => void;
  playAudio: (streamId: string, onStarted?: () => void) => Promise<void>;
  abortAudio: (reason?: string) => Promise<void>;
  dispose: () => void;
}>;

export const createHostStageBridge = (
  playback: PreparedAudioPlayback,
): HostStageBridge => {
  const commandListeners = new Set<(command: StageCommand) => void>();
  const eventListeners = new Set<(event: StageEvent) => void>();
  const audio = new Map<string, PreparedAudio>();
  let active: AbortController | undefined;

  const abortAudio = async (reason = "Audio playback aborted") => {
    if (!active) return;
    active.abort(new DOMException(reason, "AbortError"));
    active = undefined;
  };

  return Object.freeze({
    subscribeCommand(listener) {
      commandListeners.add(listener);
      return () => commandListeners.delete(listener);
    },
    dispatchCommand(command) {
      for (const listener of commandListeners) listener(command);
    },
    emitEvent(event) {
      const parsed = stageEventSchema.safeParse(event);
      if (!parsed.success)
        throw new TypeError(
          `Host.Stage event is invalid: ${z.prettifyError(parsed.error)}`,
        );
      for (const listener of eventListeners) listener(parsed.data);
    },
    subscribeEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    registerAudio(streamId, prepared) {
      audio.set(streamId, prepared);
    },
    async playAudio(streamId, onStarted) {
      const prepared = audio.get(streamId);
      if (!prepared)
        throw new Error(`Prepared audio ${streamId} is unavailable`);
      await abortAudio("Superseded by another speech Cue");
      const controller = new AbortController();
      active = controller;
      try {
        await playback(prepared, {
          signal: controller.signal,
          ...(onStarted ? { onStarted } : {}),
        });
      } finally {
        audio.delete(streamId);
        if (active === controller) active = undefined;
      }
    },
    abortAudio,
    dispose() {
      void abortAudio("Host.Stage disposed");
      commandListeners.clear();
      eventListeners.clear();
      audio.clear();
    },
  });
};

type AsyncEventQueue<T> = Readonly<{
  push: (value: T) => void;
  iterate: (signal?: AbortSignal) => AsyncIterable<T>;
  close: () => void;
}>;

const createAsyncEventQueue = <T>(): AsyncEventQueue<T> => {
  const values: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;
  return {
    push(value) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ done: false, value });
      else values.push(value);
    },
    iterate(signal) {
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

const DEFAULT_AUDIO_FORMAT = {
  codec: "opus" as const,
  sampleRate: 24_000,
  channels: 1 as const,
  frameDurationMs: 20,
};

const preparedWasmProviderDataSchema = z
  .object({
    format: z
      .object({
        codec: z.literal(DEFAULT_AUDIO_FORMAT.codec),
        sampleRate: z.literal(DEFAULT_AUDIO_FORMAT.sampleRate),
        channels: z.literal(DEFAULT_AUDIO_FORMAT.channels),
        frameDurationMs: z.literal(DEFAULT_AUDIO_FORMAT.frameDurationMs),
      })
      .strict()
      .optional(),
    packets: z.array(z.instanceof(Uint8Array)).optional(),
  })
  .loose();

export const DEFAULT_WASM_ACTOR: Actor = Object.freeze({
  id: asActorId("wasm-actor"),
  name: "Simulator Stack-chan",
  kind: "wasm",
  availability: "online",
  capabilities: {
    protocolVersion: 1 as const,
    speech: {
      formats: [DEFAULT_AUDIO_FORMAT],
      streaming: false,
      playbackEndedAck: true,
    },
    expressions: [
      "NEUTRAL",
      "ANGRY",
      "SAD",
      "HAPPY",
      "SLEEPY",
      "DOUBTFUL",
      "COLD",
      "HOT",
    ],
    motion: {
      presets: [
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
      ],
      pose: { axes: ["yaw", "pitch", "roll"] as const, duration: true },
    },
    lighting: { setColor: true, effects: ["blink", "pulse", "rainbow"] },
  },
});

export type WasmActorAdapter = ActorPort &
  Readonly<{
    bridge: HostStageBridge;
    setAvailability: (availability: Actor["availability"]) => void;
    dispose: () => void;
  }>;

export const createWasmActorAdapter = ({
  bridge,
  resolveAudio,
  actor: initialActor = DEFAULT_WASM_ACTOR,
  sessionId = "wasm-session",
}: Readonly<{
  bridge: HostStageBridge;
  resolveAudio: (fingerprint: string) => Promise<PreparedAudio | undefined>;
  actor?: Actor;
  sessionId?: string;
}>): WasmActorAdapter => {
  let actor = initialActor;
  const queue = createAsyncEventQueue<ActorEvent>();
  const executions = new Map<CueExecutionId, ActorCueCommand>();

  const unsubscribe = bridge.subscribeEvent((event) => {
    if (event.actorId !== actor.id || event.sessionId !== sessionId) return;
    const executionId = asCueExecutionId(event.cueExecutionId);
    switch (event.type) {
      case "cue.accepted":
      case "cue.started":
      case "cue.completed":
        queue.push({ type: event.type, actorId: actor.id, executionId });
        if (event.type === "cue.completed") executions.delete(executionId);
        break;
      case "cue.failed":
        queue.push({
          type: "cue.failed",
          actorId: actor.id,
          executionId,
          code: event.code ?? "wasm_cue_failed",
          message: event.message ?? "Simulator Cue failed",
          retryable: event.retryable === true,
        });
        executions.delete(executionId);
        break;
    }
  });

  return {
    bridge,
    listActors: async () => [actor],
    async connect(actorId) {
      if (actorId !== actor.id)
        throw new Error(`Unknown WASM Actor: ${actorId}`);
      if (actor.availability !== "online")
        throw new Error(`WASM Actor ${actorId} is offline`);
    },
    async execute(command) {
      if (command.actorId !== actor.id)
        throw new Error(`Unknown WASM Actor: ${command.actorId}`);
      executions.set(command.cueExecutionId, command);
      let audio: StageCommand["audio"];
      if (command.speech) {
        const prepared = await resolveAudio(command.speech.fingerprint);
        if (!prepared)
          throw new Error(
            `Prepared speech ${command.speech.fingerprint} is unavailable`,
          );
        const streamId = `wasm:${command.cueExecutionId}`;
        bridge.registerAudio(streamId, prepared);
        const providerResult = preparedWasmProviderDataSchema.safeParse(
          prepared.providerData,
        );
        if (prepared.providerData !== undefined && !providerResult.success)
          throw new TypeError(
            `Prepared audio metadata is invalid: ${z.prettifyError(providerResult.error)}`,
          );
        const provider = providerResult.success
          ? providerResult.data
          : undefined;
        audio = {
          streamId,
          fingerprint: prepared.fingerprint,
          format: provider?.format ?? DEFAULT_AUDIO_FORMAT,
          packetCount: provider?.packets?.length ?? 1,
          byteLength: prepared.byteSize,
        };
      }
      bridge.dispatchCommand({
        type: "cue.execute",
        protocolVersion: 1,
        sessionId,
        runId: command.runId,
        cueExecutionId: command.cueExecutionId,
        actorId: command.actorId,
        cue: command.cue,
        ...(audio ? { audio } : {}),
      });
    },
    async cancel(executionId, actorId) {
      const command = executions.get(executionId);
      if (!command || actorId !== actor.id) return;
      bridge.dispatchCommand({
        type: "cue.cancel",
        protocolVersion: 1,
        sessionId,
        runId: command.runId,
        cueExecutionId: executionId,
        actorId,
      });
    },
    events: (signal) => queue.iterate(signal),
    setAvailability(availability) {
      actor = { ...actor, availability };
      if (availability === "offline")
        queue.push({ type: "actor.disconnected", actorId: actor.id });
    },
    dispose() {
      unsubscribe();
      queue.close();
      bridge.dispose();
    },
  };
};
