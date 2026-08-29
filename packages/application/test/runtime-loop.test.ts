import { describe, expect, it, vi } from "vitest";

import {
  asAssetId,
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
    scenario: scenarioFixture(),
    sceneIds: [sceneId],
    castPlan: castFixture(),
    actors: [actorFixture()],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.plan;
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
});
