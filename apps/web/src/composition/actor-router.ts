import type { ActorEvent, ActorPort } from "@stackchan-stage/application";
import type {
  Actor,
  ActorCueCommand,
  ActorId,
  CueExecutionId,
} from "@stackchan-stage/domain";

export type ActorSource = Readonly<{
  port: ActorPort;
  subscribeActors?: (
    listener: (actors: readonly Actor[]) => void,
  ) => () => void;
  dispose?: () => void;
}>;

export type ActorRouter = ActorPort &
  Readonly<{
    addSource: (source: ActorSource) => Promise<() => void>;
    subscribeActors: (
      listener: (actors: readonly Actor[]) => void,
    ) => () => void;
    dispose: () => void;
  }>;

const createEventQueue = <T>() => {
  const values: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;
  return {
    push(value: T) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ done: false, value });
      else values.push(value);
    },
    iterable(signal?: AbortSignal): AsyncIterable<T> {
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              const value = values.shift();
              if (value !== undefined)
                return Promise.resolve({ done: false as const, value });
              if (closed || signal?.aborted)
                return Promise.resolve({
                  done: true as const,
                  value: undefined,
                });
              return new Promise<IteratorResult<T>>((resolve) => {
                const abort = () => resolve({ done: true, value: undefined });
                signal?.addEventListener("abort", abort, { once: true });
                waiters.push((result) => {
                  signal?.removeEventListener("abort", abort);
                  resolve(result);
                });
              });
            },
          };
        },
      };
    },
    close() {
      closed = true;
      while (waiters.length > 0)
        waiters.shift()?.({ done: true, value: undefined });
    },
  };
};

export const createActorRouter = (): ActorRouter => {
  const sources = new Set<ActorSource>();
  const actors = new Map<ActorId, Actor>();
  const routes = new Map<ActorId, ActorPort>();
  const cleanups = new Map<ActorSource, () => void>();
  const listeners = new Set<(actors: readonly Actor[]) => void>();
  const queue = createEventQueue<ActorEvent>();
  let disposed = false;

  const snapshot = () => [...actors.values()];
  const notify = () => {
    const value = snapshot();
    for (const listener of listeners) listener(value);
  };
  const updateSourceActors = (
    source: ActorSource,
    nextActors: readonly Actor[],
  ) => {
    for (const [id, port] of routes) {
      if (port !== source.port) continue;
      routes.delete(id);
      actors.delete(id);
    }
    for (const actor of nextActors) {
      actors.set(actor.id, actor);
      routes.set(actor.id, source.port);
    }
    notify();
  };
  const route = (actorId: ActorId): ActorPort => {
    const port = routes.get(actorId);
    if (!port) throw new Error(`Actor ${actorId} is unavailable`);
    return port;
  };

  return {
    async addSource(source) {
      if (disposed) throw new Error("Actor router is disposed");
      sources.add(source);
      const eventAbort = new AbortController();
      const unsubscribe = source.subscribeActors?.((nextActors) =>
        updateSourceActors(source, nextActors),
      );
      const pump = (async () => {
        try {
          for await (const event of source.port.events(eventAbort.signal))
            queue.push(event);
        } catch (error) {
          if (!eventAbort.signal.aborted)
            console.error("[actor-router] event source failed", error);
        }
      })();
      const remove = () => {
        if (!sources.delete(source)) return;
        eventAbort.abort();
        unsubscribe?.();
        source.dispose?.();
        void pump;
        updateSourceActors(source, []);
        cleanups.delete(source);
      };
      cleanups.set(source, remove);
      try {
        updateSourceActors(source, await source.port.listActors());
      } catch (error) {
        remove();
        throw error;
      }
      return remove;
    },
    async listActors() {
      return snapshot();
    },
    connect(actorId: ActorId) {
      return route(actorId).connect(actorId);
    },
    execute(command: ActorCueCommand) {
      return route(command.actorId).execute(command);
    },
    cancel(executionId: CueExecutionId, actorId: ActorId) {
      return route(actorId).cancel(executionId, actorId);
    },
    events: (signal) => queue.iterable(signal),
    subscribeActors(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      for (const cleanup of [...cleanups.values()]) cleanup();
      queue.close();
      listeners.clear();
      actors.clear();
      routes.clear();
    },
  };
};
