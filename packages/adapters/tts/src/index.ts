import type {
  AudioPreparationPort,
  PreparedAudio,
} from "@stackchan-stage/application";
import { asAssetId, type PlannedSpeech } from "@stackchan-stage/domain";
import { z } from "zod";

export const STAGE_OPUS_FORMAT = Object.freeze({
  codec: "opus" as const,
  sampleRate: 24_000,
  channels: 1 as const,
  frameDurationMs: 20,
});

export const DEFAULT_BROWSER_VOICE_ID = "default";
export const BROWSER_VOICE_READY_TIMEOUT_MS = 2_000;

const speechFallbackSchema = z
  .object({
    text: z.string(),
    voiceId: z.string(),
    locale: z.string().optional(),
  })
  .strict();

const preparedSpeechProviderDataSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("speech-synthesis"),
      text: z.string(),
      voiceId: z.string(),
      voiceName: z.string().optional(),
      voiceLocale: z.string().optional(),
      localService: z.boolean().optional(),
      requestedVoiceId: z.string().optional(),
      locale: z.string().optional(),
      direction: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("opus-packets"),
      format: z
        .object({
          codec: z.literal(STAGE_OPUS_FORMAT.codec),
          sampleRate: z.literal(STAGE_OPUS_FORMAT.sampleRate),
          channels: z.literal(STAGE_OPUS_FORMAT.channels),
          frameDurationMs: z.literal(STAGE_OPUS_FORMAT.frameDurationMs),
        })
        .strict(),
      packets: z.array(z.instanceof(Uint8Array)).min(1),
      fallback: speechFallbackSchema.optional(),
    })
    .strict(),
]);

export type PreparedSpeechProviderData = z.output<
  typeof preparedSpeechProviderDataSchema
>;

export type AudioCache = Readonly<{
  get: (fingerprint: string) => Promise<PreparedAudio | undefined>;
  put: (audio: PreparedAudio) => Promise<void>;
  delete: (assetId: string) => Promise<void>;
}>;

const createMemoryAudioCache = (): AudioCache => {
  const values = new Map<string, PreparedAudio>();
  return {
    get: async (fingerprint) => values.get(fingerprint),
    put: async (audio) => {
      values.set(audio.fingerprint, audio);
    },
    delete: async (assetId) => {
      for (const [fingerprint, audio] of values)
        if (audio.id === assetId) values.delete(fingerprint);
    },
  };
};

const decodeBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const base64BytesSchema = z.string().transform((value, context) => {
  try {
    return decodeBase64(value);
  } catch {
    context.addIssue({
      code: "custom",
      message: "Expected base64-encoded bytes",
    });
    return z.NEVER;
  }
});

const opusPacketSchema = base64BytesSchema.refine(
  (packet) => packet.byteLength > 0 && packet.byteLength <= 4_096,
  "Opus packet must contain between 1 and 4096 bytes",
);

const opusEndpointResponseSchema = z
  .object({
    format: z
      .object({
        codec: z.literal(STAGE_OPUS_FORMAT.codec),
        sampleRate: z.literal(STAGE_OPUS_FORMAT.sampleRate),
        channels: z.literal(STAGE_OPUS_FORMAT.channels),
        frameDurationMs: z.literal(STAGE_OPUS_FORMAT.frameDurationMs),
      })
      .strict(),
    packets: z.array(opusPacketSchema).min(1),
    audioBase64: base64BytesSchema.optional(),
    mimeType: z.string().trim().min(1).optional(),
  })
  .strict();

type SpeechSynthesisLike = Pick<
  SpeechSynthesis,
  "addEventListener" | "cancel" | "getVoices" | "removeEventListener" | "speak"
>;

const localeBase = (locale: string) => locale.toLowerCase().split("-")[0];

const matchesLocale = (voice: SpeechSynthesisVoice, locale: string) => {
  const expected = locale.toLowerCase();
  const actual = voice.lang.toLowerCase();
  return actual === expected || localeBase(actual) === localeBase(expected);
};

const describeVoices = (voices: readonly SpeechSynthesisVoice[]) =>
  voices
    .slice(0, 8)
    .map((voice) => `${voice.name} (${voice.lang})`)
    .join(", ");

export const resolveSpeechSynthesisVoice = (
  voices: readonly SpeechSynthesisVoice[],
  request: Readonly<{ voiceId: string; locale?: string | undefined }>,
): SpeechSynthesisVoice => {
  if (voices.length === 0)
    throw new Error("このブラウザでは音声合成用の音声を利用できません");

  if (request.voiceId !== DEFAULT_BROWSER_VOICE_ID) {
    const configured = voices.find(
      (voice) =>
        voice.voiceURI === request.voiceId || voice.name === request.voiceId,
    );
    if (configured) return configured;
    throw new Error(
      `ブラウザ音声「${request.voiceId}」は利用できません。利用可能な音声: ${describeVoices(voices)}`,
    );
  }

  const requestedLocale = request.locale;
  const localeMatches = requestedLocale
    ? voices.filter((voice) => matchesLocale(voice, requestedLocale))
    : voices;
  const resolved =
    localeMatches.find((voice) => voice.default) ??
    localeMatches.find((voice) => voice.localService) ??
    localeMatches[0] ??
    voices.find((voice) => voice.default) ??
    voices[0];
  if (!resolved)
    throw new Error("このブラウザでは音声合成用の音声を利用できません");
  return resolved;
};

const waitForSpeechSynthesisVoices = async (
  speechSynthesis: SpeechSynthesisLike,
  signal?: AbortSignal,
  timeoutMs = 2_000,
): Promise<readonly SpeechSynthesisVoice[]> => {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const available = speechSynthesis.getVoices();
  if (available.length > 0) return available;

  return await new Promise<readonly SpeechSynthesisVoice[]>(
    (resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeout !== undefined) clearTimeout(timeout);
        speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const onVoicesChanged = () => {
        const voices = speechSynthesis.getVoices();
        if (voices.length === 0) return;
        cleanup();
        resolve(voices);
      };

      speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
      signal?.addEventListener("abort", onAbort, { once: true });
      timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `ブラウザ音声を${timeoutMs}ms以内に読み込めませんでした。Opus TTS endpointを設定するか、音声を除外してプレビューしてください`,
          ),
        );
      }, timeoutMs);
    },
  );
};

const speechSynthesisAudio = (
  speech: PlannedSpeech,
  voice: SpeechSynthesisVoice,
): PreparedAudio => ({
  id: asAssetId(`speech-${speech.fingerprint}`),
  fingerprint: speech.fingerprint,
  mimeType: "application/x-speech-synthesis",
  byteSize: new TextEncoder().encode(speech.text).byteLength,
  providerData: {
    kind: "speech-synthesis",
    text: speech.text,
    voiceId: voice.voiceURI || voice.name,
    voiceName: voice.name,
    voiceLocale: voice.lang,
    localService: voice.localService,
    requestedVoiceId: speech.voice.voiceId,
    ...(speech.voice.locale ? { locale: speech.voice.locale } : {}),
    ...(speech.direction ? { direction: speech.direction } : {}),
  } satisfies PreparedSpeechProviderData,
});

const parseEndpointResponse = (
  value: unknown,
  speech: PlannedSpeech,
): PreparedAudio => {
  const parsed = opusEndpointResponseSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      `TTS endpoint returned an invalid response: ${z.prettifyError(parsed.error)}`,
    );
  const { packets, audioBase64: data, mimeType } = parsed.data;
  const byteSize = packets.reduce((sum, packet) => sum + packet.byteLength, 0);
  return {
    id: asAssetId(`speech-${speech.fingerprint}`),
    fingerprint: speech.fingerprint,
    mimeType: mimeType ?? "audio/ogg; codecs=opus",
    byteSize,
    ...(data ? { data } : {}),
    providerData: {
      kind: "opus-packets",
      format: STAGE_OPUS_FORMAT,
      packets,
      fallback: {
        text: speech.text,
        voiceId: speech.voice.voiceId,
        ...(speech.voice.locale ? { locale: speech.voice.locale } : {}),
      },
    } satisfies PreparedSpeechProviderData,
  };
};

export const createTtsAudioPreparationPort = ({
  endpoint,
  authorizationToken,
  cache = createMemoryAudioCache(),
  fetchImplementation = globalThis.fetch,
  speechSynthesis = globalThis.speechSynthesis,
  voiceReadyTimeoutMs = BROWSER_VOICE_READY_TIMEOUT_MS,
}: Readonly<{
  endpoint?: string;
  authorizationToken?: string;
  cache?: AudioCache;
  fetchImplementation?: typeof fetch;
  speechSynthesis?: SpeechSynthesisLike;
  voiceReadyTimeoutMs?: number;
}> = {}): AudioPreparationPort => ({
  async get(fingerprint) {
    const cached = await cache.get(fingerprint);
    // Browser voices depend on the current browser and OS. Route cached browser
    // speech through prepare() so the live voice inventory is checked first.
    if (cached && !endpoint) return undefined;
    return cached;
  },
  async prepare(speech, signal) {
    if (!endpoint) {
      if (!speechSynthesis)
        throw new Error(
          "このブラウザはSpeech Synthesisに対応していません。ブラウザ再生可能な音声を返すOpus TTS endpointを設定してください",
        );
      const voice = resolveSpeechSynthesisVoice(
        await waitForSpeechSynthesisVoices(
          speechSynthesis,
          signal,
          voiceReadyTimeoutMs,
        ),
        speech.voice,
      );
      const cached = await cache.get(speech.fingerprint);
      const provider = preparedSpeechProviderDataSchema.safeParse(
        cached?.providerData,
      );
      const resolvedVoiceId = voice.voiceURI || voice.name;
      if (
        cached &&
        provider.success &&
        provider.data.kind === "speech-synthesis" &&
        provider.data.voiceId === resolvedVoiceId &&
        provider.data.requestedVoiceId === speech.voice.voiceId &&
        provider.data.locale === speech.voice.locale
      )
        return cached;
      const prepared = speechSynthesisAudio(speech, voice);
      await cache.put(prepared);
      return prepared;
    }
    const cached = await cache.get(speech.fingerprint);
    if (cached) return cached;
    const response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorizationToken
          ? { authorization: `Bearer ${authorizationToken}` }
          : {}),
      },
      body: JSON.stringify({
        text: speech.text,
        direction: speech.direction,
        voice: speech.voice,
        format: STAGE_OPUS_FORMAT,
      }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok)
      throw new Error(`TTS endpoint failed with HTTP ${response.status}`);
    const prepared = parseEndpointResponse(await response.json(), speech);
    await cache.put(prepared);
    return prepared;
  },
  release: (assetId) => cache.delete(assetId),
});

type AudioContextLike = Pick<
  AudioContext,
  "createBufferSource" | "decodeAudioData" | "destination"
>;

const playWithSpeechSynthesis = (
  data:
    | Extract<PreparedSpeechProviderData, { kind: "speech-synthesis" }>
    | NonNullable<
        Extract<
          PreparedSpeechProviderData,
          { kind: "opus-packets" }
        >["fallback"]
      >,
  options: Readonly<{
    signal: AbortSignal;
    onStarted?: () => void;
    speechSynthesis: SpeechSynthesisLike;
    Utterance: typeof SpeechSynthesisUtterance;
  }>,
) => {
  const voice = resolveSpeechSynthesisVoice(
    options.speechSynthesis.getVoices(),
    data,
  );
  return new Promise<void>((resolve, reject) => {
    const utterance = new options.Utterance(data.text);
    utterance.voice = voice;
    if (data.locale) utterance.lang = data.locale;
    const abort = () => {
      options.speechSynthesis.cancel();
      reject(
        options.signal.reason ?? new DOMException("Aborted", "AbortError"),
      );
    };
    options.signal.addEventListener("abort", abort, { once: true });
    utterance.onstart = () => options.onStarted?.();
    utterance.onend = () => {
      options.signal.removeEventListener("abort", abort);
      resolve();
    };
    utterance.onerror = (event) => {
      options.signal.removeEventListener("abort", abort);
      reject(
        new Error(
          `Speech synthesis failed with ${voice.name} (${voice.lang}): ${event.error}`,
        ),
      );
    };
    options.speechSynthesis.speak(utterance);
  });
};

export const createPreparedAudioPlayback =
  ({
    audioContext,
    speechSynthesis = globalThis.speechSynthesis,
    Utterance = globalThis.SpeechSynthesisUtterance,
  }: Readonly<{
    audioContext?: AudioContextLike;
    speechSynthesis?: SpeechSynthesisLike;
    Utterance?: typeof SpeechSynthesisUtterance;
  }> = {}) =>
  async (
    audio: PreparedAudio,
    options: Readonly<{ signal: AbortSignal; onStarted?: () => void }>,
  ): Promise<void> => {
    const providerResult = preparedSpeechProviderDataSchema.safeParse(
      audio.providerData,
    );
    const provider = providerResult.success ? providerResult.data : undefined;
    if (audio.data && audioContext) {
      const decoded = await audioContext.decodeAudioData(
        audio.data.slice().buffer,
      );
      await new Promise<void>((resolve, reject) => {
        const source = audioContext.createBufferSource();
        source.buffer = decoded;
        source.connect(audioContext.destination);
        const abort = () => {
          source.stop();
          reject(
            options.signal.reason ?? new DOMException("Aborted", "AbortError"),
          );
        };
        options.signal.addEventListener("abort", abort, { once: true });
        source.onended = () => {
          options.signal.removeEventListener("abort", abort);
          source.disconnect();
          resolve();
        };
        source.start();
        options.onStarted?.();
      });
      return;
    }
    const fallback =
      provider?.kind === "opus-packets" ? provider.fallback : provider;
    if (!fallback || !speechSynthesis || !Utterance)
      throw new Error("No browser audio playback implementation is available");
    await playWithSpeechSynthesis(fallback, {
      ...options,
      speechSynthesis,
      Utterance,
    });
  };
