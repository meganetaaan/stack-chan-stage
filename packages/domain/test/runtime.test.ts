import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  asCueExecutionId,
  compileRun,
  reduceRuntime,
  type RunPlan,
  type RuntimeEvent,
  type RuntimeState,
} from "../src";
import {
  actorFixture,
  actorId,
  castFixture,
  scenarioFixture,
  sceneId,
} from "./fixtures";

const compileFixture = (): RunPlan => {
  const result = compileRun({
    scenario: scenarioFixture(),
    sceneIds: [sceneId],
    castPlan: castFixture(),
    actors: [actorFixture()],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.plan;
};

describe("Run compiler", () => {
  it("同じsnapshotから同じimmutable RunPlanを生成する", () => {
    const first = compileFixture();
    const second = compileFixture();
    expect(first).toEqual(second);
    expect(first.id).toBe(second.id);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.cues[0])).toBe(true);
    expect(first.casts[0]?.assignments).toMatchObject({
      "role-narrator": actorId,
      "role-guest": actorId,
    });
  });

  it("offline Actorをrejectする", () => {
    const result = compileRun({
      scenario: scenarioFixture(),
      sceneIds: [sceneId],
      castPlan: castFixture(),
      actors: [actorFixture({ availability: "offline" })],
    });
    expect(result.ok).toBe(false);
    expect(
      !result.ok &&
        result.issues.some((entry) => entry.code === "actor.offline"),
    ).toBe(true);
  });
});

describe("Runtime reducer", () => {
  const readyState = (): Extract<RuntimeState, { status: "ready" }> => {
    const plan = compileFixture();
    let transition = reduceRuntime(
      { status: "idle" },
      { type: "RUN_REQUESTED", plan },
    );
    expect(transition.state.status).toBe("preparing");
    const fingerprint = plan.speech[0]!.fingerprint;
    transition = reduceRuntime(transition.state, {
      type: "AUDIO_READY",
      fingerprint,
    });
    expect(transition.state.status).toBe("ready");
    return transition.state as Extract<RuntimeState, { status: "ready" }>;
  };

  it("Cue完了eventを待ち、順序外・重複eventを無視する", () => {
    const ready = readyState();
    let transition = reduceRuntime(ready, { type: "PLAY_REQUESTED" });
    expect(transition.state.status).toBe("playing");
    expect(transition.effects[0]?.type).toBe("stage.execute");
    if (transition.state.status !== "playing") return;

    const wrong = reduceRuntime(transition.state, {
      type: "CUE_COMPLETED",
      executionId: asCueExecutionId("old-execution"),
    });
    expect(wrong.state).toBe(transition.state);

    transition = reduceRuntime(transition.state, {
      type: "CUE_COMPLETED",
      executionId: transition.state.active.executionId,
    });
    expect(transition.state.status).toBe("playing");
    expect(transition.effects[0]?.type).toBe("actor.execute");
    if (transition.state.status !== "playing") return;
    expect(transition.state.active.cue.kind).toBe("speech");
  });

  it("timeoutでactive CueをcancelしRunをfailedにする", () => {
    const playing = reduceRuntime(readyState(), {
      type: "PLAY_REQUESTED",
    }).state;
    if (playing.status !== "playing") throw new Error("expected playing");
    const transition = reduceRuntime(playing, {
      type: "CUE_TIMEOUT",
      executionId: playing.active.executionId,
    });
    expect(transition.state.status).toBe("failed");
    expect(transition.effects.at(-1)).toMatchObject({ type: "run.cleanup" });
  });

  it("Cast済みActor切断で安全に停止する", () => {
    const state = readyState();
    const transition = reduceRuntime(state, {
      type: "ACTOR_DISCONNECTED",
      actorId,
    });
    expect(transition.state.status).toBe("failed");
    expect(transition.effects).toContainEqual({
      type: "run.cleanup",
      runId: state.plan.id,
    });
  });

  it("terminal stateからactor.execute effectを生成しない", () => {
    const plan = compileFixture();
    const terminal: RuntimeState = {
      status: "completed",
      plan,
      preparedAudio: [],
    };
    const events: RuntimeEvent[] = [
      { type: "PLAY_REQUESTED" },
      { type: "CUE_COMPLETED", executionId: plan.cues[0]!.executionId },
      { type: "CUE_TIMEOUT", executionId: plan.cues[0]!.executionId },
      { type: "ACTOR_DISCONNECTED", actorId },
      { type: "STOP_REQUESTED" },
    ];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: events.length - 1 }), (index) => {
        return reduceRuntime(terminal, events[index]!).effects.every(
          (effect) => effect.type !== "actor.execute",
        );
      }),
    );
  });
});
