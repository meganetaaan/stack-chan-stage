import Timer from "timer";

import {
  abortPlayback,
  emitEvent,
  nextCommand,
  playbackStarted,
  playbackStatus,
  startBridge,
  startPlayback,
  stopBridge,
} from "stage-wasm-native";

const COMMAND_POLL_INTERVAL_MS = 8;
const PLAYBACK_POLL_INTERVAL_MS = 8;

/**
 * Adapter for the browser Host.Stage bridge. The browser object lives outside
 * the XS VM, so stage-wasm-native.c crosses the Emscripten boundary and this
 * module only handles JSON and polling inside XS.
 */
export function createStageWasmTransport() {
  let commandTimer;

  const start = (onCommand) => {
    stopBridge();
    if (!startBridge()) throw new Error("Host.Stage bridge is unavailable");
    if (commandTimer !== undefined) Timer.clear(commandTimer);

    const drain = () => {
      let serialized;
      while ((serialized = nextCommand()) !== undefined) {
        let command;
        try {
          command = JSON.parse(serialized);
        } catch (error) {
          trace(`[Stage] invalid command JSON: ${error}\n`);
          continue;
        }
        Promise.resolve(onCommand(command)).catch((error) =>
          trace(`[Stage] command failed: ${error}\n`),
        );
      }
    };

    commandTimer = Timer.repeat(drain, COMMAND_POLL_INTERVAL_MS);
    drain();
  };

  const stop = () => {
    if (commandTimer !== undefined) {
      Timer.clear(commandTimer);
      commandTimer = undefined;
    }
    stopBridge();
  };

  const send = (event) => {
    if (!emitEvent(JSON.stringify(event)))
      throw new Error("Host.Stage.emitEvent is unavailable");
  };

  const awaitPlayback = (streamId, onStarted) => {
    if (!startPlayback(streamId))
      return Promise.reject(new Error("Host.Stage.playAudio is unavailable"));

    return new Promise((resolve, reject) => {
      let markedStarted = false;
      let timer;
      const markStarted = () => {
        if (markedStarted) return;
        markedStarted = true;
        onStarted?.();
      };
      const poll = () => {
        if (playbackStarted()) markStarted();
        const status = playbackStatus();
        if (status === 0) return;
        if (timer !== undefined) Timer.clear(timer);
        if (status > 0) {
          markStarted();
          resolve();
        } else {
          reject(new Error("Host.Stage audio playback failed"));
        }
      };
      timer = Timer.repeat(poll, PLAYBACK_POLL_INTERVAL_MS);
      poll();
    });
  };

  const abortActive = async (reason = "Cue cancelled") => {
    abortPlayback(reason);
  };

  return Object.freeze({ start, stop, send, awaitPlayback, abortActive });
}
