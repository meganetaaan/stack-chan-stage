import {
  issue,
  type CueId,
  type LaneId,
  type RoleId,
  type SceneId,
  type ValidationIssue,
} from "../shared";
import type { AssetMetadata, Cue, Role, Scenario, Scene } from "./types";

export type ScenarioEditResult =
  | Readonly<{ ok: true; scenario: Scenario; changedIds: readonly string[] }>
  | Readonly<{ ok: false; issues: readonly ValidationIssue[] }>;

const failed = (
  code: string,
  message: string,
  path: readonly (string | number)[] = [],
): ScenarioEditResult => ({
  ok: false,
  issues: [issue(code, message, path)],
});

export const createScene = (
  scenario: Scenario,
  scene: Scene,
  index = scenario.scenes.length,
): ScenarioEditResult => {
  if (scenario.scenes.some((candidate) => candidate.id === scene.id)) {
    return failed(
      "scene.duplicate_id",
      `Scene ID ${scene.id} は既に存在します`,
      ["scenes"],
    );
  }
  if (index < 0 || index > scenario.scenes.length)
    return failed("scene.index_out_of_range", "Scene挿入位置が範囲外です");
  const scenes = [...scenario.scenes];
  scenes.splice(index, 0, scene);
  return {
    ok: true,
    scenario: { ...scenario, scenes },
    changedIds: [scene.id],
  };
};

export const updateScene = (
  scenario: Scenario,
  sceneId: SceneId,
  title: string,
): ScenarioEditResult => {
  if (!scenario.scenes.some((scene) => scene.id === sceneId)) {
    return failed("scene.not_found", `Scene ${sceneId} が存在しません`, [
      "scenes",
      sceneId,
    ]);
  }
  return {
    ok: true,
    scenario: {
      ...scenario,
      scenes: scenario.scenes.map((scene) =>
        scene.id === sceneId ? { ...scene, title } : scene,
      ),
    },
    changedIds: [sceneId],
  };
};

export const deleteScene = (
  scenario: Scenario,
  sceneId: SceneId,
): ScenarioEditResult => {
  if (!scenario.scenes.some((scene) => scene.id === sceneId)) {
    return failed("scene.not_found", `Scene ${sceneId} が存在しません`, [
      "scenes",
      sceneId,
    ]);
  }
  return {
    ok: true,
    scenario: {
      ...scenario,
      scenes: scenario.scenes.filter((scene) => scene.id !== sceneId),
    },
    changedIds: [sceneId],
  };
};

const locateLane = (scenario: Scenario, sceneId: SceneId, laneId: LaneId) => {
  const sceneIndex = scenario.scenes.findIndex((scene) => scene.id === sceneId);
  const laneIndex =
    sceneIndex < 0
      ? -1
      : scenario.scenes[sceneIndex]!.lanes.findIndex(
          (lane) => lane.id === laneId,
        );
  return { sceneIndex, laneIndex };
};

const replaceLane = (
  scenario: Scenario,
  sceneIndex: number,
  laneIndex: number,
  update: (cues: readonly Cue[]) => readonly Cue[],
): Scenario => {
  const scenes = [...scenario.scenes];
  const scene = scenes[sceneIndex]!;
  const lanes = [...scene.lanes] as [
    Scene["lanes"][number],
    ...Scene["lanes"][number][],
  ];
  const lane = lanes[laneIndex]!;
  lanes[laneIndex] = { ...lane, cues: update(lane.cues) };
  scenes[sceneIndex] = { ...scene, lanes };
  return { ...scenario, scenes };
};

export const createCue = (
  scenario: Scenario,
  sceneId: SceneId,
  laneId: LaneId,
  cue: Cue,
  index?: number,
): ScenarioEditResult => {
  if (
    scenario.scenes.some((scene) =>
      scene.lanes.some((lane) =>
        lane.cues.some((candidate) => candidate.id === cue.id),
      ),
    )
  ) {
    return failed("cue.duplicate_id", `Cue ID ${cue.id} は既に存在します`, [
      "cues",
    ]);
  }
  const { sceneIndex, laneIndex } = locateLane(scenario, sceneId, laneId);
  if (sceneIndex < 0)
    return failed("scene.not_found", `Scene ${sceneId} が存在しません`);
  if (laneIndex < 0)
    return failed("lane.not_found", `Lane ${laneId} が存在しません`);
  const lane = scenario.scenes[sceneIndex]!.lanes[laneIndex]!;
  const target = index ?? lane.cues.length;
  if (target < 0 || target > lane.cues.length)
    return failed("cue.index_out_of_range", "Cue挿入位置が範囲外です");
  return {
    ok: true,
    scenario: replaceLane(scenario, sceneIndex, laneIndex, (cues) => {
      const next = [...cues];
      next.splice(target, 0, cue);
      return next;
    }),
    changedIds: [cue.id, sceneId],
  };
};

export const updateCue = (
  scenario: Scenario,
  sceneId: SceneId,
  laneId: LaneId,
  cueId: CueId,
  cue: Cue,
): ScenarioEditResult => {
  const { sceneIndex, laneIndex } = locateLane(scenario, sceneId, laneId);
  if (sceneIndex < 0 || laneIndex < 0)
    return failed(
      "lane.not_found",
      `Scene/Lane ${sceneId}/${laneId} が存在しません`,
    );
  const current = scenario.scenes[sceneIndex]!.lanes[laneIndex]!.cues;
  if (!current.some((candidate) => candidate.id === cueId))
    return failed("cue.not_found", `Cue ${cueId} が存在しません`);
  if (
    cue.id !== cueId &&
    scenario.scenes.some((scene) =>
      scene.lanes.some((lane) =>
        lane.cues.some((candidate) => candidate.id === cue.id),
      ),
    )
  ) {
    return failed("cue.duplicate_id", `Cue ID ${cue.id} は既に存在します`);
  }
  return {
    ok: true,
    scenario: replaceLane(scenario, sceneIndex, laneIndex, (cues) =>
      cues.map((currentCue) => (currentCue.id === cueId ? cue : currentCue)),
    ),
    changedIds: cue.id === cueId ? [cueId] : [cueId, cue.id],
  };
};

export const moveCue = (
  scenario: Scenario,
  sceneId: SceneId,
  laneId: LaneId,
  cueId: CueId,
  toIndex: number,
): ScenarioEditResult => {
  const { sceneIndex, laneIndex } = locateLane(scenario, sceneId, laneId);
  if (sceneIndex < 0 || laneIndex < 0)
    return failed(
      "lane.not_found",
      `Scene/Lane ${sceneId}/${laneId} が存在しません`,
    );
  const cues = scenario.scenes[sceneIndex]!.lanes[laneIndex]!.cues;
  const fromIndex = cues.findIndex((cue) => cue.id === cueId);
  if (fromIndex < 0)
    return failed("cue.not_found", `Cue ${cueId} が存在しません`);
  if (toIndex < 0 || toIndex >= cues.length)
    return failed("cue.index_out_of_range", "Cue移動先が範囲外です");
  return {
    ok: true,
    scenario: replaceLane(scenario, sceneIndex, laneIndex, (current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved!);
      return next;
    }),
    changedIds: [cueId, sceneId],
  };
};

export const deleteCue = (
  scenario: Scenario,
  sceneId: SceneId,
  laneId: LaneId,
  cueId: CueId,
): ScenarioEditResult => {
  const { sceneIndex, laneIndex } = locateLane(scenario, sceneId, laneId);
  if (sceneIndex < 0 || laneIndex < 0)
    return failed(
      "lane.not_found",
      `Scene/Lane ${sceneId}/${laneId} が存在しません`,
    );
  const cues = scenario.scenes[sceneIndex]!.lanes[laneIndex]!.cues;
  if (!cues.some((cue) => cue.id === cueId))
    return failed("cue.not_found", `Cue ${cueId} が存在しません`);
  return {
    ok: true,
    scenario: replaceLane(scenario, sceneIndex, laneIndex, (current) =>
      current.filter((cue) => cue.id !== cueId),
    ),
    changedIds: [cueId, sceneId],
  };
};

export const createRole = (
  scenario: Scenario,
  role: Role,
): ScenarioEditResult => {
  if (scenario.roles.some((candidate) => candidate.id === role.id))
    return failed("role.duplicate_id", `Role ID ${role.id} は既に存在します`);
  return {
    ok: true,
    scenario: { ...scenario, roles: [...scenario.roles, role] },
    changedIds: [role.id],
  };
};

export const updateRole = (
  scenario: Scenario,
  roleId: RoleId,
  role: Role,
): ScenarioEditResult => {
  if (!scenario.roles.some((candidate) => candidate.id === roleId))
    return failed("role.not_found", `Role ${roleId} が存在しません`);
  if (
    role.id !== roleId &&
    scenario.roles.some((candidate) => candidate.id === role.id)
  )
    return failed("role.duplicate_id", `Role ID ${role.id} は既に存在します`);
  return {
    ok: true,
    scenario: {
      ...scenario,
      roles: scenario.roles.map((candidate) =>
        candidate.id === roleId ? role : candidate,
      ),
    },
    changedIds: role.id === roleId ? [roleId] : [roleId, role.id],
  };
};

export const deleteRole = (
  scenario: Scenario,
  roleId: RoleId,
): ScenarioEditResult => {
  const referenced = scenario.scenes.some((scene) =>
    scene.lanes.some((lane) =>
      lane.cues.some((cue) => "roleId" in cue && cue.roleId === roleId),
    ),
  );
  if (referenced)
    return failed("role.in_use", `Role ${roleId} はCueから参照されています`);
  if (!scenario.roles.some((role) => role.id === roleId))
    return failed("role.not_found", `Role ${roleId} が存在しません`);
  return {
    ok: true,
    scenario: {
      ...scenario,
      roles: scenario.roles.filter((role) => role.id !== roleId),
    },
    changedIds: [roleId],
  };
};

export const importAssetMetadata = (
  scenario: Scenario,
  asset: AssetMetadata,
): ScenarioEditResult => {
  const current = scenario.assets.find(
    (candidate) => candidate.id === asset.id,
  );
  if (current && current.digest !== asset.digest)
    return failed(
      "asset.id_conflict",
      `Asset ID ${asset.id} は別のdigestで使用済みです`,
    );
  if (current) return { ok: true, scenario, changedIds: [asset.id] };
  return {
    ok: true,
    scenario: { ...scenario, assets: [...scenario.assets, asset] },
    changedIds: [asset.id],
  };
};
