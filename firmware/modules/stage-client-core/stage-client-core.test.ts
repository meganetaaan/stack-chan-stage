import { describe, expect, it, vi } from "vitest";

import { createStageClientCore } from "./stage-client-core.js";

const command = (id = "execution-1") => ({
  type: "cue.execute",
  protocolVersion: 1,
  sessionId: "session-1",
  runId: "run-1",
  cueExecutionId: id,
  actorId: "actor-1",
  cue: {
    id: "cue-1",
    kind: "expression",
    roleId: "role-1",
    expression: "HAPPY",
  },
});

describe("stage client core", () => {
  it("replays the terminal result without applying a duplicate Cue twice", async () => {
    const sent: Array<{ type: string; duplicate?: boolean }> = [];
    const applyCue = vi.fn(async (_message, lifecycle) =>
      lifecycle.markStarted(),
    );
    const core = createStageClientCore({
      actorId: "actor-1",
      sessionId: "session-1",
      send: (message: { type: string; duplicate?: boolean }) =>
        sent.push(message),
      applyCue,
      now: () => 42,
    });

    await core.handleMessage(command());
    await core.handleMessage(command());

    expect(applyCue).toHaveBeenCalledTimes(1);
    expect(sent.map(({ type, duplicate }) => [type, duplicate])).toEqual([
      ["cue.accepted", false],
      ["cue.started", undefined],
      ["cue.completed", undefined],
      ["cue.accepted", true],
      ["cue.completed", undefined],
    ]);
  });

  it("rejects a different concurrent Cue and acknowledges heartbeats", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: Array<Record<string, unknown>> = [];
    const core = createStageClientCore({
      actorId: "actor-1",
      sessionId: "session-1",
      send: (message: Record<string, unknown>) => sent.push(message),
      applyCue: async (
        _message: Record<string, unknown>,
        lifecycle: { markStarted: () => void },
      ) => {
        lifecycle.markStarted();
        await blocked;
      },
      now: () => 99,
    });

    const first = core.handleMessage(command("execution-1"));
    await core.handleMessage(command("execution-2"));
    await core.handleMessage({
      type: "heartbeat",
      protocolVersion: 1,
      sessionId: "session-1",
      sequence: 7,
      sentAt: 90,
    });
    release();
    await first;

    expect(
      sent.find(
        (message) =>
          message.cueExecutionId === "execution-2" &&
          message.type === "cue.failed",
      ),
    ).toMatchObject({
      code: "actor_busy",
      retryable: true,
    });
    expect(sent.at(-2)).toMatchObject({
      type: "heartbeat.ack",
      sequence: 7,
      receivedAt: 99,
    });
    expect(sent.at(-1)).toMatchObject({
      type: "cue.completed",
      cueExecutionId: "execution-1",
    });
  });

  it("turns cancellation into one stable terminal result", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: Array<Record<string, unknown>> = [];
    const cancelCue = vi.fn(async () => {});
    const core = createStageClientCore({
      actorId: "actor-1",
      sessionId: "session-1",
      send: (message: Record<string, unknown>) => sent.push(message),
      applyCue: async () => blocked,
      cancelCue,
    });

    const running = core.handleMessage(command());
    await core.handleMessage({ ...command(), type: "cue.cancel" });
    release();
    await running;

    expect(cancelCue).toHaveBeenCalledOnce();
    expect(
      sent.filter((message) => message.type === "cue.failed"),
    ).toHaveLength(1);
    expect(sent.at(-1)).toMatchObject({
      type: "cue.failed",
      code: "cue_cancelled",
    });
  });
});
