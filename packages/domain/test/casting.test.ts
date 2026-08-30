import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  asActorId,
  asRoleId,
  asSceneId,
  resolveSceneCast,
  validateCueForActor,
  type CastPlan,
  type Role,
} from "../src";
import {
  actorFixture,
  actorId,
  guestId,
  narratorId,
  scenarioFixture,
  secondActorId,
} from "./fixtures";

describe("Cast resolution", () => {
  it("Scene assignment → global assignment → Scene stand-in → global stand-inの順に解決する", () => {
    const scenario = scenarioFixture();
    const plan: CastPlan = {
      global: {
        assignments: { [narratorId]: actorId },
        standInActorId: asActorId("global-stand-in"),
      },
      scenes: {
        [scenario.scenes[0]!.id]: {
          assignments: { [narratorId]: secondActorId },
          standInActorId: asActorId("scene-stand-in"),
        },
      },
    };
    const result = resolveSceneCast(scenario.scenes[0]!, scenario.roles, plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cast.assignments[narratorId]).toBe(secondActorId);
    expect(result.cast.assignments[guestId]).toBe(asActorId("scene-stand-in"));
  });

  it("同一Actorによる兼役を許可する", () => {
    const scenario = scenarioFixture();
    const result = resolveSceneCast(scenario.scenes[0]!, scenario.roles, {
      global: { standInActorId: actorId, assignments: {} },
      scenes: {},
    });
    expect(
      result.ok && new Set(Object.values(result.cast.assignments)),
    ).toEqual(new Set([actorId]));
  });

  it("Object prototypeと同名のIDを配役として誤認しない", () => {
    const scene = {
      ...scenarioFixture().scenes[0]!,
      id: asSceneId("constructor"),
    };
    const result = resolveSceneCast(
      scene,
      [{ id: asRoleId("valueOf"), name: "prototype role" }],
      { global: { assignments: {} }, scenes: {} },
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: "cast.unresolved_role" }],
    });
  });

  it("任意のCastPlanで各Roleの解決先は0または1 Actorになる", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.array(
          fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
            nil: undefined,
          }),
          {
            minLength: 1,
            maxLength: 12,
          },
        ),
        (rawRoleIds, rawActors) => {
          const ids = [...new Set(rawRoleIds)];
          const roles: Role[] = ids.map((id) => ({
            id: asRoleId(id),
            name: id,
          }));
          const assignments = Object.fromEntries(
            ids.flatMap((id, index) => {
              const candidate = rawActors[index];
              return candidate ? [[id, asActorId(candidate)]] : [];
            }),
          );
          const scene = scenarioFixture().scenes[0]!;
          const result = resolveSceneCast(scene, roles, {
            global: { assignments },
            scenes: {},
          });
          if (!result.ok) return true;
          return roles.every((role) => {
            const resolved = result.cast.assignments[role.id];
            return typeof resolved === "string" && !Array.isArray(resolved);
          });
        },
      ),
    );
  });
});

describe("Actor capability", () => {
  it("Speechはplayback-ended ackまで要求する", () => {
    const cue = scenarioFixture().scenes[0]!.lanes[0].cues.find(
      (entry) => entry.kind === "speech",
    )!;
    const actor = actorFixture({
      capabilities: {
        ...actorFixture().capabilities,
        speech: {
          formats: [
            {
              codec: "opus",
              sampleRate: 24_000,
              channels: 1,
              frameDurationMs: 20,
            },
          ],
          streaming: true,
          playbackEndedAck: false,
        },
      },
    });
    expect(validateCueForActor(cue, actor)).toMatchObject([
      { code: "actor.capability_missing" },
    ]);
  });
});
