import {
  reduceRuntime,
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
  RuntimeObserver,
  StagePort,
} from "./ports";

export type RuntimeCoordinator = Readonly<{
  getState: () => RuntimeState;
  prepare: (plan: RunPlan) => Promise<void>;
  play: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => Promise<void>;
  dispatch: (event: RuntimeEvent) => Promise<void>;
  subscribe: (observer: RuntimeObserver) => () => void;
  dispose: () => void;
}>;

type TimerHandle = ReturnType<typeof setTimeout>;

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
  let state: RuntimeState = { status: "idle" };
  let processing = false;
  let disposed = false;
  const queue: RuntimeEvent[] = [];
  const observers = new Set<RuntimeObserver>();
  const timers = new Map<string, TimerHandle>();
  const eventAbort = new AbortController();
  const prepared = new Map<string, number>();

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
        try {
          const cached = await audio.get(effect.speech.fingerprint);
          const result =
            cached ?? (await audio.prepare(effect.speech, eventAbort.signal));
          prepared.set(result.fingerprint, result.byteSize);
          enqueue({ type: "AUDIO_READY", fingerprint: result.fingerprint });
        } catch (error) {
          enqueue({
            type: "AUDIO_PREPARE_FAILED",
            fingerprint: effect.speech.fingerprint,
            message: error instanceof Error ? error.message : String(error),
            required: true,
          });
        }
        break;
      case "audio.prefetch": {
        const window = planAudioWindow(effect.speech, 0, prepared, audioPolicy);
        if (!window.ok) {
          enqueue({
            type: "AUDIO_PREPARE_FAILED",
            fingerprint: window.speech.fingerprint,
            message: "Speech Cueが単一Cueの音声サイズ上限を超えています",
            required: false,
          });
          break;
        }
        await Promise.all(
          window.speech.map(async (speech) => {
            try {
              const cached = await audio.get(speech.fingerprint);
              const result =
                cached ?? (await audio.prepare(speech, eventAbort.signal));
              prepared.set(result.fingerprint, result.byteSize);
              enqueue({ type: "AUDIO_READY", fingerprint: result.fingerprint });
            } catch (error) {
              enqueue({
                type: "AUDIO_PREPARE_FAILED",
                fingerprint: speech.fingerprint,
                message: error instanceof Error ? error.message : String(error),
                required: false,
              });
            }
          }),
        );
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
    prepare: (plan) => dispatch({ type: "RUN_REQUESTED", plan }),
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
      eventAbort.abort();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      observers.clear();
    },
  };
};
