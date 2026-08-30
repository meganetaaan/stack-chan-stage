import { z } from "zod";

import {
  asAssetId,
  asCueId,
  asLaneId,
  asRoleId,
  asScenarioId,
  asSceneId,
  type ValidationIssue,
} from "../shared";
import type { Cue, Scenario } from "./types";

const nonEmpty = z.string().trim().min(1);
const duration = z.number().int().nonnegative().max(3_600_000);
const roleId = nonEmpty.transform(asRoleId);
const assetId = nonEmpty.transform(asAssetId);
const cueBase = { id: nonEmpty.transform(asCueId), label: nonEmpty.optional() };

export const voiceProfileSchema = z
  .object({
    provider: nonEmpty,
    voiceId: nonEmpty,
    model: nonEmpty.optional(),
    locale: nonEmpty.optional(),
  })
  .strict();

const speechCueSchema = z
  .object({
    ...cueBase,
    kind: z.literal("speech"),
    roleId,
    text: nonEmpty.max(2_000),
    direction: nonEmpty.max(500).optional(),
    voiceOverride: voiceProfileSchema.optional(),
  })
  .strict();

const expressionCueSchema = z
  .object({
    ...cueBase,
    kind: z.literal("expression"),
    roleId,
    expression: nonEmpty,
  })
  .strict();

const motionCueSchema = z
  .object({
    ...cueBase,
    kind: z.literal("motion"),
    roleId,
    motion: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("preset"), name: nonEmpty }).strict(),
      z
        .object({
          kind: z.literal("pose"),
          yaw: z.number().finite().min(-Math.PI).max(Math.PI),
          pitch: z
            .number()
            .finite()
            .min(-Math.PI / 2)
            .max(Math.PI / 2),
          roll: z.number().finite().min(-Math.PI).max(Math.PI).optional(),
          durationMs: duration,
        })
        .strict(),
    ]),
  })
  .strict();

const lightingSetCueSchema = z
  .object({
    ...cueBase,
    kind: z.literal("lighting.set"),
    roleId,
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    brightness: z.number().min(0).max(1),
  })
  .strict();

const parameterValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);
const lightingPlayCueSchema = z
  .object({
    ...cueBase,
    kind: z.literal("lighting.play"),
    roleId,
    effect: nonEmpty,
    parameters: z.record(z.string(), parameterValueSchema).optional(),
  })
  .strict();

const backdropCueSchema = z
  .object({
    ...cueBase,
    kind: z.literal("backdrop.set"),
    assetId,
    transition: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("cut") }).strict(),
      z.object({ kind: z.literal("fade"), durationMs: duration }).strict(),
      z
        .object({
          kind: z.literal("slide"),
          direction: z.enum(["left", "right", "up", "down"]),
          durationMs: duration,
        })
        .strict(),
    ]),
  })
  .strict();

const musicStartCueSchema = z
  .object({
    ...cueBase,
    kind: z.literal("music.start"),
    assetId,
    loop: z.boolean(),
    volume: z.number().min(0).max(1),
    fadeInMs: duration,
  })
  .strict();

const musicStopCueSchema = z
  .object({ ...cueBase, kind: z.literal("music.stop"), fadeOutMs: duration })
  .strict();

const pauseCueSchema = z
  .object({ ...cueBase, kind: z.literal("pause"), durationMs: duration })
  .strict();

export const cueSchema: z.ZodType<Cue> = z.discriminatedUnion("kind", [
  speechCueSchema,
  expressionCueSchema,
  motionCueSchema,
  lightingSetCueSchema,
  lightingPlayCueSchema,
  backdropCueSchema,
  musicStartCueSchema,
  musicStopCueSchema,
  pauseCueSchema,
]);

const laneSchema = z
  .object({
    id: nonEmpty.transform(asLaneId),
    name: nonEmpty,
    cues: z.array(cueSchema),
  })
  .strict();

export const scenarioSchema: z.ZodType<Scenario> = z
  .object({
    schemaVersion: z.literal(1),
    id: nonEmpty.transform(asScenarioId),
    title: nonEmpty,
    roles: z.array(
      z
        .object({
          id: roleId,
          name: nonEmpty,
          description: nonEmpty.optional(),
          voice: voiceProfileSchema.optional(),
        })
        .strict(),
    ),
    scenes: z.array(
      z
        .object({
          id: nonEmpty.transform(asSceneId),
          title: nonEmpty,
          lanes: z.tuple([laneSchema]).rest(laneSchema),
        })
        .strict(),
    ),
    assets: z.array(
      z
        .object({
          id: assetId,
          kind: z.enum(["backdrop", "music"]),
          name: nonEmpty,
          mimeType: nonEmpty,
          byteSize: z.number().int().nonnegative(),
          digest: nonEmpty,
          sourceUrl: z.url().optional(),
          license: nonEmpty.optional(),
        })
        .strict(),
    ),
  })
  .strict();

export type ParseScenarioResult =
  | Readonly<{ ok: true; scenario: Scenario }>
  | Readonly<{ ok: false; issues: readonly ValidationIssue[] }>;

export const parseScenario = (input: unknown): ParseScenarioResult => {
  const result = scenarioSchema.safeParse(input);
  if (result.success) return { ok: true, scenario: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((entry) => ({
      code: "schema.invalid",
      message: entry.message,
      path: entry.path.map((part) =>
        typeof part === "symbol" ? String(part) : part,
      ),
      severity: "error",
    })),
  };
};
