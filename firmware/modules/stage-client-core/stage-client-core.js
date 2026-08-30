const terminalEventFor = (command, type, detail = {}) => ({
  type,
  protocolVersion: 1,
  sessionId: command.sessionId,
  runId: command.runId,
  cueExecutionId: command.cueExecutionId,
  actorId: command.actorId,
  ...detail,
});

const failureDetail = (error) => ({
  code: typeof error?.code === "string" ? error.code : "cue_execution_failed",
  message: String(error?.message ?? error ?? "Cue execution failed"),
  retryable: error?.retryable === true,
});

/**
 * Shared Cue application state machine used by the physical and WASM transports.
 * Transport and robot APIs are injected so this module stays deterministic and testable.
 */
export function createStageClientCore(options) {
  const {
    actorId,
    sessionId,
    send,
    applyCue,
    cancelCue = async () => {},
    now = () => Date.now(),
    maximumRememberedExecutions = 32,
  } = options;
  const executions = new Map();
  let activeExecutionId;

  const remember = (id, record) => {
    executions.delete(id);
    executions.set(id, record);
    while (executions.size > maximumRememberedExecutions) {
      const oldestEvictable = [...executions.keys()].find(
        (key) => key !== activeExecutionId,
      );
      if (oldestEvictable === undefined) break;
      executions.delete(oldestEvictable);
    }
  };

  const emit = (message) => {
    send(message);
    return message;
  };

  const finish = (record, terminal) => {
    if (record.terminal) return record.terminal;
    record.terminal = terminal;
    record.finishedAt = now();
    if (activeExecutionId === record.command.cueExecutionId)
      activeExecutionId = undefined;
    remember(record.command.cueExecutionId, record);
    return emit(terminal);
  };

  const startExecution = async (record) => {
    const { command } = record;
    let started = false;
    const markStarted = () => {
      if (started || record.terminal) return;
      started = true;
      emit(terminalEventFor(command, "cue.started"));
    };

    try {
      await applyCue(command, { markStarted });
      if (record.terminal) return;
      markStarted();
      finish(record, terminalEventFor(command, "cue.completed"));
    } catch (error) {
      finish(
        record,
        terminalEventFor(command, "cue.failed", failureDetail(error)),
      );
    }
  };

  const execute = (command) => {
    const previous = executions.get(command.cueExecutionId);
    if (previous) {
      emit(terminalEventFor(command, "cue.accepted", { duplicate: true }));
      if (previous.terminal) emit(previous.terminal);
      return previous.task;
    }

    const record = {
      command,
      acceptedAt: now(),
      terminal: undefined,
      task: undefined,
    };
    remember(command.cueExecutionId, record);
    emit(terminalEventFor(command, "cue.accepted", { duplicate: false }));

    if (activeExecutionId !== undefined) {
      const busy = terminalEventFor(command, "cue.failed", {
        code: "actor_busy",
        message: `Actor is already executing ${activeExecutionId}`,
        retryable: true,
      });
      finish(record, busy);
      record.task = Promise.resolve();
      return record.task;
    }

    activeExecutionId = command.cueExecutionId;
    record.task = startExecution(record);
    return record.task;
  };

  const cancel = async (command) => {
    const record = executions.get(command.cueExecutionId);
    if (!record || record.terminal) return;
    try {
      await cancelCue(command);
    } finally {
      finish(
        record,
        terminalEventFor(record.command, "cue.failed", {
          code: "cue_cancelled",
          message: "Cue was cancelled by the runtime",
          retryable: false,
        }),
      );
    }
  };

  const handleMessage = (message) => {
    if (message.sessionId !== sessionId) return Promise.resolve();
    if ("actorId" in message && message.actorId !== actorId)
      return Promise.resolve();

    switch (message.type) {
      case "heartbeat":
        emit({
          type: "heartbeat.ack",
          protocolVersion: 1,
          sessionId,
          sequence: message.sequence,
          receivedAt: now(),
        });
        return Promise.resolve();
      case "cue.execute":
        return execute(message);
      case "cue.cancel":
        return cancel(message);
      default:
        return Promise.resolve();
    }
  };

  return Object.freeze({
    handleMessage,
    activeExecutionId: () => activeExecutionId,
    rememberedExecutionCount: () => executions.size,
  });
}
