import { issue, type ValidationIssue } from "../shared";
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
  const scope = plan.scenes[scene.id];
  const assignments: Record<string, (typeof plan.global.assignments)[string]> =
    {};
  const issues: ValidationIssue[] = [];

  for (const role of roles) {
    const actorId =
      scope?.assignments[role.id] ??
      plan.global.assignments[role.id] ??
      scope?.standInActorId ??
      plan.global.standInActorId;
    if (actorId) assignments[role.id] = actorId;
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
        cast: { sceneId: scene.id, assignments } as ResolvedSceneCast,
      };
};
