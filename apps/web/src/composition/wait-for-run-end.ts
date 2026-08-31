import type { RuntimeState } from "@stackchan-stage/domain";

export type RunEndCoordinator = Readonly<{
  getState: () => RuntimeState;
  stop: () => Promise<void>;
  subscribe: (listener: (state: RuntimeState) => void) => () => void;
}>;

const isTerminal = (state: RuntimeState) =>
  ["completed", "failed", "idle"].includes(state.status);

export const waitForRunEnd = (
  coordinator: RunEndCoordinator,
  signal: AbortSignal,
) =>
  new Promise<RuntimeState>((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (state: RuntimeState) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      signal.removeEventListener("abort", abort);
      resolve(state);
    };
    const abort = () => {
      void coordinator.stop().then(() => finish(coordinator.getState()));
    };
    const registeredUnsubscribe = coordinator.subscribe((state) => {
      if (isTerminal(state)) finish(state);
    });
    unsubscribe = registeredUnsubscribe;
    if (settled) {
      registeredUnsubscribe();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    const current = coordinator.getState();
    if (isTerminal(current)) finish(current);
  });
