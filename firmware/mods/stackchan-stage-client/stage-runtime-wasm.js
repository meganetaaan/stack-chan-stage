import { createStageWasmTransport } from "stage-wasm-transport";

export function createStageRuntimeEnvironment() {
  const transport = createStageWasmTransport();
  return Object.freeze({
    send: transport.send,
    start: transport.start,
    stop: transport.stop,
    media: Object.freeze({
      awaitPlayback: transport.awaitPlayback,
      abortActive: transport.abortActive,
    }),
  });
}
