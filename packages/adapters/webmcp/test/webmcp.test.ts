import { describe, expect, it, vi } from "vitest";

import { createWorkspaceStore } from "@stackchan-stage/application";
import {
  asLaneId,
  asScenarioId,
  asSceneId,
  emptyCastPlan,
} from "@stackchan-stage/domain";
import {
  registerStageWebMcpTools,
  type WebMcpDocument,
  type WebMcpTool,
} from "../src";

const initialWorkspace = () => ({
  scenario: {
    schemaVersion: 1 as const,
    id: asScenarioId("scenario-1"),
    title: "テスト演目",
    roles: [],
    scenes: [
      {
        id: asSceneId("scene-1"),
        title: "第一場",
        lanes: [{ id: asLaneId("lane-1"), name: "本線", cues: [] }] as const,
      },
    ],
    assets: [],
  },
  castPlan: emptyCastPlan(),
  actors: [],
  revision: 0,
  runtime: { status: "idle" as const },
});

describe("WebMCP adapter", () => {
  it("15 toolsを現行Document APIへ登録し、read annotationを付ける", async () => {
    const tools = new Map<string, WebMcpTool>();
    const signals: AbortSignal[] = [];
    const registration = await registerStageWebMcpTools({
      store: createWorkspaceStore(initialWorkspace()),
      performance: {
        preview: vi.fn(async () => ({ ok: true })),
        play: vi.fn(async () => ({ ok: true })),
        stop: vi.fn(async () => ({ ok: true })),
      },
      importAsset: vi.fn(),
      document: {
        modelContext: {
          registerTool(
            tool: WebMcpTool,
            options?: Readonly<{ signal?: AbortSignal }>,
          ) {
            tools.set(tool.name, tool);
            if (options?.signal) signals.push(options.signal);
          },
        },
      } satisfies WebMcpDocument,
    });

    expect(registration.supported).toBe(true);
    expect(tools).toHaveLength(15);
    expect(tools.get("stage.workspace.get")?.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(tools.get("stage.asset.list")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.get("stage.scene.create")?.annotations?.readOnlyHint).not.toBe(
      true,
    );
    registration.dispose();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("Write toolがUIと同じrevision conflictを返す", async () => {
    const tools = new Map<string, WebMcpTool>();
    const store = createWorkspaceStore(initialWorkspace());
    await registerStageWebMcpTools({
      store,
      performance: {
        preview: async () => ({}),
        play: async () => ({}),
        stop: async () => ({}),
      },
      importAsset: vi.fn(),
      document: {
        modelContext: {
          registerTool(tool: WebMcpTool) {
            tools.set(tool.name, tool);
          },
        },
      } satisfies WebMcpDocument,
    });
    const execute = tools.get("stage.scene.update")!.execute;
    const signal = new AbortController().signal;

    await expect(
      execute(
        { expectedRevision: 0, sceneId: "scene-1", title: "更新後" },
        { signal },
      ),
    ).resolves.toMatchObject({ ok: true, newRevision: 1 });
    await expect(
      execute(
        { expectedRevision: 0, sceneId: "scene-1", title: "競合" },
        { signal },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "revision_conflict",
      currentRevision: 1,
    });
    expect(store.getSnapshot().scenario.scenes[0]?.title).toBe("更新後");
  });

  it("performance toolへ実行単位のAbortSignalを渡す", async () => {
    const tools = new Map<string, WebMcpTool>();
    const play = vi.fn(async () => ({ ok: true }));
    await registerStageWebMcpTools({
      store: createWorkspaceStore(initialWorkspace()),
      performance: { preview: async () => ({}), play, stop: async () => ({}) },
      importAsset: vi.fn(),
      document: {
        modelContext: {
          registerTool: (tool: WebMcpTool) => void tools.set(tool.name, tool),
        },
      } satisfies WebMcpDocument,
    });
    const execution = new AbortController();
    await tools
      .get("stage.performance.play")!
      .execute({ sceneIds: ["scene-1"] }, { signal: execution.signal });

    expect(play).toHaveBeenCalledWith(
      { sceneIds: ["scene-1"] },
      execution.signal,
    );
  });

  it("演目検証へ実行環境固有の音声検証結果を反映する", async () => {
    const tools = new Map<string, WebMcpTool>();
    const validate = vi.fn(() => ({
      ok: false,
      issues: [{ code: "speech.browser_voice_unavailable" }],
    }));
    await registerStageWebMcpTools({
      store: createWorkspaceStore(initialWorkspace()),
      performance: {
        validate,
        preview: async () => ({}),
        play: async () => ({}),
        stop: async () => ({}),
      },
      importAsset: vi.fn(),
      document: {
        modelContext: {
          registerTool: (tool: WebMcpTool) => void tools.set(tool.name, tool),
        },
      } satisfies WebMcpDocument,
    });

    await expect(
      tools.get("stage.scenario.validate")!.execute({}),
    ).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "speech.browser_voice_unavailable" }],
    });
    expect(validate).toHaveBeenCalledWith({});
  });

  it("実行オプションが省略された場合は登録単位のAbortSignalを使う", async () => {
    const tools = new Map<string, WebMcpTool>();
    const preview = vi.fn(async () => ({ ok: true }));
    let registrationSignal: AbortSignal | undefined;
    await registerStageWebMcpTools({
      store: createWorkspaceStore(initialWorkspace()),
      performance: { preview, play: async () => ({}), stop: async () => ({}) },
      importAsset: vi.fn(),
      document: {
        modelContext: {
          registerTool(
            tool: WebMcpTool,
            options?: Readonly<{ signal?: AbortSignal }>,
          ) {
            tools.set(tool.name, tool);
            registrationSignal = options?.signal;
          },
        },
      } satisfies WebMcpDocument,
    });

    await tools
      .get("stage.performance.preview")!
      .execute({ sceneIds: ["scene-1"], speechMode: "skip" });

    expect(registrationSignal).toBeInstanceOf(AbortSignal);
    expect(preview).toHaveBeenCalledWith(
      { sceneIds: ["scene-1"], speechMode: "skip" },
      registrationSignal,
    );
  });

  it("未定義のspeechModeをperformanceへ渡さない", async () => {
    const tools = new Map<string, WebMcpTool>();
    const preview = vi.fn(async () => ({ ok: true }));
    await registerStageWebMcpTools({
      store: createWorkspaceStore(initialWorkspace()),
      performance: { preview, play: async () => ({}), stop: async () => ({}) },
      importAsset: vi.fn(),
      document: {
        modelContext: {
          registerTool: (tool: WebMcpTool) => void tools.set(tool.name, tool),
        },
      } satisfies WebMcpDocument,
    });

    await expect(
      tools
        .get("stage.performance.preview")!
        .execute({ sceneIds: ["scene-1"], speechMode: "mute" }),
    ).resolves.toMatchObject({ ok: false, code: "invalid_input" });
    expect(preview).not.toHaveBeenCalled();
  });
});
