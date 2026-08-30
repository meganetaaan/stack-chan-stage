import type { StagePort } from "@stackchan-stage/application";
import type {
  AssetId,
  CueExecutionId,
  StageCueCommand,
} from "@stackchan-stage/domain";

export type StageAssetResolver = (
  assetId: AssetId,
) => Promise<Blob | string | undefined>;

export type StageAnimation = Readonly<{
  finished: Promise<unknown>;
  cancel: () => void;
}>;

export type StageAnimator = (
  element: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) => StageAnimation | undefined;

const browserAnimator: StageAnimator = (element, keyframes, options) =>
  typeof element.animate === "function"
    ? element.animate(keyframes, options)
    : undefined;

type MusicNodes = Readonly<{
  source: AudioBufferSourceNode;
  gain: GainNode;
}>;

const aborted = (signal: AbortSignal) =>
  signal.reason ?? new DOMException("Stage operation aborted", "AbortError");

const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(aborted(signal));
    const abort = () => {
      clearTimeout(timer);
      reject(aborted(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });

const animate = async (
  element: HTMLElement,
  keyframes: Keyframe[],
  duration: number,
  signal: AbortSignal,
  animateElement: StageAnimator,
) => {
  if (duration === 0) return;
  const animation = animateElement(element, keyframes, {
    duration,
    easing: "cubic-bezier(.2,.7,.2,1)",
    fill: "forwards",
  });
  if (!animation) {
    await wait(duration, signal);
    return;
  }
  const cancel = () => animation.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await animation.finished;
    if (signal.aborted) throw aborted(signal);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
};

const transitionFrames = (
  transition: Extract<
    StageCueCommand["cue"],
    { kind: "backdrop.set" }
  >["transition"],
): Keyframe[] => {
  if (transition.kind === "fade") return [{ opacity: 0 }, { opacity: 1 }];
  if (transition.kind === "cut") return [];
  const translations = {
    left: "translate3d(100%, 0, 0)",
    right: "translate3d(-100%, 0, 0)",
    up: "translate3d(0, 100%, 0)",
    down: "translate3d(0, -100%, 0)",
  } as const;
  return [
    { transform: translations[transition.direction] },
    { transform: "translate3d(0, 0, 0)" },
  ];
};

export type BrowserStagePort = StagePort &
  Readonly<{
    dispose: () => Promise<void>;
  }>;

export const createBrowserStagePort = ({
  root,
  resolveAsset,
  audioContext,
  createObjectUrl = URL.createObjectURL,
  revokeObjectUrl = URL.revokeObjectURL,
  animateElement = browserAnimator,
}: Readonly<{
  root: HTMLElement;
  resolveAsset: StageAssetResolver;
  audioContext?: AudioContext;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  animateElement?: StageAnimator;
}>): BrowserStagePort => {
  const operations = new Map<CueExecutionId, AbortController>();
  const operationTasks = new Set<Promise<void>>();
  let backdrop: HTMLElement | undefined;
  let backdropObjectUrl: string | undefined;
  let music: MusicNodes | undefined;

  root.style.position ||= "relative";
  root.style.overflow = "hidden";

  const resolveUrl = async (assetId: AssetId) => {
    const asset = await resolveAsset(assetId);
    if (!asset) throw new Error(`Stage asset ${assetId} is unavailable`);
    return typeof asset === "string"
      ? { url: asset, objectUrl: false }
      : { url: createObjectUrl(asset), objectUrl: true };
  };

  const stopMusic = async (
    fadeOutMs: number,
    signal: AbortSignal,
  ): Promise<void> => {
    const current = music;
    if (!current || !audioContext) return;
    music = undefined;
    const now = audioContext.currentTime;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(current.gain.gain.value, now);
    current.gain.gain.linearRampToValueAtTime(0, now + fadeOutMs / 1000);
    try {
      await wait(fadeOutMs, signal);
    } finally {
      try {
        current.source.stop();
      } catch {
        // The source may already have ended.
      }
      current.source.disconnect();
      current.gain.disconnect();
    }
  };

  const setBackdrop = async (
    cue: Extract<StageCueCommand["cue"], { kind: "backdrop.set" }>,
    signal: AbortSignal,
  ) => {
    const resolved = await resolveUrl(cue.assetId);
    if (signal.aborted) {
      if (resolved.objectUrl) revokeObjectUrl(resolved.url);
      throw aborted(signal);
    }
    const next = root.ownerDocument.createElement("div");
    next.dataset.stageBackdrop = cue.assetId;
    Object.assign(next.style, {
      position: "absolute",
      inset: "0",
      backgroundImage: `url(${JSON.stringify(resolved.url)})`,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "cover",
      zIndex: "0",
      willChange: "opacity, transform",
    });
    root.append(next);
    const duration =
      cue.transition.kind === "cut" ? 0 : cue.transition.durationMs;
    try {
      await animate(
        next,
        transitionFrames(cue.transition),
        duration,
        signal,
        animateElement,
      );
    } catch (error) {
      next.remove();
      if (resolved.objectUrl) revokeObjectUrl(resolved.url);
      throw error;
    }
    const previous = backdrop;
    const previousUrl = backdropObjectUrl;
    backdrop = next;
    backdropObjectUrl = resolved.objectUrl ? resolved.url : undefined;
    previous?.remove();
    if (previousUrl) revokeObjectUrl(previousUrl);
  };

  const startMusic = async (
    cue: Extract<StageCueCommand["cue"], { kind: "music.start" }>,
    signal: AbortSignal,
  ) => {
    if (!audioContext)
      throw new Error("Web Audio is unavailable for BGM playback");
    await stopMusic(0, signal);
    const asset = await resolveAsset(cue.assetId);
    if (!asset) throw new Error(`Music asset ${cue.assetId} is unavailable`);
    const bytes =
      typeof asset === "string"
        ? await fetch(asset, { signal }).then(async (response) => {
            if (!response.ok)
              throw new Error(
                `Music asset failed with HTTP ${response.status}`,
              );
            return response.arrayBuffer();
          })
        : await asset.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(bytes.slice(0));
    if (signal.aborted) throw aborted(signal);
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    source.loop = cue.loop;
    source.connect(gain);
    gain.connect(audioContext.destination);
    const now = audioContext.currentTime;
    gain.gain.setValueAtTime(cue.fadeInMs > 0 ? 0 : cue.volume, now);
    if (cue.fadeInMs > 0)
      gain.gain.linearRampToValueAtTime(cue.volume, now + cue.fadeInMs / 1000);
    music = { source, gain };
    source.start();
    try {
      await wait(cue.fadeInMs, signal);
    } catch (error) {
      if (music?.source === source) music = undefined;
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      source.disconnect();
      gain.disconnect();
      throw error;
    }
  };

  const execute = (command: StageCueCommand): Promise<void> => {
    const controller = new AbortController();
    operations.get(command.cueExecutionId)?.abort();
    operations.set(command.cueExecutionId, controller);
    const task = (async () => {
      try {
        switch (command.cue.kind) {
          case "backdrop.set":
            await setBackdrop(command.cue, controller.signal);
            break;
          case "music.start":
            await startMusic(command.cue, controller.signal);
            break;
          case "music.stop":
            await stopMusic(command.cue.fadeOutMs, controller.signal);
            break;
        }
      } finally {
        if (operations.get(command.cueExecutionId) === controller)
          operations.delete(command.cueExecutionId);
      }
    })();
    operationTasks.add(task);
    void task.then(
      () => operationTasks.delete(task),
      () => operationTasks.delete(task),
    );
    return task;
  };

  const stopAll = async () => {
    for (const controller of operations.values()) controller.abort();
    await Promise.allSettled([...operationTasks]);
    operations.clear();
    const cleanup = new AbortController();
    await stopMusic(0, cleanup.signal);
    backdrop?.remove();
    backdrop = undefined;
    if (backdropObjectUrl) revokeObjectUrl(backdropObjectUrl);
    backdropObjectUrl = undefined;
  };

  return {
    execute,
    async cancel(executionId) {
      operations.get(executionId)?.abort();
    },
    stopAll,
    dispose: stopAll,
  };
};
