import {
  createCue,
  createRole,
  createScene,
  deleteCue,
  deleteRole,
  deleteScene,
  importAssetMetadata,
  moveCue,
  updateCue,
  updateRole,
  updateScene,
  validateScenario,
  type Actor,
  type ActorId,
  type AssetMetadata,
  type CastPlan,
  type CastScope,
  type Cue,
  type CueId,
  type LaneId,
  type Role,
  type RoleId,
  type RuntimeState,
  type Scenario,
  type Scene,
  type SceneId,
  type ValidationIssue,
} from "@stackchan-stage/domain";

export type WorkspaceState = Readonly<{
  scenario: Scenario;
  castPlan: CastPlan;
  actors: readonly Actor[];
  revision: number;
  runtime: RuntimeState;
}>;

type Revisioned = Readonly<{ expectedRevision: number }>;

export type WorkspaceCommand =
  | (Revisioned &
      Readonly<{ type: "scene.create"; scene: Scene; index?: number }>)
  | (Revisioned &
      Readonly<{ type: "scene.update"; sceneId: SceneId; title: string }>)
  | (Revisioned & Readonly<{ type: "scene.delete"; sceneId: SceneId }>)
  | (Revisioned & Readonly<{ type: "role.create"; role: Role }>)
  | (Revisioned & Readonly<{ type: "role.update"; roleId: RoleId; role: Role }>)
  | (Revisioned & Readonly<{ type: "role.delete"; roleId: RoleId }>)
  | (Revisioned &
      Readonly<{
        type: "cue.create";
        sceneId: SceneId;
        laneId: LaneId;
        cue: Cue;
        index?: number;
      }>)
  | (Revisioned &
      Readonly<{
        type: "cue.update";
        sceneId: SceneId;
        laneId: LaneId;
        cueId: CueId;
        cue: Cue;
      }>)
  | (Revisioned &
      Readonly<{
        type: "cue.move";
        sceneId: SceneId;
        laneId: LaneId;
        cueId: CueId;
        toIndex: number;
      }>)
  | (Revisioned &
      Readonly<{
        type: "cue.delete";
        sceneId: SceneId;
        laneId: LaneId;
        cueId: CueId;
      }>)
  | (Revisioned & Readonly<{ type: "asset.import"; asset: AssetMetadata }>)
  | (Revisioned &
      Readonly<{
        type: "cast.set";
        scope: "global" | "scene";
        sceneId?: SceneId;
        cast: CastScope;
      }>)
  | (Revisioned & Readonly<{ type: "scenario.replace"; scenario: Scenario }>);

export type CommandSuccess = Readonly<{
  ok: true;
  state: WorkspaceState;
  newRevision: number;
  changedIds: readonly string[];
  validationIssues: readonly ValidationIssue[];
}>;

export type CommandFailure = Readonly<{
  ok: false;
  state: WorkspaceState;
  code: string;
  message: string;
  currentRevision: number;
  validationIssues: readonly ValidationIssue[];
}>;

export type CommandResult = CommandSuccess | CommandFailure;

const failure = (
  state: WorkspaceState,
  code: string,
  message: string,
  issues: readonly ValidationIssue[] = [],
): CommandFailure => ({
  ok: false,
  state,
  code,
  message,
  currentRevision: state.revision,
  validationIssues: issues,
});

export const dispatchWorkspaceCommand = (
  state: WorkspaceState,
  command: WorkspaceCommand,
): CommandResult => {
  if (command.expectedRevision !== state.revision) {
    return failure(
      state,
      "revision_conflict",
      `expectedRevision ${command.expectedRevision} は現在のrevision ${state.revision} と一致しません`,
    );
  }

  let scenario = state.scenario;
  let castPlan = state.castPlan;
  let changedIds: readonly string[] = [];
  let edit:
    | ReturnType<typeof createScene>
    | ReturnType<typeof createCue>
    | ReturnType<typeof createRole>
    | undefined;

  switch (command.type) {
    case "scene.create":
      edit = createScene(scenario, command.scene, command.index);
      break;
    case "scene.update":
      edit = updateScene(scenario, command.sceneId, command.title);
      break;
    case "scene.delete":
      edit = deleteScene(scenario, command.sceneId);
      break;
    case "role.create":
      edit = createRole(scenario, command.role);
      break;
    case "role.update":
      edit = updateRole(scenario, command.roleId, command.role);
      break;
    case "role.delete":
      edit = deleteRole(scenario, command.roleId);
      break;
    case "cue.create":
      edit = createCue(
        scenario,
        command.sceneId,
        command.laneId,
        command.cue,
        command.index,
      );
      break;
    case "cue.update":
      edit = updateCue(
        scenario,
        command.sceneId,
        command.laneId,
        command.cueId,
        command.cue,
      );
      break;
    case "cue.move":
      edit = moveCue(
        scenario,
        command.sceneId,
        command.laneId,
        command.cueId,
        command.toIndex,
      );
      break;
    case "cue.delete":
      edit = deleteCue(
        scenario,
        command.sceneId,
        command.laneId,
        command.cueId,
      );
      break;
    case "asset.import":
      edit = importAssetMetadata(scenario, command.asset);
      break;
    case "cast.set": {
      if (command.scope === "scene" && !command.sceneId)
        return failure(
          state,
          "cast.scene_required",
          "Scene scopeにはsceneIdが必要です",
        );
      if (command.scope === "global")
        castPlan = { ...castPlan, global: command.cast };
      else
        castPlan = {
          ...castPlan,
          scenes: { ...castPlan.scenes, [command.sceneId!]: command.cast },
        };
      changedIds =
        command.scope === "global"
          ? ["cast:global"]
          : [`cast:${command.sceneId}`];
      break;
    }
    case "scenario.replace":
      scenario = command.scenario;
      changedIds = [scenario.id];
      break;
  }

  if (edit) {
    if (!edit.ok)
      return failure(
        state,
        edit.issues[0]?.code ?? "edit_failed",
        edit.issues[0]?.message ?? "編集に失敗しました",
        edit.issues,
      );
    scenario = edit.scenario;
    changedIds = edit.changedIds;
  }

  const validationIssues = validateScenario(scenario);
  if (validationIssues.some((entry) => entry.severity === "error")) {
    return failure(
      state,
      "validation_failed",
      "変更後のScenarioが不正です",
      validationIssues,
    );
  }
  const next: WorkspaceState = {
    ...state,
    scenario,
    castPlan,
    revision: state.revision + 1,
  };
  return {
    ok: true,
    state: next,
    newRevision: next.revision,
    changedIds,
    validationIssues,
  };
};

export type WorkspaceStore = Readonly<{
  getSnapshot: () => WorkspaceState;
  dispatch: (command: WorkspaceCommand) => Promise<CommandResult>;
  setActors: (actors: readonly Actor[]) => void;
  setRuntime: (runtime: RuntimeState) => void;
  subscribe: (listener: () => void) => () => void;
}>;

export const createWorkspaceStore = (
  initial: WorkspaceState,
  persist?: (state: WorkspaceState) => Promise<void>,
): WorkspaceStore => {
  let state = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    getSnapshot: () => state,
    async dispatch(command) {
      const result = dispatchWorkspaceCommand(state, command);
      if (result.ok) {
        state = result.state;
        notify();
        await persist?.(state);
      }
      return result;
    },
    setActors(actors: readonly Actor[]) {
      state = { ...state, actors };
      notify();
    },
    setRuntime(runtime: RuntimeState) {
      state = { ...state, runtime };
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const actorAssignedTo = (
  plan: CastPlan,
  roleId: RoleId,
  sceneId?: SceneId,
): ActorId | undefined => {
  const scene = sceneId ? plan.scenes[sceneId] : undefined;
  return (
    scene?.assignments[roleId] ??
    plan.global.assignments[roleId] ??
    scene?.standInActorId ??
    plan.global.standInActorId
  );
};
