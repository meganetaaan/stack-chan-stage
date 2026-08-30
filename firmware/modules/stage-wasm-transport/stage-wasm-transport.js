/** Adapter for the Host.Stage callback bridge injected by the browser simulator. */
export function createStageWasmTransport(stage = globalThis.Host?.Stage) {
  if (!stage) throw new Error("Host.Stage bridge is unavailable");
  let unsubscribe;

  const start = (onCommand) => {
    if (typeof stage.subscribeCommand !== "function")
      throw new Error("Host.Stage.subscribeCommand is unavailable");
    unsubscribe = stage.subscribeCommand(onCommand);
  };
  const stop = () => {
    unsubscribe?.();
    unsubscribe = undefined;
  };
  const send = (event) => {
    if (typeof stage.emitEvent !== "function")
      throw new Error("Host.Stage.emitEvent is unavailable");
    stage.emitEvent(event);
  };

  const awaitPlayback = async (streamId, onStarted) => {
    if (typeof stage.playAudio !== "function")
      throw new Error("Host.Stage.playAudio is unavailable");
    const playback = stage.playAudio(streamId, onStarted);
    if (typeof onStarted === "function" && stage.playAudio.length < 2)
      onStarted();
    await playback;
  };

  const abortActive = async (reason = "Cue cancelled") => {
    if (typeof stage.abortAudio === "function") await stage.abortAudio(reason);
  };

  return Object.freeze({ start, stop, send, awaitPlayback, abortActive });
}
