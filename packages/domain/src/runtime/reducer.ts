import type {
  PlannedCue,
  RuntimeEffect,
  RuntimeEvent,
  RuntimeState,
  RuntimeTransition,
} from "./types";

const INITIAL_READY_SPEECH = 1;
const PREFETCH_SPEECH = 3;

const isStageCue = (
  cue: PlannedCue,
): cue is PlannedCue & {
  cue: Extract<
    PlannedCue["cue"],
    { kind: "backdrop.set" | "music.start" | "music.stop" }
  >;
} => ["backdrop.set", "music.start", "music.stop"].includes(cue.cue.kind);

const effectsForCue = (
  state: Extract<RuntimeState, { status: "ready" | "playing" }>,
  cue: PlannedCue,
): readonly RuntimeEffect[] => {
  if (cue.cue.kind === "pause") {
    return [
      {
        type: "timer.start",
        timerId: `pause:${cue.executionId}`,
        executionId: cue.executionId,
        durationMs: cue.cue.durationMs,
      },
    ];
  }
  if (isStageCue(cue)) {
    return [
      {
        type: "stage.execute",
        command: {
          runId: state.plan.id,
          cueExecutionId: cue.executionId,
          cue: cue.cue,
        },
        timeoutMs: cue.timeoutMs,
      },
    ];
  }
  if (!cue.actorId) return [];
  return [
    {
      type: "actor.execute",
      command: {
        protocolVersion: 1,
        runId: state.plan.id,
        cueExecutionId: cue.executionId,
        actorId: cue.actorId,
        cue: cue.cue,
        ...(cue.speech === undefined ? {} : { speech: cue.speech }),
      },
      timeoutMs: cue.timeoutMs,
    },
  ];
};

const beginAt = (
  state: Extract<RuntimeState, { status: "ready" | "playing" }>,
  cursor: number,
): RuntimeTransition => {
  const next = state.plan.cues[cursor];
  if (!next) {
    return {
      state: {
        status: "completed",
        plan: state.plan,
        preparedAudio: state.preparedAudio,
      },
      effects: [{ type: "run.cleanup", runId: state.plan.id }],
    };
  }
  if (next.speech && !state.preparedAudio.includes(next.speech.fingerprint)) {
    return {
      state: {
        status: "buffering",
        plan: state.plan,
        preparedAudio: state.preparedAudio,
        cursor,
        waitingFor: next.speech,
      },
      effects: [{ type: "audio.prepare", speech: next.speech }],
    };
  }
  const playing = {
    status: "playing" as const,
    plan: state.plan,
    preparedAudio: state.preparedAudio,
    cursor,
    active: next,
  };
  return { state: playing, effects: effectsForCue(playing, next) };
};

const fail = (
  state: Exclude<RuntimeState, { status: "idle" }>,
  code: string,
  message: string,
  executionId?: import("../shared").CueExecutionId,
): RuntimeTransition => {
  const active = state.status === "playing" ? state.active : undefined;
  const effects: RuntimeEffect[] = [];
  if (active?.actorId)
    effects.push({
      type: "actor.cancel",
      actorId: active.actorId,
      executionId: active.executionId,
    });
  effects.push({ type: "run.cleanup", runId: state.plan.id });
  return {
    state: {
      status: "failed",
      plan: state.plan,
      preparedAudio: state.preparedAudio,
      failure: {
        code,
        message,
        ...(executionId === undefined ? {} : { executionId }),
      },
    },
    effects,
  };
};

export const reduceRuntime = (
  state: RuntimeState,
  event: RuntimeEvent,
): RuntimeTransition => {
  if (
    event.type === "RESET" &&
    (state.status === "completed" || state.status === "failed")
  ) {
    return { state: { status: "idle" }, effects: [] };
  }
  if (state.status === "idle") {
    if (event.type !== "RUN_REQUESTED") return { state, effects: [] };
    const actorIds = [
      ...new Set(
        event.plan.cues.flatMap((cue) => (cue.actorId ? [cue.actorId] : [])),
      ),
    ];
    const initial = event.plan.speech.slice(0, INITIAL_READY_SPEECH);
    const prefetch = event.plan.speech.slice(
      INITIAL_READY_SPEECH,
      PREFETCH_SPEECH,
    );
    const preparing: RuntimeState = {
      status: "preparing",
      plan: event.plan,
      preparedAudio: [],
    };
    if (initial.length === 0)
      return {
        state: { ...preparing, status: "ready" },
        effects: actorIds.map((actorId) => ({
          type: "actor.connect",
          actorId,
        })),
      };
    return {
      state: preparing,
      effects: [
        ...actorIds.map((actorId): RuntimeEffect => ({
          type: "actor.connect",
          actorId,
        })),
        ...initial.map((speech): RuntimeEffect => ({
          type: "audio.prepare",
          speech,
        })),
        ...(prefetch.length > 0
          ? ([
              { type: "audio.prefetch", speech: prefetch },
            ] satisfies RuntimeEffect[])
          : []),
      ],
    };
  }

  if (
    event.type === "STOP_REQUESTED" &&
    ["preparing", "ready", "playing", "buffering"].includes(state.status)
  ) {
    const active = state.status === "playing" ? state.active : undefined;
    const effects: RuntimeEffect[] = [];
    if (active?.actorId)
      effects.push({
        type: "actor.cancel",
        executionId: active.executionId,
        actorId: active.actorId,
      });
    effects.push({ type: "run.cleanup", runId: state.plan.id });
    return {
      state: {
        status: "stopping",
        plan: state.plan,
        preparedAudio: state.preparedAudio,
        ...(state.status === "playing" || state.status === "buffering"
          ? { cursor: state.cursor }
          : {}),
        ...(active === undefined ? {} : { active }),
      },
      effects,
    };
  }

  if (state.status === "stopping") {
    return event.type === "CLEANUP_COMPLETED"
      ? { state: { status: "idle" }, effects: [] }
      : { state, effects: [] };
  }
  if (state.status === "completed" || state.status === "failed")
    return { state, effects: [] };

  if (event.type === "ACTOR_DISCONNECTED") {
    const castActor = state.plan.casts.some((cast) =>
      Object.values(cast.assignments).includes(event.actorId),
    );
    return castActor
      ? fail(
          state,
          "actor_disconnected",
          `Actor ${event.actorId} との接続が切れました`,
        )
      : { state, effects: [] };
  }

  if (event.type === "AUDIO_PREPARE_FAILED" && event.required) {
    return fail(state, "audio_prepare_failed", event.message);
  }

  if (event.type === "AUDIO_READY") {
    const preparedAudio = state.preparedAudio.includes(event.fingerprint)
      ? state.preparedAudio
      : [...state.preparedAudio, event.fingerprint];
    if (state.status === "preparing") {
      const required = state.plan.speech.slice(0, INITIAL_READY_SPEECH);
      const ready = required.every((speech) =>
        preparedAudio.includes(speech.fingerprint),
      );
      return {
        state: {
          ...state,
          status: ready ? "ready" : "preparing",
          preparedAudio,
        },
        effects: [],
      };
    }
    if (
      state.status === "buffering" &&
      event.fingerprint === state.waitingFor.fingerprint
    ) {
      return beginAt(
        { status: "ready", plan: state.plan, preparedAudio },
        state.cursor,
      );
    }
    return { state: { ...state, preparedAudio }, effects: [] };
  }

  if (state.status === "preparing") return { state, effects: [] };

  if (state.status === "ready") {
    return event.type === "PLAY_REQUESTED"
      ? beginAt(state, 0)
      : { state, effects: [] };
  }

  if (state.status === "buffering") return { state, effects: [] };

  if (event.type === "CUE_COMPLETED") {
    if (event.executionId !== state.active.executionId)
      return { state, effects: [] };
    return beginAt(state, state.cursor + 1);
  }
  if (
    event.type === "CUE_FAILED" &&
    event.executionId === state.active.executionId
  ) {
    return fail(state, "cue_failed", event.message, event.executionId);
  }
  if (
    event.type === "CUE_TIMEOUT" &&
    event.executionId === state.active.executionId
  ) {
    return fail(
      state,
      "cue_timeout",
      `Cue ${event.executionId} がタイムアウトしました`,
      event.executionId,
    );
  }
  return { state, effects: [] };
};
