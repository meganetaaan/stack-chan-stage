#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>
#include <stdlib.h>

void xs_stackchan_stage_wasm_start_bridge(xsMachine* the)
{
	int available = EM_ASM_INT({
		let state = stackchanRuntime.state.stage;
		if (!state)
			state = stackchanRuntime.state.stage = {};
		if (state.unsubscribe) {
			state.unsubscribe();
			state.unsubscribe = undefined;
		}
		state.commands = [];
		const stage = stackchanRuntime.host && stackchanRuntime.host.Stage;
		if (!stage || (typeof stage.subscribeCommand !== "function"))
			return 0;
		state.unsubscribe = stage.subscribeCommand((command) => {
			try {
				state.commands.push(JSON.stringify(command));
			}
			catch (error) {
				console.error("[bridge] Host.Stage command serialization failed", error);
			}
		});
		return 1;
	});
	xsmcSetBoolean(xsResult, available);
}

void xs_stackchan_stage_wasm_stop_bridge(xsMachine* the)
{
	EM_ASM({
		const state = stackchanRuntime.state.stage;
		if (!state)
			return;
		if (state.unsubscribe)
			state.unsubscribe();
		state.unsubscribe = undefined;
		state.commands = [];
	});
}

void xs_stackchan_stage_wasm_next_command(xsMachine* the)
{
	int length = EM_ASM_INT({
		const state = stackchanRuntime.state.stage;
		if (!state || !state.commands || !state.commands.length)
			return 0;
		state.commandBytes = new TextEncoder().encode(state.commands.shift() + "\0");
		return state.commandBytes.byteLength;
	});
	if (length <= 0) {
		xsmcSetUndefined(xsResult);
		return;
	}

	char* serialized = malloc(length);
	if (!serialized)
		xsUnknownError("no memory");
	EM_ASM({
		const state = stackchanRuntime.state.stage;
		HEAPU8.set(state.commandBytes.subarray(0, $1), $0);
		state.commandBytes = undefined;
	}, serialized, length);
	xsmcSetString(xsResult, serialized);
	free(serialized);
}

void xs_stackchan_stage_wasm_emit_event(xsMachine* the)
{
	const char* serialized = xsmcToString(xsArg(0));
	int emitted = EM_ASM_INT({
		const stage = stackchanRuntime.host && stackchanRuntime.host.Stage;
		if (!stage || (typeof stage.emitEvent !== "function"))
			return 0;
		try {
			stage.emitEvent(JSON.parse(UTF8ToString($0)));
			return 1;
		}
		catch (error) {
			console.error("[bridge] Host.Stage event emission failed", error);
			return 0;
		}
	}, serialized);
	xsmcSetBoolean(xsResult, emitted);
}

void xs_stackchan_stage_wasm_start_playback(xsMachine* the)
{
	const char* streamId = xsmcToString(xsArg(0));
	int started = EM_ASM_INT({
		const stage = stackchanRuntime.host && stackchanRuntime.host.Stage;
		if (!stage || (typeof stage.playAudio !== "function"))
			return 0;
		const state = stackchanRuntime.state.stage || (stackchanRuntime.state.stage = {});
		const playback = {};
		playback.status = 0;
		playback.started = false;
		state.playback = playback;
		try {
			Promise.resolve(stage.playAudio(UTF8ToString($0), () => { playback.started = true; }))
				.then(() => { playback.status = 1; })
				.catch((error) => {
					playback.status = -1;
					console.error("[bridge] Host.Stage audio playback failed", error);
				});
		}
		catch (error) {
			playback.status = -1;
			console.error("[bridge] Host.Stage audio playback failed", error);
		}
		return 1;
	}, streamId);
	xsmcSetBoolean(xsResult, started);
}

void xs_stackchan_stage_wasm_playback_started(xsMachine* the)
{
	int started = EM_ASM_INT({
		const playback = stackchanRuntime.state.stage && stackchanRuntime.state.stage.playback;
		return playback && playback.started ? 1 : 0;
	});
	xsmcSetBoolean(xsResult, started);
}

void xs_stackchan_stage_wasm_playback_status(xsMachine* the)
{
	int status = EM_ASM_INT({
		const playback = stackchanRuntime.state.stage && stackchanRuntime.state.stage.playback;
		return playback && (typeof playback.status === "number") ? playback.status : -1;
	});
	xsmcSetInteger(xsResult, status);
}

void xs_stackchan_stage_wasm_abort_playback(xsMachine* the)
{
	const char* reason = (xsmcArgc > 0) ? xsmcToString(xsArg(0)) : "Cue cancelled";
	EM_ASM({
		const stage = stackchanRuntime.host && stackchanRuntime.host.Stage;
		if (stage && (typeof stage.abortAudio === "function"))
			Promise.resolve(stage.abortAudio(UTF8ToString($0))).catch((error) =>
				console.error("[bridge] Host.Stage audio abort failed", error));
	}, reason);
}
