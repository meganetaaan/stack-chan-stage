const nativeStartBridge = native("xs_stackchan_stage_wasm_start_bridge");
const nativeStopBridge = native("xs_stackchan_stage_wasm_stop_bridge");
const nativeNextCommand = native("xs_stackchan_stage_wasm_next_command");
const nativeEmitEvent = native("xs_stackchan_stage_wasm_emit_event");
const nativeStartPlayback = native("xs_stackchan_stage_wasm_start_playback");
const nativePlaybackStarted = native(
  "xs_stackchan_stage_wasm_playback_started",
);
const nativePlaybackStatus = native("xs_stackchan_stage_wasm_playback_status");
const nativeAbortPlayback = native("xs_stackchan_stage_wasm_abort_playback");

export const startBridge = () => nativeStartBridge();
export const stopBridge = () => nativeStopBridge();
export const nextCommand = () => nativeNextCommand();
export const emitEvent = (serialized) => nativeEmitEvent(serialized);
export const startPlayback = (streamId) => nativeStartPlayback(streamId);
export const playbackStarted = () => nativePlaybackStarted();
export const playbackStatus = () => nativePlaybackStatus();
export const abortPlayback = (reason) => nativeAbortPlayback(reason);
