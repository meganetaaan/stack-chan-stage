import type { CueExecutionId } from "@stackchan-stage/domain";

export type ExecutionOutcome = Readonly<
  | { status: "completed" }
  | { status: "failed"; code: string; message: string; retryable: boolean }
>;

type Entry = Readonly<{
  executionId: CueExecutionId;
  status: "active" | "settled";
  outcome?: ExecutionOutcome;
  touchedAt: number;
}>;

export type ExecutionRegistry = Readonly<{
  begin: (
    executionId: CueExecutionId,
  ) =>
    | Readonly<{ duplicate: false }>
    | Readonly<{ duplicate: true; outcome?: ExecutionOutcome }>;
  settle: (executionId: CueExecutionId, outcome: ExecutionOutcome) => void;
  hasActive: (executionId: CueExecutionId) => boolean;
  size: () => number;
}>;

export const createExecutionRegistry = (
  maximumEntries = 128,
  now = () => Date.now(),
): ExecutionRegistry => {
  const entries = new Map<CueExecutionId, Entry>();
  const prune = () => {
    if (entries.size <= maximumEntries) return;
    const settled = [...entries.values()]
      .filter((entry) => entry.status === "settled")
      .sort((left, right) => left.touchedAt - right.touchedAt);
    while (entries.size > maximumEntries && settled.length > 0)
      entries.delete(settled.shift()!.executionId);
  };
  return {
    begin(executionId) {
      const existing = entries.get(executionId);
      if (existing) {
        entries.set(executionId, { ...existing, touchedAt: now() });
        return existing.outcome === undefined
          ? { duplicate: true }
          : { duplicate: true, outcome: existing.outcome };
      }
      entries.set(executionId, {
        executionId,
        status: "active",
        touchedAt: now(),
      });
      prune();
      return { duplicate: false };
    },
    settle(executionId, outcome) {
      entries.set(executionId, {
        executionId,
        status: "settled",
        outcome,
        touchedAt: now(),
      });
      prune();
    },
    hasActive: (executionId) => entries.get(executionId)?.status === "active",
    size: () => entries.size,
  };
};
