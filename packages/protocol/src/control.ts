import { z } from "zod";

import {
  asActorId,
  asCueExecutionId,
  asRunId,
  cueSchema,
  type ActorCapabilities,
} from "@stackchan-stage/domain";

const nonEmpty = z.string().trim().min(1);
const protocolVersion = z.literal(1);
const sessionId = nonEmpty.max(128);
const actorId = nonEmpty.max(128).transform(asActorId);
const runId = nonEmpty.max(160).transform(asRunId);
const cueExecutionId = nonEmpty.max(256).transform(asCueExecutionId);

export const audioFormatSchema = z
  .object({
    codec: z.literal("opus"),
    sampleRate: z.number().int().positive().max(96_000),
    channels: z.literal(1),
    frameDurationMs: z.number().int().positive().max(120),
  })
  .strict();

export const actorCapabilitiesSchema: z.ZodType<ActorCapabilities> = z
  .object({
    protocolVersion,
    speech: z
      .object({
        formats: z.array(audioFormatSchema).min(1),
        streaming: z.boolean(),
        playbackEndedAck: z.boolean(),
      })
      .strict()
      .optional(),
    expressions: z.array(nonEmpty).optional(),
    motion: z
      .object({
        presets: z.array(nonEmpty),
        pose: z
          .object({
            axes: z.array(z.enum(["yaw", "pitch", "roll"])),
            duration: z.boolean(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    lighting: z
      .object({
        setColor: z.boolean(),
        effects: z.array(nonEmpty),
      })
      .strict()
      .optional(),
  })
  .strict() as z.ZodType<ActorCapabilities>;

export const actorHelloSchema = z
  .object({
    type: z.literal("actor.hello"),
    protocolVersion,
    sessionId,
    actor: z
      .object({
        id: actorId,
        name: nonEmpty.max(120),
        capabilities: actorCapabilitiesSchema,
      })
      .strict(),
  })
  .strict();

export const sessionAcceptedSchema = z
  .object({
    type: z.literal("session.accepted"),
    protocolVersion,
    sessionId,
    heartbeatIntervalMs: z.number().int().min(1_000).max(60_000),
  })
  .strict();

export const gatewayReadySchema = z
  .object({
    type: z.literal("gateway.ready"),
    protocolVersion,
    sessionId,
  })
  .strict();

export const actorOnlineSchema = z
  .object({
    type: z.literal("actor.online"),
    protocolVersion,
    sessionId,
    actor: z
      .object({
        id: actorId,
        name: nonEmpty.max(120),
        capabilities: actorCapabilitiesSchema,
      })
      .strict(),
  })
  .strict();

export const actorOfflineSchema = z
  .object({
    type: z.literal("actor.offline"),
    protocolVersion,
    sessionId,
    actorId,
    reason: nonEmpty.max(500),
  })
  .strict();

export const cueExecuteSchema = z
  .object({
    type: z.literal("cue.execute"),
    protocolVersion,
    sessionId,
    runId,
    cueExecutionId,
    actorId,
    cue: cueSchema,
    audio: z
      .object({
        streamId: nonEmpty.max(256),
        fingerprint: nonEmpty.max(128),
        format: audioFormatSchema,
        packetCount: z.number().int().nonnegative(),
        byteLength: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const cueCancelSchema = z
  .object({
    type: z.literal("cue.cancel"),
    protocolVersion,
    sessionId,
    runId,
    cueExecutionId,
    actorId,
  })
  .strict();

const cueEventBase = {
  protocolVersion,
  sessionId,
  runId,
  cueExecutionId,
  actorId,
};

export const cueAcceptedSchema = z
  .object({
    ...cueEventBase,
    type: z.literal("cue.accepted"),
    duplicate: z.boolean(),
  })
  .strict();

export const cueStartedSchema = z
  .object({ ...cueEventBase, type: z.literal("cue.started") })
  .strict();
export const cueCompletedSchema = z
  .object({ ...cueEventBase, type: z.literal("cue.completed") })
  .strict();
export const cueFailedSchema = z
  .object({
    ...cueEventBase,
    type: z.literal("cue.failed"),
    code: nonEmpty.max(120),
    message: nonEmpty.max(1_000),
    retryable: z.boolean(),
  })
  .strict();

export const heartbeatSchema = z
  .object({
    type: z.literal("heartbeat"),
    protocolVersion,
    sessionId,
    sequence: z.number().int().nonnegative(),
    sentAt: z.number().int().nonnegative(),
  })
  .strict();

export const heartbeatAckSchema = z
  .object({
    type: z.literal("heartbeat.ack"),
    protocolVersion,
    sessionId,
    sequence: z.number().int().nonnegative(),
    receivedAt: z.number().int().nonnegative(),
  })
  .strict();

export const controlMessageSchema = z.discriminatedUnion("type", [
  actorHelloSchema,
  sessionAcceptedSchema,
  gatewayReadySchema,
  actorOnlineSchema,
  actorOfflineSchema,
  cueExecuteSchema,
  cueCancelSchema,
  cueAcceptedSchema,
  cueStartedSchema,
  cueCompletedSchema,
  cueFailedSchema,
  heartbeatSchema,
  heartbeatAckSchema,
]);

export type ControlMessage = z.infer<typeof controlMessageSchema>;
export type ActorHelloMessage = z.infer<typeof actorHelloSchema>;
export type CueExecuteMessage = z.infer<typeof cueExecuteSchema>;
export type CueCancelMessage = z.infer<typeof cueCancelSchema>;
export type CueEventMessage = z.infer<
  | typeof cueAcceptedSchema
  | typeof cueStartedSchema
  | typeof cueCompletedSchema
  | typeof cueFailedSchema
>;

export const MAX_CONTROL_MESSAGE_BYTES = 64 * 1024;

export type DecodeResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: string; message: string }>;

export const decodeControlMessage = (
  input: string | Uint8Array,
): DecodeResult<ControlMessage> => {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (bytes.byteLength > MAX_CONTROL_MESSAGE_BYTES) {
    return {
      ok: false,
      code: "message_too_large",
      message: "Control message exceeds 64 KiB",
    };
  }
  try {
    const json = JSON.parse(
      typeof input === "string" ? input : new TextDecoder().decode(input),
    );
    const parsed = controlMessageSchema.safeParse(json);
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

export const encodeControlMessage = (message: ControlMessage): string =>
  JSON.stringify(controlMessageSchema.parse(message));
