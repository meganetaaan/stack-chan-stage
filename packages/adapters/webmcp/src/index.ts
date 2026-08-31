import {
  type CommandResult,
  type WorkspaceCommand,
  type WorkspaceStore,
} from "@stackchan-stage/application";
import {
  asActorId,
  asCueId,
  asLaneId,
  asRunId,
  asSceneId,
  compileRun,
  cueSchema,
  type AssetMetadata,
} from "@stackchan-stage/domain";
import { z } from "zod";

type JsonSchema = Record<string, unknown>;

type WebMcpExecutionOptions = Readonly<{ signal?: AbortSignal }>;

export type WebMcpTool = Readonly<{
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: Readonly<{
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  }>;
  execute: (
    input: Record<string, unknown>,
    options?: WebMcpExecutionOptions,
  ) => Promise<unknown>;
}>;

export type ModelContextLike = Readonly<{
  registerTool: (
    tool: WebMcpTool,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) => Promise<void> | void;
}>;

declare global {
  interface Document {
    readonly modelContext?: ModelContextLike;
  }
}

export type WebMcpDocument = Readonly<{ modelContext?: ModelContextLike }>;

export type PerformanceTools = Readonly<{
  validate?: (
    input: Readonly<{ sceneIds?: readonly string[] }>,
  ) => Promise<unknown> | unknown;
  preview: (
    input: Readonly<{
      sceneIds?: readonly string[];
      fromCueId?: string;
      toCueId?: string;
      actorId?: string;
      speechMode?: "audible" | "skip";
    }>,
    signal: AbortSignal,
  ) => Promise<unknown>;
  play: (
    input: Readonly<{ sceneIds?: readonly string[] }>,
    signal: AbortSignal,
  ) => Promise<unknown>;
  stop: (signal: AbortSignal) => Promise<unknown>;
}>;

const emptySchema = z.object({}).strict();
const revision = z.number().int().nonnegative();
const id = z.string().trim().min(1).max(256);
const actorId = id.transform(asActorId);
const cueId = id.transform(asCueId);
const laneId = id.transform(asLaneId);
const sceneId = id.transform(asSceneId);
const laneSchema = z
  .object({
    id: laneId,
    name: z.string().trim().min(1).max(120),
    cues: z.array(cueSchema),
  })
  .strict();
const castSchema = z
  .object({
    assignments: z.record(z.string(), actorId),
    standInActorId: actorId.optional(),
  })
  .strict();

const schemas = {
  empty: emptySchema,
  sceneCreate: z
    .object({
      expectedRevision: revision,
      scene: z
        .object({
          id: sceneId,
          title: z.string().trim().min(1).max(200),
          lanes: z.tuple([laneSchema]).rest(laneSchema),
        })
        .strict(),
      index: z.number().int().nonnegative().optional(),
    })
    .strict(),
  sceneUpdate: z
    .object({
      expectedRevision: revision,
      sceneId,
      title: z.string().trim().min(1).max(200),
    })
    .strict(),
  sceneDelete: z.object({ expectedRevision: revision, sceneId }).strict(),
  cueCreate: z
    .object({
      expectedRevision: revision,
      sceneId,
      laneId,
      cue: cueSchema,
      index: z.number().int().nonnegative().optional(),
    })
    .strict(),
  cueUpdate: z
    .object({
      expectedRevision: revision,
      sceneId,
      laneId,
      cueId,
      cue: cueSchema,
    })
    .strict(),
  cueMove: z
    .object({
      expectedRevision: revision,
      sceneId,
      laneId,
      cueId,
      toIndex: z.number().int().nonnegative(),
    })
    .strict(),
  cueDelete: z
    .object({
      expectedRevision: revision,
      sceneId,
      laneId,
      cueId,
    })
    .strict(),
  assetImport: z
    .object({
      expectedRevision: revision,
      url: z.url(),
      kind: z.enum(["backdrop", "music"]),
      name: z.string().trim().min(1).max(200),
      license: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
  castSet: z
    .object({
      expectedRevision: revision,
      scope: z.enum(["global", "scene"]),
      sceneId: sceneId.optional(),
      cast: castSchema,
    })
    .strict(),
  preview: z
    .object({
      sceneIds: z.array(id).optional(),
      fromCueId: id.optional(),
      toCueId: id.optional(),
      actorId: id.optional(),
      speechMode: z.enum(["audible", "skip"]).optional(),
    })
    .strict(),
  play: z.object({ sceneIds: z.array(id).min(1).optional() }).strict(),
};

const jsonSchema = (schema: z.ZodType): JsonSchema =>
  z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;

const invalidInput = (error: z.ZodError) => ({
  ok: false,
  code: "invalid_input",
  message: "Tool input did not match the declared schema",
  issues: error.issues,
});

const parse = <T extends z.ZodType>(
  schema: T,
  input: Record<string, unknown>,
) => {
  const result = schema.safeParse(input);
  return result.success
    ? ({ ok: true, data: result.data } as const)
    : ({ ok: false, result: invalidInput(result.error) } as const);
};

const mutationResult = (result: CommandResult) =>
  result.ok
    ? {
        ok: true,
        newRevision: result.newRevision,
        changedIds: result.changedIds,
        validationIssues: result.validationIssues,
      }
    : {
        ok: false,
        code: result.code,
        message: result.message,
        currentRevision: result.currentRevision,
        validationIssues: result.validationIssues,
      };

const executionSignal = (
  options: WebMcpExecutionOptions | undefined,
  fallback: AbortSignal,
) => options?.signal ?? fallback;

const writeTool = <T extends z.ZodType>(
  definition: Omit<WebMcpTool, "execute" | "inputSchema">,
  schema: T,
  command: (input: z.output<T>) => WorkspaceCommand,
  store: WorkspaceStore,
): WebMcpTool => ({
  ...definition,
  inputSchema: jsonSchema(schema),
  async execute(input) {
    const parsed = parse(schema, input);
    if (!parsed.ok) return parsed.result;
    return mutationResult(await store.dispatch(command(parsed.data)));
  },
});

export type WebMcpRegistration = Readonly<{
  supported: boolean;
  toolNames: readonly string[];
  dispose: () => void;
}>;

export const registerStageWebMcpTools = async ({
  store,
  performance,
  importAsset,
  document: targetDocument = globalThis.document,
}: Readonly<{
  store: WorkspaceStore;
  performance: PerformanceTools;
  importAsset: (
    input: Readonly<{
      url: string;
      kind: "backdrop" | "music";
      name: string;
      license?: string;
    }>,
    signal: AbortSignal,
  ) => Promise<AssetMetadata>;
  document?: WebMcpDocument;
}>): Promise<WebMcpRegistration> => {
  const modelContext = targetDocument?.modelContext;
  if (!modelContext)
    return { supported: false, toolNames: [], dispose: () => {} };
  const registration = new AbortController();
  const readOnly = { readOnlyHint: true } as const;
  const untrustedReadOnly = {
    readOnlyHint: true,
    untrustedContentHint: true,
  } as const;

  const tools: WebMcpTool[] = [
    {
      name: "stage.workspace.get",
      title: "舞台ワークスペースを取得",
      description:
        "現在のScenario、Scene、Role、Asset、Actor、Cast、Runtime状態、revisionを返します。",
      inputSchema: jsonSchema(schemas.empty),
      annotations: untrustedReadOnly,
      async execute(input) {
        const parsed = parse(schemas.empty, input);
        return parsed.ok
          ? { ok: true, workspace: store.getSnapshot() }
          : parsed.result;
      },
    },
    {
      name: "stage.scenario.validate",
      title: "演目を検証",
      description:
        "Scenario参照、Cast、Actor capability、音声設定を検証し、Run可能性を返します。",
      inputSchema: jsonSchema(schemas.empty),
      annotations: untrustedReadOnly,
      async execute(input) {
        const parsed = parse(schemas.empty, input);
        if (!parsed.ok) return parsed.result;
        if (performance.validate) return await performance.validate({});
        const workspace = store.getSnapshot();
        const compiled = compileRun({
          runId: asRunId("run-validation"),
          scenario: workspace.scenario,
          sceneIds: workspace.scenario.scenes.map((scene) => scene.id),
          castPlan: workspace.castPlan,
          actors: workspace.actors,
        });
        return compiled.ok
          ? { ok: true, issues: [], cueCount: compiled.plan.cues.length }
          : { ok: false, issues: compiled.issues };
      },
    },
    writeTool(
      {
        name: "stage.scene.create",
        title: "場面を追加",
        description: "指定位置へ1本以上のLaneを持つSceneを追加します。",
      },
      schemas.sceneCreate,
      (input) => ({
        type: "scene.create",
        expectedRevision: input.expectedRevision,
        scene: input.scene,
        ...(input.index === undefined ? {} : { index: input.index }),
      }),
      store,
    ),
    writeTool(
      {
        name: "stage.scene.update",
        title: "場面を更新",
        description: "Sceneのtitleを更新します。",
      },
      schemas.sceneUpdate,
      (input) => ({
        type: "scene.update",
        expectedRevision: input.expectedRevision,
        sceneId: input.sceneId,
        title: input.title,
      }),
      store,
    ),
    writeTool(
      {
        name: "stage.scene.delete",
        title: "場面を削除",
        description: "SceneとそのLane/Cueを削除します。",
      },
      schemas.sceneDelete,
      (input) => ({
        type: "scene.delete",
        expectedRevision: input.expectedRevision,
        sceneId: input.sceneId,
      }),
      store,
    ),
    writeTool(
      {
        name: "stage.cue.create",
        title: "キューを追加",
        description:
          "Cue discriminated unionに従う完全なCueをLaneへ追加します。",
      },
      schemas.cueCreate,
      (input) => ({
        type: "cue.create",
        expectedRevision: input.expectedRevision,
        sceneId: input.sceneId,
        laneId: input.laneId,
        cue: input.cue,
        ...(input.index === undefined ? {} : { index: input.index }),
      }),
      store,
    ),
    writeTool(
      {
        name: "stage.cue.update",
        title: "キューを更新",
        description: "Cueをkindごとの完全な値で置き換えます。",
      },
      schemas.cueUpdate,
      (input) => ({
        type: "cue.update",
        expectedRevision: input.expectedRevision,
        sceneId: input.sceneId,
        laneId: input.laneId,
        cueId: input.cueId,
        cue: input.cue,
      }),
      store,
    ),
    writeTool(
      {
        name: "stage.cue.move",
        title: "キューを移動",
        description: "同じLane内でCueの順序を変更します。",
      },
      schemas.cueMove,
      (input) => ({
        type: "cue.move",
        expectedRevision: input.expectedRevision,
        sceneId: input.sceneId,
        laneId: input.laneId,
        cueId: input.cueId,
        toIndex: input.toIndex,
      }),
      store,
    ),
    writeTool(
      {
        name: "stage.cue.delete",
        title: "キューを削除",
        description: "LaneからCueを削除します。",
      },
      schemas.cueDelete,
      (input) => ({
        type: "cue.delete",
        expectedRevision: input.expectedRevision,
        sceneId: input.sceneId,
        laneId: input.laneId,
        cueId: input.cueId,
      }),
      store,
    ),
    {
      name: "stage.asset.list",
      title: "素材を一覧",
      description: "登録済みの背景とBGM素材metadataを返します。",
      inputSchema: jsonSchema(schemas.empty),
      annotations: untrustedReadOnly,
      async execute(input) {
        const parsed = parse(schemas.empty, input);
        return parsed.ok
          ? { ok: true, assets: store.getSnapshot().scenario.assets }
          : parsed.result;
      },
    },
    {
      name: "stage.asset.import",
      title: "素材を取り込む",
      description:
        "CORS取得可能なURLの背景またはBGMを検査し、content-addressed assetとして登録します。",
      inputSchema: jsonSchema(schemas.assetImport),
      async execute(input, options) {
        const parsed = parse(schemas.assetImport, input);
        if (!parsed.ok) return parsed.result;
        const signal = executionSignal(options, registration.signal);
        signal.throwIfAborted();
        const { expectedRevision } = parsed.data;
        const request = {
          url: parsed.data.url,
          kind: parsed.data.kind,
          name: parsed.data.name,
          ...(parsed.data.license ? { license: parsed.data.license } : {}),
        };
        const asset = await importAsset(request, signal);
        return mutationResult(
          await store.dispatch({
            type: "asset.import",
            expectedRevision,
            asset,
          }),
        );
      },
    },
    writeTool(
      {
        name: "stage.cast.set",
        title: "配役を設定",
        description: "globalまたはScene scopeのRole-to-Actor割当を設定します。",
      },
      schemas.castSet,
      (input) => ({
        type: "cast.set",
        expectedRevision: input.expectedRevision,
        scope: input.scope,
        cast: {
          assignments: input.cast.assignments,
          ...(input.cast.standInActorId
            ? { standInActorId: input.cast.standInActorId }
            : {}),
        },
        ...(input.sceneId ? { sceneId: input.sceneId } : {}),
      }),
      store,
    ),
    {
      name: "stage.performance.preview",
      title: "上演をプレビュー",
      description:
        "選択SceneまたはCue範囲を指定Actorで試演します。speechMode=skipを明示するとセリフを除外し、warningsとskippedCueIdsを返します。",
      inputSchema: jsonSchema(schemas.preview),
      async execute(input, options) {
        const parsed = parse(schemas.preview, input);
        if (!parsed.ok) return parsed.result;
        const signal = executionSignal(options, registration.signal);
        signal.throwIfAborted();
        return performance.preview(
          {
            ...(parsed.data.sceneIds ? { sceneIds: parsed.data.sceneIds } : {}),
            ...(parsed.data.fromCueId
              ? { fromCueId: parsed.data.fromCueId }
              : {}),
            ...(parsed.data.toCueId ? { toCueId: parsed.data.toCueId } : {}),
            ...(parsed.data.actorId ? { actorId: parsed.data.actorId } : {}),
            ...(parsed.data.speechMode
              ? { speechMode: parsed.data.speechMode }
              : {}),
          },
          signal,
        );
      },
    },
    {
      name: "stage.performance.play",
      title: "上演を開始",
      description: "Runをcompile、prepareして、選択Sceneを順に上演します。",
      inputSchema: jsonSchema(schemas.play),
      async execute(input, options) {
        const parsed = parse(schemas.play, input);
        if (!parsed.ok) return parsed.result;
        const signal = executionSignal(options, registration.signal);
        signal.throwIfAborted();
        return performance.play(
          parsed.data.sceneIds ? { sceneIds: parsed.data.sceneIds } : {},
          signal,
        );
      },
    },
    {
      name: "stage.performance.stop",
      title: "上演を停止",
      description: "実行中Runを停止し、Actorと舞台装置をcleanupします。",
      inputSchema: jsonSchema(schemas.empty),
      async execute(input, options) {
        const parsed = parse(schemas.empty, input);
        if (!parsed.ok) return parsed.result;
        const signal = executionSignal(options, registration.signal);
        signal.throwIfAborted();
        return performance.stop(signal);
      },
    },
  ];

  for (const tool of tools)
    await modelContext.registerTool(tool, { signal: registration.signal });

  return {
    supported: true,
    toolNames: tools.map((tool) => tool.name),
    dispose: () => registration.abort(),
  };
};
