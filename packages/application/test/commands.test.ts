import { describe, expect, it, vi } from "vitest";

import {
  asAssetId,
  asCueId,
  asLaneId,
  asSceneId,
} from "@stackchan-stage/domain";
import {
  actorFixture,
  castFixture,
  scenarioFixture,
} from "../../domain/test/fixtures";
import {
  createWorkspaceStore,
  dispatchWorkspaceCommand,
  type WorkspaceState,
} from "../src";

const initialState = (): WorkspaceState => ({
  scenario: scenarioFixture(),
  castPlan: castFixture(),
  actors: [actorFixture()],
  revision: 7,
  runtime: { status: "idle" },
});

describe("Workspace command dispatcher", () => {
  it("expectedRevisionが古い変更を適用しない", () => {
    const state = initialState();
    const result = dispatchWorkspaceCommand(state, {
      type: "scene.update",
      expectedRevision: 6,
      sceneId: state.scenario.scenes[0]!.id,
      title: "競合する変更",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "revision_conflict",
      currentRevision: 7,
    });
    expect(result.state).toBe(state);
  });

  it("Cue作成・移動・削除をimmutableに適用しrevisionを進める", () => {
    const state = initialState();
    const scene = state.scenario.scenes[0]!;
    const lane = scene.lanes[0];
    const created = dispatchWorkspaceCommand(state, {
      type: "cue.create",
      expectedRevision: 7,
      sceneId: scene.id,
      laneId: lane.id,
      index: 1,
      cue: { id: asCueId("cue-new"), kind: "pause", durationMs: 250 },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.newRevision).toBe(8);
    expect(created.state.scenario).not.toBe(state.scenario);
    expect(created.state.scenario.scenes[0]!.lanes[0].cues[1]?.id).toBe(
      "cue-new",
    );

    const moved = dispatchWorkspaceCommand(created.state, {
      type: "cue.move",
      expectedRevision: 8,
      sceneId: scene.id,
      laneId: lane.id,
      cueId: asCueId("cue-new"),
      toIndex: 0,
    });
    expect(
      moved.ok && moved.state.scenario.scenes[0]!.lanes[0].cues[0]?.id,
    ).toBe("cue-new");
  });

  it("変更後validationに失敗した場合はstateを保持する", () => {
    const state = initialState();
    const result = dispatchWorkspaceCommand(state, {
      type: "cue.create",
      expectedRevision: 7,
      sceneId: state.scenario.scenes[0]!.id,
      laneId: state.scenario.scenes[0]!.lanes[0].id,
      cue: {
        id: asCueId("bad-asset"),
        kind: "backdrop.set",
        assetId: asAssetId("missing"),
        transition: { kind: "cut" },
      },
    });
    expect(result).toMatchObject({ ok: false, code: "validation_failed" });
    expect(result.state).toBe(state);
  });

  it("Project全体をScenario・Cast・素材Blobの組として置換する", () => {
    const state = initialState();
    const scenario = { ...state.scenario, title: "読み込んだ演目" };
    const castPlan = { global: { assignments: {} }, scenes: {} };
    const result = dispatchWorkspaceCommand(state, {
      type: "project.replace",
      expectedRevision: 7,
      scenario,
      castPlan,
      assetBlobs: [
        {
          id: state.scenario.assets[0]!.id,
          blob: new Blob(["asset"], { type: "image/webp" }),
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      newRevision: 8,
      state: { scenario, castPlan },
    });
  });

  it("UI/WebMCP共通storeが成功時だけpersist・通知する", async () => {
    const persist = vi.fn(async () => undefined);
    const listener = vi.fn();
    const store = createWorkspaceStore(initialState(), persist);
    store.subscribe(listener);
    const result = await store.dispatch({
      type: "scene.create",
      expectedRevision: 7,
      scene: {
        id: asSceneId("scene-second"),
        title: "第二幕",
        lanes: [{ id: asLaneId("lane-second"), name: "Main", cues: [] }],
      },
    });
    expect(result.ok).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
  });

  it("persist失敗時はstateを公開せず、後続commandを処理できる", async () => {
    const persist = vi
      .fn<(state: WorkspaceState) => Promise<void>>()
      .mockRejectedValueOnce(new Error("quota exceeded"))
      .mockResolvedValue(undefined);
    const listener = vi.fn();
    const store = createWorkspaceStore(initialState(), persist);
    store.subscribe(listener);
    const command = {
      type: "scene.update" as const,
      expectedRevision: 7,
      sceneId: initialState().scenario.scenes[0]!.id,
      title: "永続化後に公開",
    };

    await expect(store.dispatch(command)).rejects.toThrow("quota exceeded");
    expect(store.getSnapshot().revision).toBe(7);
    expect(listener).not.toHaveBeenCalled();

    await expect(store.dispatch(command)).resolves.toMatchObject({ ok: true });
    expect(store.getSnapshot()).toMatchObject({
      revision: 8,
      scenario: { scenes: [{ title: "永続化後に公開" }] },
    });
    expect(listener).toHaveBeenCalledOnce();
  });
});
