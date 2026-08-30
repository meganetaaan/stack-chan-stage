import {
  issue,
  ownRecordValue,
  type ActorId,
  type ValidationIssue,
} from "../shared";
import type { CastPlan, Role, Scene } from "../scenario/types";
import type { ResolvedSceneCast } from "./types";

export type ResolveCastResult =
  | Readonly<{ ok: true; cast: ResolvedSceneCast }>
  | Readonly<{ ok: false; issues: readonly ValidationIssue[] }>;

export const resolveSceneCast = (
  scene: Scene,
  roles: readonly Role[],
  plan: CastPlan,
): ResolveCastResult => {
  const scope = ownRecordValue(plan.scenes, scene.id);
  const assignments: Array<readonly [string, ActorId]> = [];
  const issues: ValidationIssue[] = [];

  for (const role of roles) {
    const actorId =
      (scope ? ownRecordValue(scope.assignments, role.id) : undefined) ??
      ownRecordValue(plan.global.assignments, role.id) ??
      scope?.standInActorId ??
      plan.global.standInActorId;
    if (actorId) assignments.push([role.id, actorId]);
    else
      issues.push(
        issue(
          "cast.unresolved_role",
          `Scene「${scene.title}」のRole「${role.name}」が未配役です`,
          ["cast", scene.id, role.id],
        ),
      );
  }

  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        cast: {
          sceneId: scene.id,
          assignments: Object.fromEntries(assignments),
        },
      };
};
