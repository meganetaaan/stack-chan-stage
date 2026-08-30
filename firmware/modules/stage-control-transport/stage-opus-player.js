import AudioOut from "pins/audioout";
import OpusDecoder from "stackchanOpusDecoder";

/** Small Opus-to-AudioOut queue whose packet promises settle after playback. */
export function createStageOpusPlayer({ volume = 0.8 } = {}) {
  let decoder;
  let audio;
  let nextCallbackId = 1;
  const callbacks = new Map();
  const pendingWrites = new Set();

  const close = (error) => {
    audio?.close();
    decoder?.close();
    audio = undefined;
    decoder = undefined;
    for (const pending of callbacks.values()) {
      if (error) pending.reject(error);
      else pending.resolve();
    }
    callbacks.clear();
    pendingWrites.clear();
  };

  const open = async (format) => {
    close();
    decoder = new OpusDecoder(format.sampleRate, format.frameDurationMs);
    audio = new AudioOut({
      streams: 1,
      sampleRate: format.sampleRate,
      numChannels: 1,
      bitsPerSample: 16,
    });
    audio.enqueue(0, AudioOut.Flush);
    audio.enqueue(
      0,
      AudioOut.Volume,
      Math.round(Math.max(0, Math.min(1, volume)) * 256),
    );
    audio.callback = (id) => {
      const pending = callbacks.get(id);
      if (!pending) return;
      callbacks.delete(id);
      pending.resolve();
    };
    audio.start();
  };

  const writePacket = (packet) => {
    if (!decoder || !audio)
      return Promise.reject(new Error("Opus player is not open"));
    const pcm = new SharedArrayBuffer(decoder.outputBytes);
    const decodedBytes = decoder.decode(packet, pcm);
    if (decodedBytes !== pcm.byteLength)
      return Promise.reject(new Error("Opus decoder returned a partial frame"));
    const callbackId = nextCallbackId++;
    let playback;
    let settled = false;
    playback = new Promise((resolve, reject) => {
      callbacks.set(callbackId, {
        resolve: () => {
          settled = true;
          pendingWrites.delete(playback);
          resolve();
        },
        reject: (error) => {
          settled = true;
          pendingWrites.delete(playback);
          reject(error);
        },
        pcm,
      });
      try {
        audio.enqueue(0, AudioOut.RawSamples, pcm);
        audio.enqueue(0, AudioOut.Callback, callbackId);
      } catch (error) {
        callbacks.get(callbackId)?.reject(error);
        callbacks.delete(callbackId);
      }
    });
    if (!settled) pendingWrites.add(playback);
    return playback;
  };

  const finishPlayback = async () => {
    if (pendingWrites.size > 0) await Promise.all([...pendingWrites]);
    close();
  };

  const abort = async () => close(new Error("Audio playback aborted"));

  return Object.freeze({ open, writePacket, finishPlayback, abort });
}
