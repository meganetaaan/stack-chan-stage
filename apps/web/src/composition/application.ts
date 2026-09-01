import {
  createRuntimeCoordinator,
  createWorkspaceStore,
  type AudioPreparationPort,
  type CommandResult,
  type ProjectSnapshot,
  type RuntimeCoordinator,
  type StagePort,
  type WorkspaceStore,
} from "@stackchan-stage/application";
import {
  createDeviceActorAdapter,
  type DeviceActorAdapter,
} from "@stackchan-stage/actor-device";
import {
  createHostStageBridge,
  createWasmActorAdapter,
  type HostStageBridge,
} from "@stackchan-stage/actor-wasm";
import {
  asActorId,
  asAssetId,
  asRunId,
  castPlanSchema,
  compileRun,
  parseScenario,
  type ActorId,
  type AssetKind,
  type AssetMetadata,
  type CueId,
  type RunPlan,
  type RuntimeState,
  type SceneId,
  type ValidationIssue,
} from "@stackchan-stage/domain";
import {
  createIndexedDbAudioCache,
  createIndexedDbProjectStore,
} from "@stackchan-stage/persistence-browser";
import {
  createBrowserStagePort,
  type BrowserStagePort,
} from "@stackchan-stage/stage-browser";
import {
  createPreparedAudioPlayback,
  createTtsAudioPreparationPort,
} from "@stackchan-stage/tts";
import {
  registerStageWebMcpTools,
  type PerformanceTools,
  type WebMcpRegistration,
} from "@stackchan-stage/webmcp";
import { z } from "zod";

import { createActorRouter } from "./actor-router";
import { defaultCastPlan, defaultScenario } from "./default-workspace";
import {
  applyPreviewSpeechMode,
  type PreviewSpeechMode,
} from "./preview-speech-mode";
import { waitForRunEnd } from "./wait-for-run-end";
import {
  createProjectArchive,
  projectArchiveFileName,
  readProjectArchive,
  type PreparedProjectImport,
} from "../features/project/project-archive";

const gatewaySettingsSchema = z
  .object({
    gatewayUrl: z.url().refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "ws:" || protocol === "wss:";
    }, "Gateway URLにはws://またはwss://を指定してください"),
    token: z.string().min(16).max(512),
    sessionId: z.string().trim().min(1).max(128),
    ttsEndpoint: z.url().optional(),
    ttsToken: z.string().min(16).max(512).optional(),
  })
  .strict();

export type GatewaySettings = Readonly<z.output<typeof gatewaySettingsSchema>>;

const gatewaySettingsErrorMessage = (error: z.ZodError) => {
  switch (error.issues[0]?.path[0]) {
    case "gatewayUrl":
      return "Gateway URLはws://またはwss://で入力してください";
    case "token":
      return "Pairing tokenは16文字以上で入力してください";
    case "sessionId":
      return "Sessionを入力してください";
    case "ttsEndpoint":
      return "Opus TTS endpointには有効なURLを入力してください";
    case "ttsToken":
      return "Opus TTS tokenは16文字以上で入力してください";
    default:
      return "Gateway設定を確認してください";
  }
};

export type PerformanceResult =
  | Readonly<{
      ok: true;
      runId: string;
      state: RuntimeState;
      warnings?: readonly ValidationIssue[];
      skippedCueIds?: readonly CueId[];
    }>
  | Readonly<{ ok: false; issues: readonly ValidationIssue[] }>;

export type ProjectImportCandidate = PreparedProjectImport &
  Readonly<{ baseRevision: number }>;

export type StageWebApplication = Readonly<{
  store: WorkspaceStore;
  stageBridge: HostStageBridge;
  performance: PerformanceTools;
  webMcp: WebMcpRegistration;
  attachStageRoot: (root: HTMLElement) => () => void;
  connectGateway: (settings: GatewaySettings) => Promise<void>;
  disconnectGateway: () => void;
  isTtsEndpointConfigured: () => boolean;
  importFileAsset: (
    file: File,
    kind: AssetKind,
    license?: string,
  ) => Promise<AssetMetadata>;
  exportProjectFile: () => Promise<Readonly<{ blob: Blob; fileName: string }>>;
  prepareProjectFile: (file: File) => Promise<ProjectImportCandidate>;
  replaceProject: (project: ProjectImportCandidate) => Promise<CommandResult>;
  setSimulatorAvailability: (availability: "online" | "offline") => void;
  resumeAudio: () => Promise<void>;
  dispose: () => Promise<void>;
}>;

const issue = (code: string, message: string): ValidationIssue => ({
  code,
  message,
  path: [],
  severity: "error",
});

const hexadecimal = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const nextRunId = () => asRunId(`run-${crypto.randomUUID()}`);

const createStageProxy = (): StagePort &
  Readonly<{ setDelegate: (stage?: BrowserStagePort) => void }> => {
  let delegate: BrowserStagePort | undefined;
  return {
    setDelegate(stage) {
      const previous = delegate;
      delegate = stage;
      if (previous && previous !== stage) void previous.dispose();
    },
    execute(command) {
      if (!delegate)
        return Promise.reject(new Error("Stage view is not mounted"));
      return delegate.execute(command);
    },
    cancel(executionId) {
      return delegate?.cancel(executionId) ?? Promise.resolve();
    },
    stopAll() {
      return delegate?.stopAll() ?? Promise.resolve();
    },
  };
};

const slicePlan = (
  plan: RunPlan,
  fromCueId?: string,
  toCueId?: string,
): RunPlan | undefined => {
  const from = fromCueId
    ? plan.cues.findIndex((entry) => entry.cue.id === fromCueId)
    : 0;
  const to = toCueId
    ? plan.cues.findIndex((entry) => entry.cue.id === toCueId)
    : plan.cues.length - 1;
  if (from < 0 || to < from) return undefined;
  const cues = plan.cues.slice(from, to + 1);
  return {
    ...plan,
    cues,
    speech: cues.flatMap((entry) => (entry.speech ? [entry.speech] : [])),
  };
};

export const createStageWebApplication =
  async (): Promise<StageWebApplication> => {
    const projectStore = createIndexedDbProjectStore();
    const audioCache = createIndexedDbAudioCache();
    const loaded = await projectStore.load().catch((error) => {
      console.warn("[persistence] project load failed", error);
      return undefined;
    });
    const parsedScenario = loaded ? parseScenario(loaded.scenario) : undefined;
    const parsedCast = loaded
      ? castPlanSchema.safeParse(loaded.castPlan)
      : undefined;
    const initialScenario =
      parsedScenario?.ok === true ? parsedScenario.scenario : defaultScenario();
    const initialCast =
      parsedCast?.success === true ? parsedCast.data : defaultCastPlan();
    const initialRevision =
      loaded && Number.isSafeInteger(loaded.revision) && loaded.revision >= 0
        ? loaded.revision
        : 0;

    const persist = async (
      state: ReturnType<WorkspaceStore["getSnapshot"]>,
      command: Parameters<WorkspaceStore["dispatch"]>[0],
    ) => {
      const snapshot: ProjectSnapshot = {
        scenario: state.scenario,
        castPlan: state.castPlan,
        revision: state.revision,
      };
      if (command.type === "project.replace")
        await projectStore.replace(snapshot, command.assetBlobs);
      else await projectStore.save(snapshot);
    };
    const store = createWorkspaceStore(
      {
        scenario: initialScenario,
        castPlan: initialCast,
        actors: [],
        revision: initialRevision,
        runtime: { status: "idle" },
      },
      persist,
    );

    let audioContext: AudioContext | undefined;
    const getAudioContext = () => {
      if (!audioContext && typeof globalThis.AudioContext === "function")
        audioContext = new AudioContext();
      return audioContext;
    };
    const playback = async (
      audio: Parameters<ReturnType<typeof createPreparedAudioPlayback>>[0],
      options: Parameters<ReturnType<typeof createPreparedAudioPlayback>>[1],
    ) => {
      const currentAudioContext = audio.data ? getAudioContext() : undefined;
      const player = createPreparedAudioPlayback({
        ...(currentAudioContext ? { audioContext: currentAudioContext } : {}),
      });
      await player(audio, options);
    };
    const stageBridge = createHostStageBridge(playback);
    const browserSpeechSynthesis =
      typeof globalThis.speechSynthesis === "undefined"
        ? undefined
        : globalThis.speechSynthesis;
    let ttsEndpoint: string | undefined;
    let ttsToken: string | undefined;
    let audioImplementation = createTtsAudioPreparationPort({
      cache: audioCache,
      ...(browserSpeechSynthesis
        ? { speechSynthesis: browserSpeechSynthesis }
        : {}),
    });
    const audio: AudioPreparationPort = {
      get: (fingerprint) => audioImplementation.get(fingerprint),
      prepare: (speech, signal) => audioImplementation.prepare(speech, signal),
      release: (assetId) => audioImplementation.release(assetId),
    };
    let getPreparedAudio: RuntimeCoordinator["getPreparedAudio"] = () =>
      undefined;
    const resolveAudio = async (fingerprint: string) =>
      getPreparedAudio(fingerprint) ?? audio.get(fingerprint);
    const setTtsEndpoint = async (endpoint?: string, token?: string) => {
      if (endpoint === ttsEndpoint && token === ttsToken) return;
      ttsEndpoint = endpoint;
      ttsToken = token;
      audioImplementation = createTtsAudioPreparationPort({
        cache: audioCache,
        ...(browserSpeechSynthesis
          ? { speechSynthesis: browserSpeechSynthesis }
          : {}),
        ...(endpoint ? { endpoint } : {}),
        ...(token ? { authorizationToken: token } : {}),
      });
      const staleEntries = await audioCache.entries();
      await Promise.all(
        staleEntries.map((entry) => audioCache.delete(entry.id)),
      );
    };
    const wasm = createWasmActorAdapter({
      bridge: stageBridge,
      resolveAudio,
    });
    const actor = createActorRouter();
    await actor.addSource({
      port: wasm,
      dispose: wasm.dispose,
    });
    const unsubscribeActors = actor.subscribeActors((actors) =>
      store.setActors(actors),
    );

    const stage = createStageProxy();
    const coordinator = createRuntimeCoordinator({ actor, stage, audio });
    getPreparedAudio = coordinator.getPreparedAudio;
    const unsubscribeRuntime = coordinator.subscribe((runtime) =>
      store.setRuntime(runtime),
    );
    let removeDevice: (() => void) | undefined;
    let device: DeviceActorAdapter | undefined;

    const resumeAudio = async () => {
      const context = getAudioContext();
      if (context?.state === "suspended") await context.resume();
    };

    const importBlob = async (
      blob: Blob,
      name: string,
      kind: AssetKind,
      sourceUrl?: string,
      license?: string,
    ): Promise<AssetMetadata> => {
      const expectedType = kind === "backdrop" ? "image/" : "audio/";
      if (!blob.type.startsWith(expectedType))
        throw new Error(
          kind === "backdrop"
            ? "背景には画像ファイルが必要です"
            : "BGMには音声ファイルが必要です",
        );
      if (blob.size > 25 * 1024 * 1024)
        throw new Error("素材は25 MiB以下にしてください");
      const digest = hexadecimal(
        await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
      );
      const asset: AssetMetadata = {
        id: asAssetId(`asset-${digest.slice(0, 24)}`),
        kind,
        name,
        mimeType: blob.type,
        byteSize: blob.size,
        digest,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(license ? { license } : {}),
      };
      await projectStore.saveBlob(asset.id, blob);
      return asset;
    };

    const compile = (
      requestedSceneIds?: readonly string[],
      actorOverride?: string,
    ) => {
      const workspace = store.getSnapshot();
      const sceneIds: SceneId[] = [];
      for (const requested of requestedSceneIds ??
        workspace.scenario.scenes.map((scene) => scene.id)) {
        const scene = workspace.scenario.scenes.find(
          (candidate) => candidate.id === requested,
        );
        if (!scene)
          return {
            ok: false as const,
            issues: [
              issue("scene.not_found", `Scene ${requested} が存在しません`),
            ],
          };
        sceneIds.push(scene.id);
      }
      let castPlan = workspace.castPlan;
      if (actorOverride) {
        const selected = workspace.actors.find(
          (candidate) => candidate.id === actorOverride,
        );
        if (!selected)
          return {
            ok: false as const,
            issues: [
              issue("actor.not_found", `Actor ${actorOverride} が存在しません`),
            ],
          };
        const assignments = Object.fromEntries(
          workspace.scenario.roles.map((role) => [role.id, selected.id]),
        );
        castPlan = { global: { assignments }, scenes: {} };
      }
      return compileRun({
        runId: nextRunId(),
        scenario: workspace.scenario,
        sceneIds,
        castPlan,
        actors: workspace.actors,
        assets: workspace.scenario.assets,
      });
    };

    const run = async (
      input: Readonly<{
        sceneIds?: readonly string[];
        fromCueId?: string;
        toCueId?: string;
        actorId?: string;
        speechMode?: PreviewSpeechMode;
      }>,
      signal: AbortSignal,
    ): Promise<PerformanceResult> => {
      const current = coordinator.getState();
      if (
        ["preparing", "ready", "playing", "buffering", "stopping"].includes(
          current.status,
        )
      )
        await coordinator.stop();
      if (["completed", "failed"].includes(coordinator.getState().status))
        await coordinator.reset();
      const compiled = compile(input.sceneIds, input.actorId);
      if (!compiled.ok) return { ok: false, issues: compiled.issues };
      const slicedPlan = slicePlan(
        compiled.plan,
        input.fromCueId,
        input.toCueId,
      );
      if (!slicedPlan)
        return {
          ok: false,
          issues: [issue("cue.range_invalid", "PreviewするCue範囲が不正です")],
        };
      const preview = applyPreviewSpeechMode(slicedPlan, input.speechMode);
      const { plan } = preview;
      const deviceSpeech = plan.cues.some((entry) => {
        if (!entry.speech || !entry.actorId) return false;
        return plan.actors.some(
          (actor) => actor.id === entry.actorId && actor.kind === "device",
        );
      });
      if (deviceSpeech && !ttsEndpoint)
        return {
          ok: false,
          issues: [
            issue(
              "speech.opus_endpoint_missing",
              "実機SpeechにはOpus TTS endpointを設定してください",
            ),
          ],
        };
      const webAudioRequired = plan.cues.some((entry) => {
        if (entry.cue.kind === "music.start") return true;
        if (!ttsEndpoint || !entry.speech || !entry.actorId) return false;
        return plan.actors.some(
          (actor) => actor.id === entry.actorId && actor.kind === "wasm",
        );
      });
      if (webAudioRequired) await resumeAudio();
      await coordinator.prepare(plan);
      if (coordinator.getState().status !== "ready") {
        const state = coordinator.getState();
        return state.status === "failed"
          ? {
              ok: false,
              issues: [issue(state.failure.code, state.failure.message)],
            }
          : {
              ok: false,
              issues: [issue("run.not_ready", "Runを準備できませんでした")],
            };
      }
      await coordinator.play();
      const state = await waitForRunEnd(coordinator, signal);
      if (state.status === "failed")
        return {
          ok: false,
          issues: [issue(state.failure.code, state.failure.message)],
        };
      return {
        ok: true,
        runId: plan.id,
        state,
        ...(preview.warnings.length > 0 ? { warnings: preview.warnings } : {}),
        ...(preview.skippedCueIds.length > 0
          ? { skippedCueIds: preview.skippedCueIds }
          : {}),
      };
    };

    const performance: PerformanceTools = {
      validate(input) {
        const compiled = compile(input.sceneIds);
        if (!compiled.ok) return { ok: false, issues: compiled.issues };
        const issues: ValidationIssue[] = [];
        const speechActorKinds = new Set(
          compiled.plan.cues.flatMap((entry) => {
            if (!entry.speech || !entry.actorId) return [];
            const actor = compiled.plan.actors.find(
              (candidate) => candidate.id === entry.actorId,
            );
            return actor ? [actor.kind] : [];
          }),
        );
        if (speechActorKinds.has("device") && !ttsEndpoint)
          issues.push(
            issue(
              "speech.opus_endpoint_missing",
              "実機SpeechにはOpus TTS endpointを設定してください",
            ),
          );
        if (
          speechActorKinds.has("wasm") &&
          !ttsEndpoint &&
          (browserSpeechSynthesis?.getVoices().length ?? 0) === 0
        )
          issues.push(
            issue(
              "speech.browser_voice_unavailable",
              "このブラウザでは音声合成用の音声を利用できません。ブラウザ再生可能な音声を返すOpus TTS endpointを設定してください",
            ),
          );
        return issues.length > 0
          ? { ok: false, issues }
          : { ok: true, issues: [], cueCount: compiled.plan.cues.length };
      },
      preview: (input, signal) => run(input, signal),
      play: (input, signal) => run(input, signal),
      async stop(signal) {
        signal.throwIfAborted();
        await coordinator.stop();
        return { ok: true, state: coordinator.getState() };
      },
    };

    const importAsset = async (
      input: Readonly<{
        url: string;
        kind: AssetKind;
        name: string;
        license?: string;
      }>,
      signal: AbortSignal,
    ) => {
      const response = await fetch(input.url, { signal });
      if (!response.ok)
        throw new Error(`素材の取得に失敗しました (HTTP ${response.status})`);
      return importBlob(
        await response.blob(),
        input.name,
        input.kind,
        input.url,
        input.license,
      );
    };
    const webMcp = await registerStageWebMcpTools({
      store,
      performance,
      importAsset,
    });

    return {
      store,
      stageBridge,
      performance,
      webMcp,
      attachStageRoot(root) {
        const currentAudioContext = getAudioContext();
        const current = createBrowserStagePort({
          root,
          resolveAsset: async (assetId) => {
            const blob = await projectStore.loadBlob(assetId);
            if (blob) return blob;
            return store
              .getSnapshot()
              .scenario.assets.find((asset) => asset.id === assetId)?.sourceUrl;
          },
          ...(currentAudioContext ? { audioContext: currentAudioContext } : {}),
        });
        stage.setDelegate(current);
        return () => stage.setDelegate(undefined);
      },
      async connectGateway(settings) {
        const parsedSettings = gatewaySettingsSchema.safeParse(settings);
        if (!parsedSettings.success)
          throw new TypeError(
            gatewaySettingsErrorMessage(parsedSettings.error),
          );
        await setTtsEndpoint(
          parsedSettings.data.ttsEndpoint,
          parsedSettings.data.ttsToken,
        );
        removeDevice?.();
        removeDevice = undefined;
        device = createDeviceActorAdapter({
          gatewayUrl: parsedSettings.data.gatewayUrl,
          token: parsedSettings.data.token,
          sessionId: parsedSettings.data.sessionId,
          resolveAudio,
        });
        try {
          removeDevice = await actor.addSource({
            port: device,
            subscribeActors: device.subscribeActors,
            dispose: device.dispose,
          });
        } catch (error) {
          device.dispose();
          device = undefined;
          throw error;
        }
      },
      disconnectGateway() {
        removeDevice?.();
        removeDevice = undefined;
        device = undefined;
      },
      isTtsEndpointConfigured: () => ttsEndpoint !== undefined,
      async importFileAsset(file, kind, license) {
        return importBlob(file, file.name, kind, undefined, license);
      },
      async exportProjectFile() {
        await store.whenIdle();
        const workspace = store.getSnapshot();
        return {
          blob: await createProjectArchive({
            scenario: workspace.scenario,
            castPlan: workspace.castPlan,
            loadBlob: projectStore.loadBlob,
          }),
          fileName: projectArchiveFileName(workspace.scenario.title),
        };
      },
      async prepareProjectFile(file) {
        await store.whenIdle();
        const workspace = store.getSnapshot();
        return {
          ...(await readProjectArchive(file, workspace.actors)),
          baseRevision: workspace.revision,
        };
      },
      replaceProject(project) {
        return store.dispatch({
          type: "project.replace",
          expectedRevision: project.baseRevision,
          scenario: project.scenario,
          castPlan: project.castPlan,
          assetBlobs: project.assetBlobs,
        });
      },
      setSimulatorAvailability: wasm.setAvailability,
      resumeAudio,
      async dispose() {
        webMcp.dispose();
        removeDevice?.();
        unsubscribeRuntime();
        coordinator.dispose();
        unsubscribeActors();
        actor.dispose();
        stage.setDelegate(undefined);
        stageBridge.dispose();
        await audioContext?.close();
        await Promise.all([projectStore.close(), audioCache.close()]);
      },
    };
  };
