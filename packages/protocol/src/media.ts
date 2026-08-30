import { z } from "zod";

import { asActorId } from "@stackchan-stage/domain";
import { audioFormatSchema, type DecodeResult } from "./control";

const nonEmpty = z.string().trim().min(1);
const base = {
  protocolVersion: z.literal(1),
  sessionId: nonEmpty.max(128),
  actorId: nonEmpty.max(128).transform(asActorId),
};

export const mediaHelloSchema = z
  .object({
    ...base,
    type: z.literal("media.hello"),
  })
  .strict();

export const audioOpenSchema = z
  .object({
    ...base,
    type: z.literal("audio.open"),
    streamId: nonEmpty.max(256),
    cueExecutionId: nonEmpty.max(256),
    format: audioFormatSchema,
    packetCount: z.number().int().nonnegative(),
  })
  .strict();

export const audioCreditSchema = z
  .object({
    ...base,
    type: z.literal("audio.credit"),
    streamId: nonEmpty.max(256),
    packets: z.number().int().positive().max(4_096),
  })
  .strict();

export const audioEndSchema = z
  .object({
    ...base,
    type: z.literal("audio.end"),
    streamId: nonEmpty.max(256),
  })
  .strict();

export const audioAbortSchema = z
  .object({
    ...base,
    type: z.literal("audio.abort"),
    streamId: nonEmpty.max(256),
    reason: nonEmpty.max(500),
  })
  .strict();

export const mediaMessageSchema = z.discriminatedUnion("type", [
  mediaHelloSchema,
  audioOpenSchema,
  audioCreditSchema,
  audioEndSchema,
  audioAbortSchema,
]);

export type MediaMessage = z.infer<typeof mediaMessageSchema>;
export type AudioOpenMessage = z.infer<typeof audioOpenSchema>;
export type AudioCreditMessage = z.infer<typeof audioCreditSchema>;

export const MAX_MEDIA_JSON_BYTES = 16 * 1024;
export const MAX_OPUS_PACKET_BYTES = 4 * 1024;

export const decodeMediaMessage = (
  input: string | Uint8Array,
): DecodeResult<MediaMessage> => {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (bytes.byteLength > MAX_MEDIA_JSON_BYTES)
    return {
      ok: false,
      code: "message_too_large",
      message: "Media JSON exceeds 16 KiB",
    };
  try {
    const json = JSON.parse(
      typeof input === "string" ? input : new TextDecoder().decode(input),
    );
    const parsed = mediaMessageSchema.safeParse(json);
    if (!parsed.success)
      return {
        ok: false,
        code: "invalid_message",
        message: parsed.error.message,
      };
    return { ok: true, value: parsed.data };
  } catch (error) {
    return {
      ok: false,
      code: "invalid_json",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

export const validateOpusPacket = (
  input: ArrayBuffer | Uint8Array,
): DecodeResult<Uint8Array> => {
  const packet = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (packet.byteLength === 0)
    return {
      ok: false,
      code: "empty_packet",
      message: "Opus packet must not be empty",
    };
  if (packet.byteLength > MAX_OPUS_PACKET_BYTES) {
    return {
      ok: false,
      code: "packet_too_large",
      message: `Opus packet exceeds ${MAX_OPUS_PACKET_BYTES} bytes`,
    };
  }
  return { ok: true, value: packet };
};

export const encodeMediaMessage = (message: MediaMessage): string =>
  JSON.stringify(mediaMessageSchema.parse(message));
