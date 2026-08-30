import { describe, expect, it, vi } from "vitest";

import {
  asCueExecutionId,
  asCueId,
  type PlannedSpeech,
} from "@stackchan-stage/domain";
import { createTtsAudioPreparationPort } from "../src";

const speech: PlannedSpeech = {
  cueId: asCueId("cue-1"),
  executionId: asCueExecutionId("execution-1"),
  fingerprint: "fingerprint-1",
  text: "こんにちは",
  voice: { provider: "browser", voiceId: "Kyoko", locale: "ja-JP" },
  estimatedBytes: 1024,
};

describe("TTS adapter", () => {
  it("endpoint未設定ではSpeechSynthesis descriptorをcacheする", async () => {
    const port = createTtsAudioPreparationPort();
    const first = await port.prepare(speech);
    const second = await port.prepare(speech);

    expect(first).toMatchObject({
      fingerprint: "fingerprint-1",
      mimeType: "application/x-speech-synthesis",
      providerData: { kind: "speech-synthesis", text: "こんにちは" },
    });
    expect(second).toBe(first);
  });

  it("HTTP endpointのpacket境界とbrowser fallback dataを保持する", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            format: {
              codec: "opus",
              sampleRate: 24_000,
              channels: 1,
              frameDurationMs: 20,
            },
            packets: ["AQI=", "AwQ="],
            audioBase64: "T2dnUw==",
            mimeType: "audio/ogg; codecs=opus",
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const port = createTtsAudioPreparationPort({
      endpoint: "https://tts.example.test/v1/speech",
      fetchImplementation,
    });

    const prepared = await port.prepare(speech);

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(prepared.data).toEqual(new TextEncoder().encode("OggS"));
    expect(prepared.providerData).toMatchObject({
      kind: "opus-packets",
      packets: [Uint8Array.of(1, 2), Uint8Array.of(3, 4)],
    });
  });

  it("HTTP endpointの未検証JSONを受理しない", async () => {
    const port = createTtsAudioPreparationPort({
      endpoint: "https://tts.example.test/v1/speech",
      fetchImplementation: async () =>
        new Response(
          JSON.stringify({
            format: {
              codec: "pcm",
              sampleRate: 44_100,
              channels: 2,
              frameDurationMs: 10,
            },
            packets: [42],
          }),
        ),
    });

    await expect(port.prepare(speech)).rejects.toThrow(
      "TTS endpoint returned an invalid response",
    );
  });
});
