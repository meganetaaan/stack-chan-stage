import { afterEach, describe, expect, it, vi } from "vitest";

import {
  asCueExecutionId,
  asCueId,
  type PlannedSpeech,
} from "@stackchan-stage/domain";
import {
  createPreparedAudioPlayback,
  createTtsAudioPreparationPort,
  resolveSpeechSynthesisVoice,
} from "../src";

const speech: PlannedSpeech = {
  cueId: asCueId("cue-1"),
  executionId: asCueExecutionId("execution-1"),
  fingerprint: "fingerprint-1",
  text: "こんにちは",
  voice: { provider: "browser", voiceId: "Kyoko", locale: "ja-JP" },
  estimatedBytes: 1024,
};

const japaneseVoice: SpeechSynthesisVoice = {
  default: false,
  lang: "ja-JP",
  localService: true,
  name: "Japanese",
  voiceURI: "speechd:Japanese",
};

const englishVoice: SpeechSynthesisVoice = {
  default: true,
  lang: "en-US",
  localService: true,
  name: "English",
  voiceURI: "speechd:English",
};

const speechSynthesisWith = (voices: readonly SpeechSynthesisVoice[]) => ({
  addEventListener: vi.fn(),
  cancel: vi.fn(),
  getVoices: vi.fn(() => [...voices]),
  removeEventListener: vi.fn(),
  speak: vi.fn(),
});

const encodeBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const oggCrc = (data: Uint8Array): number => {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit += 1)
      crc =
        (crc & 0x80000000) !== 0
          ? ((crc << 1) ^ 0x04c11db7) >>> 0
          : (crc << 1) >>> 0;
  }
  return crc >>> 0;
};

const parseOggPages = (data: Uint8Array) => {
  const pages: Array<{
    checksum: number;
    flags: number;
    granulePosition: bigint;
    packet: Uint8Array;
    sequence: number;
    validChecksum: boolean;
  }> = [];
  let offset = 0;
  while (offset < data.byteLength) {
    const segmentCount = data[offset + 26];
    if (segmentCount === undefined) throw new Error("Incomplete Ogg header");
    const segmentTable = data.subarray(offset + 27, offset + 27 + segmentCount);
    const packetLength = segmentTable.reduce(
      (sum, segmentLength) => sum + segmentLength,
      0,
    );
    const pageLength = 27 + segmentCount + packetLength;
    const page = data.slice(offset, offset + pageLength);
    const view = new DataView(page.buffer, page.byteOffset, page.byteLength);
    const checksum = view.getUint32(22, true);
    view.setUint32(22, 0, true);
    pages.push({
      checksum,
      flags: page[5] ?? 0,
      granulePosition: view.getBigUint64(6, true),
      packet: page.slice(27 + segmentCount),
      sequence: view.getUint32(18, true),
      validChecksum: oggCrc(page) === checksum,
    });
    offset += pageLength;
  }
  return pages;
};

afterEach(() => vi.unstubAllGlobals());

describe("TTS adapter", () => {
  it("default音声は指定localeと一致する利用可能な音声へ解決する", () => {
    expect(
      resolveSpeechSynthesisVoice([englishVoice, japaneseVoice], {
        voiceId: "default",
        locale: "ja-JP",
      }),
    ).toBe(japaneseVoice);
  });

  it("存在しない明示音声をブラウザ既定へ暗黙fallbackしない", () => {
    expect(() =>
      resolveSpeechSynthesisVoice([japaneseVoice], {
        voiceId: "Kyoko",
        locale: "ja-JP",
      }),
    ).toThrow("ブラウザ音声「Kyoko」は利用できません");
  });

  it("準備時に実際に解決したブラウザ音声をdescriptorへ記録する", async () => {
    const port = createTtsAudioPreparationPort({
      speechSynthesis: speechSynthesisWith([englishVoice, japaneseVoice]),
    });
    const prepared = await port.prepare({
      ...speech,
      voice: { ...speech.voice, voiceId: "default" },
    });

    expect(prepared.providerData).toMatchObject({
      kind: "speech-synthesis",
      localService: true,
      requestedVoiceId: "default",
      voiceId: "speechd:Japanese",
      voiceLocale: "ja-JP",
      voiceName: "Japanese",
    });
  });

  it("voiceschangedを待ってからブラウザ音声を準備する", async () => {
    let voices: readonly SpeechSynthesisVoice[] = [];
    let listener: EventListener | undefined;
    const speechSynthesis = {
      addEventListener: vi.fn(
        (_type: string, nextListener: EventListenerOrEventListenerObject) => {
          listener =
            typeof nextListener === "function"
              ? nextListener
              : (event) => nextListener.handleEvent(event);
        },
      ),
      cancel: vi.fn(),
      getVoices: vi.fn(() => [...voices]),
      removeEventListener: vi.fn(),
      speak: vi.fn(),
    };
    const port = createTtsAudioPreparationPort({
      speechSynthesis,
      voiceReadyTimeoutMs: 100,
    });
    const preparing = port.prepare({
      ...speech,
      voice: { ...speech.voice, voiceId: "default" },
    });
    voices = [japaneseVoice];
    listener?.(new Event("voiceschanged"));

    await expect(preparing).resolves.toMatchObject({
      providerData: { voiceId: "speechd:Japanese" },
    });
  });

  it("正常な連続発話はcancelや待機を挟まず順番に再生する", async () => {
    class FakeUtterance {
      lang = "";
      onend: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onstart: ((event: Event) => void) | null = null;
      voice: SpeechSynthesisVoice | null = null;

      constructor(readonly text: string) {}
    }
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const synthesis = speechSynthesisWith([japaneseVoice]);
    synthesis.speak.mockImplementation((utterance) => {
      Reflect.apply(utterance.onstart ?? (() => {}), utterance, [
        new Event("start"),
      ]);
      Reflect.apply(utterance.onend ?? (() => {}), utterance, [
        new Event("end"),
      ]);
    });
    const port = createTtsAudioPreparationPort({
      speechSynthesis: synthesis,
    });
    const prepared = await port.prepare({
      ...speech,
      voice: { ...speech.voice, voiceId: "default" },
    });
    const playback = createPreparedAudioPlayback({
      speechSynthesis: synthesis,
    });

    await playback(prepared, { signal: new AbortController().signal });
    await playback(prepared, { signal: new AbortController().signal });

    expect(synthesis.speak).toHaveBeenCalledTimes(2);
    expect(synthesis.cancel).not.toHaveBeenCalled();
  });

  it("endpoint未設定ではSpeechSynthesis descriptorをcacheする", async () => {
    const port = createTtsAudioPreparationPort({
      speechSynthesis: speechSynthesisWith([japaneseVoice]),
    });
    const browserSpeech = {
      ...speech,
      voice: { ...speech.voice, voiceId: "default" },
    };
    const first = await port.prepare(browserSpeech);
    const second = await port.prepare(browserSpeech);

    expect(first).toMatchObject({
      fingerprint: "fingerprint-1",
      mimeType: "application/x-speech-synthesis",
      providerData: { kind: "speech-synthesis", text: "こんにちは" },
    });
    expect(second).toBe(first);
  });

  it("Speech Synthesis非対応環境では再生descriptorを作らない", async () => {
    const port = createTtsAudioPreparationPort();

    await expect(port.prepare(speech)).rejects.toThrow(
      "このブラウザはSpeech Synthesisに対応していません",
    );
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

  it("raw Opus packetだけのendpoint応答を再生可能なOggへ組み立てる", async () => {
    const firstPacket = Uint8Array.from({ length: 255 }, (_, index) => index);
    const secondPacket = Uint8Array.of(0xf8, 0xff, 0xfe);
    const port = createTtsAudioPreparationPort({
      endpoint: "https://tts.example.test/v1/speech",
      fetchImplementation: async () =>
        new Response(
          JSON.stringify({
            format: {
              codec: "opus",
              sampleRate: 24_000,
              channels: 1,
              frameDurationMs: 20,
            },
            packets: [encodeBase64(firstPacket), encodeBase64(secondPacket)],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });

    const prepared = await port.prepare(speech);
    if (!prepared.data) throw new Error("Expected muxed Ogg audio");
    const pages = parseOggPages(prepared.data);
    const headPage = pages[0];
    const tagsPage = pages[1];
    if (!headPage || !tagsPage) throw new Error("Expected Ogg headers");

    expect(prepared.mimeType).toBe("audio/ogg; codecs=opus");
    expect(pages).toHaveLength(4);
    expect(pages.map((page) => page.sequence)).toEqual([0, 1, 2, 3]);
    expect(pages.map((page) => page.flags)).toEqual([0x02, 0, 0, 0x04]);
    expect(pages.map((page) => page.granulePosition)).toEqual([
      0n,
      0n,
      960n,
      1_920n,
    ]);
    expect(pages.every((page) => page.validChecksum)).toBe(true);
    expect(new TextDecoder().decode(headPage.packet.slice(0, 8))).toBe(
      "OpusHead",
    );
    expect(headPage.packet[9]).toBe(1);
    expect(
      new DataView(
        headPage.packet.buffer,
        headPage.packet.byteOffset,
        headPage.packet.byteLength,
      ).getUint32(12, true),
    ).toBe(24_000);
    expect(new TextDecoder().decode(tagsPage.packet.slice(0, 8))).toBe(
      "OpusTags",
    );
    expect(pages[2]?.packet).toEqual(firstPacket);
    expect(pages[3]?.packet).toEqual(secondPacket);
  });

  it("認証tokenをBearer headerで送り、request bodyへ含めない", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          format: {
            codec: "opus",
            sampleRate: 24_000,
            channels: 1,
            frameDurationMs: 20,
          },
          packets: ["AQID"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const port = createTtsAudioPreparationPort({
      endpoint: "https://tts.example.test/v1/speech",
      authorizationToken: "stage-secret-token",
      fetchImplementation,
    });

    await port.prepare(speech);

    const request = fetchImplementation.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      authorization: "Bearer stage-secret-token",
    });
    expect(request?.body).not.toContain("stage-secret-token");
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
