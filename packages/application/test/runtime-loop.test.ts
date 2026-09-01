import { describe, expect, it, vi } from "vitest";

import {
  asAssetId,
  asCueExecutionId,
  asCueId,
  asRunId,
  compileRun,
  type ActorId,
  type CueExecutionId,
  type RunPlan,
} from "@stackchan-stage/domain";
import {
  actorFixture,
  castFixture,
  scenarioFixture,
  sceneId,
} from "../../domain/test/fixtures";
import {
  createRuntimeCoordinator,
  type ActorEvent,
  type ActorPort,
  type AudioPreparationPort,
  type StagePort,
} from "../src";

const deferred = <Value>() => {
  let resolvePromise: (value: Value) => void = () => {
    throw new Error("deferred promise is not initialized");
  };
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};

class EventQueue implements AsyncIterable<ActorEvent> {
  private values: ActorEvent[] = [];
  private waiters: Array<(result: IteratorResult<ActorEvent>) => void> = [];
  private closed = false;

  emit(value: ActorEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  close() {
    this.closed = true;
    this.waiters
      .splice(0)
      .forEach((waiter) => waiter({ done: true, value: undefined }));
  }

  [Symbol.asyncIterator](): AsyncIterator<ActorEvent> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.closed)
          return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

const planFixture = (): RunPlan => {
  const result = compileRun({
    runId: asRunId("run-runtime-loop"),
    scenario: scenarioFixture(),
    sceneIds: [sceneId],
    castPlan: castFixture(),
    actors: [actorFixture()],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.plan;
};

const planWithOnly = (
  kind: RunPlan["cues"][number]["cue"]["kind"],
): RunPlan => {
  const plan = planFixture();
  const cue = plan.cues.find((entry) => entry.cue.kind === kind);
  if (!cue) throw new Error(`Cue ${kind} not found`);
  return { ...plan, cues: [cue], speech: cue.speech ? [cue.speech] : [] };
};

const planWithSpeechCount = (count: number): RunPlan => {
  const plan = planFixture();
  const base = plan.cues.find(
    (entry) => entry.cue.kind === "speech" && entry.speech !== undefined,
  );
  if (!base?.speech || base.cue.kind !== "speech")
    throw new Error("Speech Cue not found");
  const baseCue = base.cue;
  const baseSpeech = base.speech;
  const cues = Array.from({ length: count }, (_, index) => {
    const cueId = asCueId(`cue-speech-${index}`);
    const executionId = asCueExecutionId(`execution-speech-${index}`);
    return {
      ...base,
      cue: {
        ...baseCue,
        id: cueId,
        text: `Speech ${index}`,
      },
      executionId,
      speech: {
        ...baseSpeech,
        cueId,
        executionId,
        fingerprint: `fingerprint-speech-${index}`,
        text: `Speech ${index}`,
      },
    };
  });
  return { ...plan, cues, speech: cues.map((cue) => cue.speech) };
};

const harness = () => {
  const events = new EventQueue();
  const execute = vi.fn<ActorPort["execute"]>(async () => undefined);
  const cancel = vi.fn<ActorPort["cancel"]>(async () => undefined);
  const actor: ActorPort = {
    listActors: async () => [actorFixture()],
    connect: async () => undefined,
    execute,
    cancel,
    events: () => events,
  };
  const stage: StagePort = {
    execute: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => undefined),
  };
  const prepared = new Map<
    string,
    Awaited<ReturnType<AudioPreparationPort["prepare"]>>
  >();
  const audio: AudioPreparationPort = {
    get: async (fingerprint) => prepared.get(fingerprint),
    prepare: vi.fn(async (request) => {
      const result = {
        id: asAssetId(`audio-${request.fingerprint.slice(0, 8)}`),
        fingerprint: request.fingerprint,
        mimeType: "audio/ogg",
        byteSize: request.estimatedBytes,
      };
      prepared.set(request.fingerprint, result);
      return result;
    }),
    release: async () => undefined,
  };
  return { events, execute, cancel, actor, stage, audio };
};

describe("Runtime coordinator", () => {
  it("Stage完了後にSpeechをdispatchし、Actor再生完了eventまで次へ進まない", async () => {
    const ports = harness();
    const coordinator = createRuntimeCoordinator(ports);
    const plan = planFixture();
    await coordinator.prepare(plan);
    expect(coordinator.getState().status).toBe("ready");
    await coordinator.play();
    expect(coordinator.getState().status).toBe("playing");
    expect(ports.execute).toHaveBeenCalledOnce();
    const command = ports.execute.mock.calls[0]![0];
    expect(command.cue.kind).toBe("speech");

    await Promise.resolve();
    expect(coordinator.getState()).toMatchObject({
      status: "playing",
      active: { executionId: command.cueExecutionId },
    });
    ports.events.emit({
      type: "cue.completed",
      actorId: command.actorId,
      executionId: command.cueExecutionId,
    });
    await vi.waitFor(() => {
      const state = coordinator.getState();
      expect(state.status === "playing" && state.active.cue.kind).toBe(
        "expression",
      );
    });
    coordinator.dispose();
    ports.events.close();
  });

  it("stopでactive ActorをcancelしStageをcleanupする", async () => {
    const ports = harness();
    const coordinator = createRuntimeCoordinator(ports);
    await coordinator.prepare(planFixture());
    await coordinator.play();
    await coordinator.stop();
    expect(coordinator.getState().status).toBe("idle");
    expect(ports.cancel).toHaveBeenCalledOnce();
    expect(ports.stage.stopAll).toHaveBeenCalled();
    coordinator.dispose();
  });

  it("Audio prepare失敗をRun failureへ正規化する", async () => {
    const ports = harness();
    const failingAudio: AudioPreparationPort = {
      ...ports.audio,
      prepare: vi.fn(async () => {
        throw new Error("TTS unavailable");
      }),
    };
    const coordinator = createRuntimeCoordinator({
      ...ports,
      audio: failingAudio,
    });
    await coordinator.prepare(planFixture());
    expect(coordinator.getState()).toMatchObject({
      status: "failed",
      failure: { code: "audio_prepare_failed", message: "TTS unavailable" },
    });
    coordinator.dispose();
  });

  it("最低限の音声が揃った時点でReadyにし、残りはbackgroundで準備する", async () => {
    const ports = harness();
    const plan = planWithSpeechCount(2);
    const background =
      deferred<Awaited<ReturnType<AudioPreparationPort["prepare"]>>>();
    const originalPrepare = ports.audio.prepare;
    const audio: AudioPreparationPort = {
      ...ports.audio,
      prepare: vi.fn(async (request, signal) => {
        if (request.fingerprint === "fingerprint-speech-0")
          return originalPrepare(request, signal);
        return background.promise;
      }),
    };
    const coordinator = createRuntimeCoordinator({ ...ports, audio });

    try {
      await coordinator.prepare(plan);
      expect(coordinator.getState()).toMatchObject({
        status: "ready",
        preparedAudio: ["fingerprint-speech-0"],
      });
      expect(audio.prepare).toHaveBeenCalledTimes(2);

      const second = plan.speech[1];
      if (!second) throw new Error("expected second speech");
      background.resolve(await originalPrepare(second));
      await vi.waitFor(() =>
        expect(coordinator.getState()).toMatchObject({
          status: "ready",
          preparedAudio: ["fingerprint-speech-0", "fingerprint-speech-1"],
        }),
      );
    } finally {
      coordinator.dispose();
      ports.events.close();
    }
  });

  it("停止したRunのbackground音声結果を現在の状態へ混入させない", async () => {
    const ports = harness();
    const plan = planWithSpeechCount(2);
    const background =
      deferred<Awaited<ReturnType<AudioPreparationPort["prepare"]>>>();
    const originalPrepare = ports.audio.prepare;
    const audio: AudioPreparationPort = {
      ...ports.audio,
      prepare: vi.fn(async (request, signal) => {
        if (request.fingerprint === "fingerprint-speech-0")
          return originalPrepare(request, signal);
        return background.promise;
      }),
    };
    const coordinator = createRuntimeCoordinator({ ...ports, audio });

    try {
      await coordinator.prepare(plan);
      await coordinator.stop();
      expect(coordinator.getState().status).toBe("idle");

      const second = plan.speech[1];
      if (!second) throw new Error("expected second speech");
      background.resolve({
        id: asAssetId("audio-stale"),
        fingerprint: second.fingerprint,
        mimeType: "audio/ogg",
        byteSize: second.estimatedBytes,
      });
      await background.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(coordinator.getState().status).toBe("idle");
      expect(coordinator.getPreparedAudio(second.fingerprint)).toBeUndefined();
    } finally {
      coordinator.dispose();
      ports.events.close();
    }
  });

  it("長いScenarioで再生済み音声の枠を次のSpeech Cueで補充する", async () => {
    const ports = harness();
    const coordinator = createRuntimeCoordinator(ports);
    const plan = planWithSpeechCount(5);
    const statuses: string[] = [];
    const preparedCounts: number[] = [];
    const unsubscribe = coordinator.subscribe((state) => {
      statuses.push(state.status);
      if (state.status !== "idle")
        preparedCounts.push(state.preparedAudio.length);
    });

    try {
      await coordinator.prepare(plan);
      expect(ports.audio.prepare).toHaveBeenCalledTimes(3);
      const ready = coordinator.getState();
      expect(ready.status).toBe("ready");
      expect(
        new Set(ready.status === "ready" ? ready.preparedAudio : []),
      ).toEqual(
        new Set([
          "fingerprint-speech-0",
          "fingerprint-speech-1",
          "fingerprint-speech-2",
        ]),
      );
      expect(
        coordinator.getPreparedAudio("fingerprint-speech-0")?.fingerprint,
      ).toBe("fingerprint-speech-0");

      await coordinator.play();
      for (let index = 0; index < plan.cues.length; index += 1) {
        const state = coordinator.getState();
        if (state.status !== "playing")
          throw new Error(`expected playing, got ${state.status}`);
        if (!state.active.actorId) throw new Error("Speech Cue has no Actor");
        ports.events.emit({
          type: "cue.completed",
          actorId: state.active.actorId,
          executionId: state.active.executionId,
        });
        await vi.waitFor(() => {
          const next = coordinator.getState();
          if (index === plan.cues.length - 1)
            expect(next.status).toBe("completed");
          else
            expect(next.status === "playing" ? next.cursor : undefined).toBe(
              index + 1,
            );
        });
      }

      expect(ports.audio.prepare).toHaveBeenCalledTimes(5);
      expect(statuses).not.toContain("buffering");
      expect(Math.max(...preparedCounts)).toBeLessThanOrEqual(3);
      for (const speech of plan.speech)
        expect(
          coordinator.getPreparedAudio(speech.fingerprint),
        ).toBeUndefined();
    } finally {
      unsubscribe();
      coordinator.dispose();
      ports.events.close();
    }
  });

  it("間を置くタイマー満了時に次へ進みRunを終了する", async () => {
    vi.useFakeTimers();
    const ports = harness();
    const coordinator = createRuntimeCoordinator(ports);
    try {
      await coordinator.prepare(planWithOnly("pause"));
      await coordinator.play();
      expect(coordinator.getState()).toMatchObject({
        status: "playing",
        active: { cue: { kind: "pause" } },
      });

      await vi.advanceTimersByTimeAsync(100);

      expect(coordinator.getState().status).toBe("completed");
    } finally {
      coordinator.dispose();
      ports.events.close();
      vi.useRealTimers();
    }
  });

  it("watchdog満了時に外部eventなしでRunを失敗させる", async () => {
    vi.useFakeTimers();
    const ports = harness();
    const coordinator = createRuntimeCoordinator(ports);
    try {
      const plan = planWithOnly("expression");
      await coordinator.prepare(plan);
      await coordinator.play();

      await vi.advanceTimersByTimeAsync(plan.cues[0]!.timeoutMs);

      expect(coordinator.getState()).toMatchObject({
        status: "failed",
        failure: { code: "cue_timeout" },
      });
    } finally {
      coordinator.dispose();
      ports.events.close();
      vi.useRealTimers();
    }
  });
});
