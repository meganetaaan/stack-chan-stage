import { issue, type ValidationIssue } from "../shared";
import type { Cue, Scenario } from "./types";

const roleReferencedBy = (cue: Cue): string | undefined =>
  "roleId" in cue ? cue.roleId : undefined;
const assetReferencedBy = (cue: Cue): string | undefined =>
  "assetId" in cue ? cue.assetId : undefined;

export const validateScenario = (
  scenario: Scenario,
): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const roleIds = new Set<string>();
  const sceneIds = new Set<string>();
  const laneIds = new Set<string>();
  const cueIds = new Set<string>();
  const assetIds = new Set<string>();

  scenario.roles.forEach((role, index) => {
    if (roleIds.has(role.id))
      issues.push(
        issue("role.duplicate_id", `Role ID ${role.id} が重複しています`, [
          "roles",
          index,
          "id",
        ]),
      );
    roleIds.add(role.id);
  });
  scenario.assets.forEach((asset, index) => {
    if (assetIds.has(asset.id))
      issues.push(
        issue("asset.duplicate_id", `Asset ID ${asset.id} が重複しています`, [
          "assets",
          index,
          "id",
        ]),
      );
    assetIds.add(asset.id);
  });
  scenario.scenes.forEach((scene, sceneIndex) => {
    if (sceneIds.has(scene.id))
      issues.push(
        issue("scene.duplicate_id", `Scene ID ${scene.id} が重複しています`, [
          "scenes",
          sceneIndex,
          "id",
        ]),
      );
    sceneIds.add(scene.id);
    if (scene.lanes.length !== 1) {
      issues.push(
        issue(
          "scene.mvp_lane_count",
          "MVPではSceneごとにLaneを1本だけ指定できます",
          ["scenes", sceneIndex, "lanes"],
        ),
      );
    }
    scene.lanes.forEach((lane, laneIndex) => {
      if (laneIds.has(lane.id))
        issues.push(
          issue("lane.duplicate_id", `Lane ID ${lane.id} が重複しています`, [
            "scenes",
            sceneIndex,
            "lanes",
            laneIndex,
            "id",
          ]),
        );
      laneIds.add(lane.id);
      lane.cues.forEach((cue, cueIndex) => {
        const path = [
          "scenes",
          sceneIndex,
          "lanes",
          laneIndex,
          "cues",
          cueIndex,
        ] as const;
        if (cueIds.has(cue.id))
          issues.push(
            issue("cue.duplicate_id", `Cue ID ${cue.id} が重複しています`, [
              ...path,
              "id",
            ]),
          );
        cueIds.add(cue.id);
        const roleId = roleReferencedBy(cue);
        if (roleId && !roleIds.has(roleId))
          issues.push(
            issue("cue.role_not_found", `Role ${roleId} が存在しません`, [
              ...path,
              "roleId",
            ]),
          );
        const assetId = assetReferencedBy(cue);
        if (assetId && !assetIds.has(assetId))
          issues.push(
            issue("cue.asset_not_found", `Asset ${assetId} が存在しません`, [
              ...path,
              "assetId",
            ]),
          );
        if (assetId) {
          const asset = scenario.assets.find(
            (candidate) => candidate.id === assetId,
          );
          if (cue.kind === "backdrop.set" && asset?.kind !== "backdrop") {
            issues.push(
              issue("cue.asset_kind", "背景Cueにはbackdrop assetが必要です", [
                ...path,
                "assetId",
              ]),
            );
          }
          if (cue.kind === "music.start" && asset?.kind !== "music") {
            issues.push(
              issue("cue.asset_kind", "BGM Cueにはmusic assetが必要です", [
                ...path,
                "assetId",
              ]),
            );
          }
        }
      });
    });
  });
  return issues;
};
