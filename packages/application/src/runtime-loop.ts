import {
  reduceRuntime,
  type PlannedSpeech,
  type RunPlan,
  type RuntimeEffect,
  type RuntimeEvent,
  type RuntimeState,
} from "@stackchan-stage/domain";

import {
  DEFAULT_AUDIO_PREFETCH_POLICY,
  planAudioWindow,
  type AudioPrefetchPolicy,
} from "./audio-prefetch";
import type {
  ActorEvent,
  ActorPort,
  AudioPreparationPort,
  PreparedAudio,
  RuntimeObserver,
  StagePort,
} from "./ports";

export type RuntimeCoordinator = Readonly<{
  getState: () => RuntimeState;
  getPreparedAudio: (fingerprint: string) => PreparedAudio | undefined;
  prepare: (plan: RunPlan) => Promise<void>;
  play: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => Promise<void>;
  dispatch: (event: RuntimeEvent) => Promise<void>;
  subscribe: (observer: RuntimeObserver) => () => void;
  dispose: () => void;
}>;

type TimerHandle = ReturnType<typeof setTimeout>;

type PreparingAudio = {
  estimatedBytes: number;
  required: boolean;
  promise: Promise<void>;
};

const assertAudioPolicy = (policy: AudioPrefetchPolicy) => {
  const values = Object.values(policy);
  if (!values.every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new RangeError("Audio prefetch policyには0以上の整数が必要です");
  if (policy.maximumPreparedSpeechCues < 1)
    throw new RangeError("maximumPreparedSpeechCuesは1以上にしてください");
  if (policy.maximumPreparedBytes < 1 || policy.maximumSingleCueBytes < 1)
    throw new RangeError("Audio byte上限は1以上にしてください");
  if (policy.minimumReadySpeechCues > policy.maximumPreparedSpeechCues)
    throw new RangeError(
      "minimumReadySpeechCuesはmaximumPreparedSpeechCues以下にしてください",
    );
  if (policy.maximumSingleCueBytes > policy.maximumPreparedBytes)
    throw new RangeError(
      "maximumSingleCueBytesはmaximumPreparedBytes以下にしてください",
    );
};

export const createRuntimeCoordinator = ({
  actor,
  stage,
  audio,
  audioPolicy = DEFAULT_AUDIO_PREFETCH_POLICY,
}: Readonly<{
  actor: ActorPort;
  stage: StagePort;
  audio: AudioPreparationPort;
  audioPolicy?: AudioPrefetchPolicy;
}>): RuntimeCoordinator => {
  assertAudioPolicy(audioPolicy);
  let state: RuntimeState = { status: "idle" };
  let processing = false;
  let disposed = false;
  const queue: RuntimeEvent[] = [];
  const observers = new Set<RuntimeObserver>();
  const timers = new Map<string, TimerHandle>();
  const eventAbort = new AbortController();
  let audioAbort = new AbortController();
  let audioGeneration = 0;
  const prepared = new Map<string, PreparedAudio>();
  const preparingAudio = new Map<string, PreparingAudio>();

  const notify = () => observers.forEach((observer) => observer(state));
  const enqueue = (event: RuntimeEvent) => queue.push(event);
  const clearExecutionTimer = (executionId: string) => {
    const timer = timers.get(executionId);
    if (timer) clearTimeout(timer);
    timers.delete(executionId);
  };

  const watchdog = (executionId: string, durationMs: number) => {
    clearExecutionTimer(executionId);
    timers.set(
      executionId,
      setTimeout(() => {
        void dispatch({
          type: "CUE_TIMEOUT",
          executionId:
            executionId as import("@stackchan-stage/domain").CueExecutionId,
        });
      }, durationMs),
    );
  };

  const beginAudioRun = () => {
    audioGeneration += 1;
    audioAbort.abort();
    audioAbort = new AbortController();
    prepared.clear();
    preparingAudio.clear();
  };

  const endAudioRun = () => {
    audioGeneration += 1;
    audioAbort.abort();
    prepared.clear();
    preparingAudio.clear();
  };

  const prepareSpeech = (
    speech: PlannedSpeech,
    required: boolean,
  ): Promise<void> => {
    if (prepared.has(speech.fingerprint)) {
      enqueue({ type: "AUDIO_READY", fingerprint: speech.fingerprint });
      return Promise.resolve();
    }
    const existing = preparingAudio.get(speech.fingerprint);
    if (existing) {
      if (required) existing.required = true;
      return existing.promise;
    }

    const entry: PreparingAudio = {
      estimatedBytes: speech.estimatedBytes,
      required,
      promise: Promise.resolve(),
    };
    preparingAudio.set(speech.fingerprint, entry);
    const generation = audioGeneration;
    const signal = audioAbort.signal;
    entry.promise = (async () => {
      try {
        if (speech.estimatedBytes > audioPolicy.maximumSingleCueBytes)
          throw new Error("Speech Cueが単一Cueの音声サイズ上限を超えています");
        const cached = await audio.get(speech.fingerprint);
        const result = cached ?? (await audio.prepare(speech, signal));
        if (generation !== audioGeneration || disposed) return;
        if (result.fingerprint !== speech.fingerprint)
          throw new Error("準備済み音声のfingerprintが要求と一致しません");
        if (result.byteSize > audioPolicy.maximumSingleCueBytes)
          throw new Error("Speech Cueが単一Cueの音声サイズ上限を超えています");
        const preparedBytes = [...prepared.values()].reduce(
          (sum, audio) => sum + audio.byteSize,
          0,
        );
        if (
          !prepared.has(result.fingerprint) &&
          preparedBytes + result.byteSize > audioPolicy.maximumPreparedBytes
        )
          throw new Error("準備済み音声が先読み枠のbyte上限を超えています");
        prepared.set(result.fingerprint, result);
        enqueue({ type: "AUDIO_READY", fingerprint: result.fingerprint });
      } catch (error) {
        if (generation !== audioGeneration || disposed) return;
        enqueue({
          type: "AUDIO_PREPARE_FAILED",
          fingerprint: speech.fingerprint,
          message: error instanceof Error ? error.message : String(error),
          required: entry.required,
        });
      } finally {
        if (preparingAudio.get(speech.fingerprint) === entry)
          preparingAudio.delete(speech.fingerprint);
        if (generation === audioGeneration && !disposed) void drain();
      }
    })();
    return entry.promise;
  };

  const interpret = async (effect: RuntimeEffect): Promise<void> => {
    if (disposed) return;
    switch (effect.type) {
      case "actor.connect":
        try {
          await actor.connect(effect.actorId);
        } catch (error) {
          enqueue({ type: "ACTOR_DISCONNECTED", actorId: effect.actorId });
        }
        break;
      case "actor.execute":
        watchdog(effect.command.cueExecutionId, effect.timeoutMs);
        try {
          await actor.execute(effect.command);
        } catch (error) {
          enqueue({
            type: "CUE_FAILED",
            executionId: effect.command.cueExecutionId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      case "actor.cancel":
        clearExecutionTimer(effect.executionId);
        await actor
          .cancel(effect.executionId, effect.actorId)
          .catch(() => undefined);
        break;
      case "stage.execute":
        watchdog(effect.command.cueExecutionId, effect.timeoutMs);
        try {
          await stage.execute(effect.command);
          enqueue({
            type: "CUE_COMPLETED",
            executionId: effect.command.cueExecutionId,
          });
        } catch (error) {
          enqueue({
            type: "CUE_FAILED",
            executionId: effect.command.cueExecutionId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      case "audio.prepare":
        await prepareSpeech(effect.speech, true);
        break;
      case "audio.prefetch": {
        const reserved = new Map(
          [...prepared].map(([fingerprint, result]) => [
            fingerprint,
            result.byteSize,
          ]),
        );
        for (const [fingerprint, entry] of preparingAudio)
          reserved.set(fingerprint, entry.estimatedBytes);
        const window = planAudioWindow(effect.speech, 0, reserved, audioPolicy);
        if (!window.ok) {
          enqueue({
            type: "AUDIO_PREPARE_FAILED",
            fingerprint: window.speech.fingerprint,
            message: "Speech Cueが単一Cueの音声サイズ上限を超えています",
            required: false,
          });
          break;
        }
        for (const speech of window.speech) void prepareSpeech(speech, false);
        break;
      }
      case "timer.start":
        clearExecutionTimer(effect.executionId);
        timers.set(
          effect.executionId,
          setTimeout(() => {
            void dispatch({
              type: "CUE_COMPLETED",
              executionId: effect.executionId,
            });
          }, effect.durationMs),
        );
        break;
      case "run.cleanup":
        endAudioRun();
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
        await stage.stopAll().catch(() => undefined);
        enqueue({ type: "CLEANUP_COMPLETED" });
        break;
    }
  };

  const drain = async (): Promise<void> => {
    if (processing || disposed) return;
    processing = true;
    try {
      while (queue.length > 0 && !disposed) {
        const event = queue.shift()!;
        if (state.status === "idle" && event.type === "RUN_REQUESTED")
          beginAudioRun();
        const consumedFingerprint =
          state.status === "playing" &&
          event.type === "CUE_COMPLETED" &&
          event.executionId === state.active.executionId
            ? state.active.speech?.fingerprint
            : undefined;
        if (
          "executionId" in event &&
          (event.type === "CUE_COMPLETED" ||
            event.type === "CUE_FAILED" ||
            event.type === "CUE_TIMEOUT")
        ) {
          clearExecutionTimer(event.executionId);
        }
        const transition = reduceRuntime(state, event);
        state = transition.state;
        if (
          consumedFingerprint &&
          state.status !== "idle" &&
          !state.preparedAudio.includes(consumedFingerprint)
        )
          prepared.delete(consumedFingerprint);
        if (state.status === "idle") prepared.clear();
        notify();
        await Promise.all(transition.effects.map(interpret));
      }
    } finally {
      processing = false;
    }
  };

  const dispatch = async (event: RuntimeEvent) => {
    enqueue(event);
    await drain();
  };

  const mapActorEvent = (event: ActorEvent): RuntimeEvent => {
    switch (event.type) {
      case "cue.accepted":
      case "cue.started":
        return { type: "CUE_STARTED", executionId: event.executionId };
      case "cue.completed":
        return { type: "CUE_COMPLETED", executionId: event.executionId };
      case "cue.failed":
        return {
          type: "CUE_FAILED",
          executionId: event.executionId,
          message: event.message,
        };
      case "actor.disconnected":
        return { type: "ACTOR_DISCONNECTED", actorId: event.actorId };
    }
  };

  void (async () => {
    try {
      for await (const event of actor.events(eventAbort.signal))
        await dispatch(mapActorEvent(event));
    } catch (error) {
      if (!eventAbort.signal.aborted)
        console.error("[runtime] actor event loop failed", error);
    }
  })();

  return {
    getState: () => state,
    getPreparedAudio: (fingerprint) => prepared.get(fingerprint),
    prepare: (plan) =>
      dispatch({
        type: "RUN_REQUESTED",
        plan,
        minimumReadySpeechCues: audioPolicy.minimumReadySpeechCues,
      }),
    play: () => dispatch({ type: "PLAY_REQUESTED" }),
    stop: () => dispatch({ type: "STOP_REQUESTED" }),
    reset: () => dispatch({ type: "RESET" }),
    dispatch,
    subscribe(observer) {
      observers.add(observer);
      observer(state);
      return () => observers.delete(observer);
    },
    dispose() {
      disposed = true;
      endAudioRun();
      eventAbort.abort();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      observers.clear();
    },
  };
};
