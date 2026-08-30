import {
  ArrowDown,
  ArrowUp,
  Boxes,
  Cable,
  ChevronRight,
  Clapperboard,
  Expand,
  FileAudio,
  Image,
  Layers3,
  Library,
  Link2,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  Radio,
  Save,
  Square,
  Theater,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  asLaneId,
  asRoleId,
  asSceneId,
  ownRecordValue,
  type AssetKind,
  type Cue,
  type Role,
  type Scene,
  type ValidationIssue,
} from "@stackchan-stage/domain";

import type { StageWebApplication } from "./composition/application";
import { CueDialog } from "./features/editor/CueDialog";
import {
  CueKindIcon,
  cueKindLabel,
  cueSummary,
} from "./features/editor/cue-presentation";
import {
  SimulatorView,
  type SimulatorPhase,
} from "./features/performance/SimulatorView";
import { useWorkspace } from "./hooks/use-workspace";

type WorkspaceView = "editor" | "cast" | "assets" | "performance";
type Notice = Readonly<{
  tone: "error" | "success" | "info";
  message: string;
  issues?: readonly ValidationIssue[];
}>;

const viewItems: ReadonlyArray<{
  id: WorkspaceView;
  label: string;
  icon: typeof Clapperboard;
}> = [
  { id: "editor", label: "演出", icon: Clapperboard },
  { id: "cast", label: "配役", icon: Users },
  { id: "assets", label: "素材", icon: Library },
  { id: "performance", label: "上演", icon: Theater },
];

const runtimeLabel: Record<string, string> = {
  idle: "待機",
  preparing: "準備中",
  ready: "開演待ち",
  playing: "上演中",
  buffering: "音声準備中",
  stopping: "停止中",
  completed: "終演",
  failed: "停止",
};

const IconButton = ({
  label,
  children,
  ...properties
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  Readonly<{ label: string; children: React.ReactNode }>) => (
  <button
    {...properties}
    className={`icon-button ${properties.className ?? ""}`}
    title={label}
    aria-label={label}
  >
    {children}
  </button>
);

const SceneRail = ({
  scenes,
  selectedId,
  onSelect,
  onAdd,
  onDelete,
}: Readonly<{
  scenes: readonly Scene[];
  selectedId?: string;
  onSelect: (sceneId: string) => void;
  onAdd: () => void;
  onDelete: (scene: Scene) => void;
}>) => (
  <aside className="scene-rail" aria-label="場面">
    <div className="panel-heading compact">
      <div>
        <span className="eyebrow">SCENES</span>
        <h2>場面</h2>
      </div>
      <IconButton label="場面を追加" onClick={onAdd}>
        <Plus size={17} />
      </IconButton>
    </div>
    <ol className="scene-list">
      {scenes.map((scene, index) => (
        <li key={scene.id}>
          <button
            className="scene-item"
            data-selected={scene.id === selectedId}
            onClick={() => onSelect(scene.id)}
          >
            <span className="scene-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="scene-name">{scene.title}</span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          {scene.id === selectedId && scenes.length > 1 && (
            <IconButton
              label={`${scene.title}を削除`}
              className="scene-delete"
              onClick={() => onDelete(scene)}
            >
              <Trash2 size={14} />
            </IconButton>
          )}
        </li>
      ))}
    </ol>
  </aside>
);

const Timeline = ({
  application,
  scene,
  activeCueId,
  setNotice,
}: Readonly<{
  application: StageWebApplication;
  scene: Scene;
  activeCueId: string | undefined;
  setNotice: (notice?: Notice) => void;
}>) => {
  const workspace = useWorkspace(application.store);
  const [dialog, setDialog] = useState<
    Readonly<{ mode: "create" }> | Readonly<{ mode: "edit"; cue: Cue }>
  >();
  const lane = scene.lanes[0];
  const dispatch = async (
    command: Parameters<StageWebApplication["store"]["dispatch"]>[0],
  ) => {
    const result = await application.store.dispatch(command);
    if (!result.ok) {
      setNotice({
        tone: "error",
        message: result.message,
        issues: result.validationIssues,
      });
      throw new Error(result.message);
    }
    setNotice({ tone: "success", message: "演目を更新しました" });
  };
  if (!lane) return null;

  return (
    <section className="timeline-panel">
      <header className="timeline-header">
        <div className="scene-title-block">
          <span className="eyebrow">SCENE</span>
          <input
            className="scene-title-input"
            key={`${scene.id}:${scene.title}`}
            defaultValue={scene.title}
            aria-label="場面名"
            onBlur={(event) => {
              const title = event.target.value.trim();
              if (!title || title === scene.title) return;
              void dispatch({
                type: "scene.update",
                expectedRevision: application.store.getSnapshot().revision,
                sceneId: scene.id,
                title,
              });
            }}
          />
          <span className="lane-label">
            <Layers3 size={13} aria-hidden="true" /> {lane.name}
          </span>
        </div>
        <button
          className="button primary"
          onClick={() => setDialog({ mode: "create" })}
        >
          <Plus size={16} /> キューを追加
        </button>
      </header>

      <ol className="cue-list">
        {lane.cues.map((cue, index) => (
          <li className="cue-track" key={cue.id}>
            <span className="cue-index">{index + 1}</span>
            <article className="cue-card" data-active={cue.id === activeCueId}>
              <button
                className="cue-main"
                onClick={() => setDialog({ mode: "edit", cue })}
              >
                <span className={`cue-icon kind-${cue.kind.replace(".", "-")}`}>
                  <CueKindIcon kind={cue.kind} />
                </span>
                <span className="cue-copy">
                  <span className="cue-label">
                    {cue.label || cueKindLabel[cue.kind]}
                  </span>
                  <span className="cue-summary">
                    {cueSummary(cue, workspace.scenario.roles)}
                  </span>
                </span>
                {cue.id === activeCueId && (
                  <span className="live-indicator">
                    <span /> LIVE
                  </span>
                )}
              </button>
              <div className="cue-actions">
                <IconButton
                  label="編集"
                  onClick={() => setDialog({ mode: "edit", cue })}
                >
                  <Pencil size={15} />
                </IconButton>
                <IconButton
                  label="上へ移動"
                  disabled={index === 0}
                  onClick={() =>
                    void dispatch({
                      type: "cue.move",
                      expectedRevision:
                        application.store.getSnapshot().revision,
                      sceneId: scene.id,
                      laneId: lane.id,
                      cueId: cue.id,
                      toIndex: index - 1,
                    })
                  }
                >
                  <ArrowUp size={15} />
                </IconButton>
                <IconButton
                  label="下へ移動"
                  disabled={index === lane.cues.length - 1}
                  onClick={() =>
                    void dispatch({
                      type: "cue.move",
                      expectedRevision:
                        application.store.getSnapshot().revision,
                      sceneId: scene.id,
                      laneId: lane.id,
                      cueId: cue.id,
                      toIndex: index + 1,
                    })
                  }
                >
                  <ArrowDown size={15} />
                </IconButton>
                <IconButton
                  label="削除"
                  onClick={() =>
                    void dispatch({
                      type: "cue.delete",
                      expectedRevision:
                        application.store.getSnapshot().revision,
                      sceneId: scene.id,
                      laneId: lane.id,
                      cueId: cue.id,
                    })
                  }
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </article>
          </li>
        ))}
      </ol>
      {lane.cues.length === 0 && (
        <button
          className="empty-lane"
          onClick={() => setDialog({ mode: "create" })}
        >
          <Plus size={20} /> 最初のキューを追加
        </button>
      )}

      {dialog && (
        <CueDialog
          scenario={workspace.scenario}
          {...(dialog.mode === "edit" ? { cue: dialog.cue } : {})}
          onClose={() => setDialog(undefined)}
          onSubmit={async (cue) => {
            await dispatch(
              dialog.mode === "edit"
                ? {
                    type: "cue.update",
                    expectedRevision: application.store.getSnapshot().revision,
                    sceneId: scene.id,
                    laneId: lane.id,
                    cueId: dialog.cue.id,
                    cue,
                  }
                : {
                    type: "cue.create",
                    expectedRevision: application.store.getSnapshot().revision,
                    sceneId: scene.id,
                    laneId: lane.id,
                    cue,
                  },
            );
            setDialog(undefined);
          }}
        />
      )}
    </section>
  );
};

const CastPanel = ({
  application,
  scene,
  setNotice,
}: Readonly<{
  application: StageWebApplication;
  scene: Scene;
  setNotice: (notice?: Notice) => void;
}>) => {
  const workspace = useWorkspace(application.store);
  const [scope, setScope] = useState<"global" | "scene">("global");
  const [roleName, setRoleName] = useState("");
  const [voiceId, setVoiceId] = useState("Kyoko");
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [gateway, setGateway] = useState({
    gatewayUrl: "ws://127.0.0.1:8787",
    token: "",
    sessionId: "stage",
    ttsEndpoint: "",
  });
  const [connecting, setConnecting] = useState(false);
  const scoped =
    scope === "global"
      ? workspace.castPlan.global
      : (ownRecordValue(workspace.castPlan.scenes, scene.id) ?? {
          assignments: {},
        });

  const saveCast = async (
    assignments: Readonly<
      Partial<Record<string, import("@stackchan-stage/domain").ActorId>>
    >,
    standInActorId = scoped.standInActorId,
  ) => {
    const result = await application.store.dispatch({
      type: "cast.set",
      expectedRevision: application.store.getSnapshot().revision,
      scope,
      ...(scope === "scene" ? { sceneId: scene.id } : {}),
      cast: {
        assignments,
        ...(standInActorId ? { standInActorId } : {}),
      },
    });
    setNotice(
      result.ok
        ? { tone: "success", message: "配役を更新しました" }
        : {
            tone: "error",
            message: result.message,
            issues: result.validationIssues,
          },
    );
  };

  return (
    <section className="workspace-panel cast-panel">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">CAST</span>
          <h2>配役</h2>
        </div>
        <div className="segmented" aria-label="配役の適用範囲">
          <button
            data-active={scope === "global"}
            onClick={() => setScope("global")}
          >
            全体
          </button>
          <button
            data-active={scope === "scene"}
            onClick={() => setScope("scene")}
          >
            {scene.title}
          </button>
        </div>
      </header>

      <div className="cast-grid">
        {workspace.scenario.roles.map((role) => {
          const assigned = ownRecordValue(scoped.assignments, role.id) ?? "";
          return (
            <div className="cast-row" key={role.id}>
              <div className="role-avatar">{role.name.slice(0, 1)}</div>
              <div className="role-copy">
                <strong>{role.name}</strong>
                <span>{role.description || role.id}</span>
              </div>
              <select
                aria-label={`${role.name}のActor`}
                value={assigned}
                onChange={(event) => {
                  const actorId = workspace.actors.find(
                    (actor) => actor.id === event.target.value,
                  )?.id;
                  const assignments = Object.fromEntries(
                    Object.entries(scoped.assignments).filter(
                      ([key]) => key !== role.id,
                    ),
                  );
                  void saveCast(
                    actorId
                      ? { ...assignments, [role.id]: actorId }
                      : assignments,
                  );
                }}
              >
                <option value="">未配役</option>
                {workspace.actors.map((actor) => (
                  <option
                    value={actor.id}
                    key={actor.id}
                    disabled={actor.availability !== "online"}
                  >
                    {actor.name}
                    {actor.kind === "device" ? " · 実機" : " · WASM"}
                    {actor.availability !== "online" ? " (offline)" : ""}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="stand-in-row">
        <div>
          <strong>代役</strong>
          <span>未配役の役をまとめて担当</span>
        </div>
        <select
          aria-label="代役Actor"
          value={scoped.standInActorId ?? ""}
          onChange={(event) => {
            const actorId = workspace.actors.find(
              (actor) => actor.id === event.target.value,
            )?.id;
            void saveCast(scoped.assignments, actorId);
          }}
        >
          <option value="">なし</option>
          {workspace.actors.map((actor) => (
            <option value={actor.id} key={actor.id}>
              {actor.name}
            </option>
          ))}
        </select>
      </div>

      <section className="subsection">
        <div className="subsection-heading">
          <div>
            <span className="eyebrow">ROLES</span>
            <h3>役</h3>
          </div>
          <span className="count">{workspace.scenario.roles.length}</span>
        </div>
        <form
          className="inline-form role-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const name = roleName.trim();
            if (!name) return;
            const role: Role = {
              id: asRoleId(`role-${crypto.randomUUID()}`),
              name,
              voice: {
                provider: "browser",
                voiceId: voiceId.trim() || "default",
                locale: "ja-JP",
              },
            };
            const result = await application.store.dispatch({
              type: "role.create",
              expectedRevision: application.store.getSnapshot().revision,
              role,
            });
            if (result.ok) {
              setRoleName("");
              setNotice({ tone: "success", message: "役を追加しました" });
            } else
              setNotice({
                tone: "error",
                message: result.message,
                issues: result.validationIssues,
              });
          }}
        >
          <label className="field">
            <span>役名</span>
            <input
              value={roleName}
              onChange={(event) => setRoleName(event.target.value)}
              placeholder="例: 案内役"
            />
          </label>
          <label className="field">
            <span>Voice ID</span>
            <input
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
            />
          </label>
          <button className="button secondary" type="submit">
            <Plus size={15} />
            追加
          </button>
        </form>
      </section>

      <section className="subsection gateway-section">
        <button
          className="subsection-toggle"
          onClick={() => setGatewayOpen((open) => !open)}
          aria-expanded={gatewayOpen}
        >
          <span>
            <Cable size={17} /> Local Gateway
          </span>
          <ChevronRight size={16} data-open={gatewayOpen} />
        </button>
        {gatewayOpen && (
          <form
            className="gateway-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setConnecting(true);
              try {
                await application.connectGateway({
                  gatewayUrl: gateway.gatewayUrl,
                  token: gateway.token,
                  sessionId: gateway.sessionId,
                  ...(gateway.ttsEndpoint.trim()
                    ? { ttsEndpoint: gateway.ttsEndpoint.trim() }
                    : {}),
                });
                setNotice({
                  tone: "success",
                  message: "Local Gatewayへ接続しました",
                });
              } catch (error) {
                setNotice({
                  tone: "error",
                  message:
                    error instanceof Error ? error.message : String(error),
                });
              } finally {
                setConnecting(false);
              }
            }}
          >
            <label className="field">
              <span>Gateway URL</span>
              <input
                value={gateway.gatewayUrl}
                onChange={(event) =>
                  setGateway((current) => ({
                    ...current,
                    gatewayUrl: event.target.value,
                  }))
                }
              />
            </label>
            <div className="field-grid two-columns">
              <label className="field">
                <span>Session</span>
                <input
                  value={gateway.sessionId}
                  onChange={(event) =>
                    setGateway((current) => ({
                      ...current,
                      sessionId: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Pairing token</span>
                <input
                  type="password"
                  value={gateway.token}
                  onChange={(event) =>
                    setGateway((current) => ({
                      ...current,
                      token: event.target.value,
                    }))
                  }
                  required
                />
              </label>
            </div>
            <label className="field">
              <span>Opus TTS endpoint</span>
              <input
                type="url"
                value={gateway.ttsEndpoint}
                onChange={(event) =>
                  setGateway((current) => ({
                    ...current,
                    ttsEndpoint: event.target.value,
                  }))
                }
                placeholder="https://example.test/tts"
              />
              <small className="field-hint">
                実機でセリフを上演する場合に指定
              </small>
            </label>
            <div className="gateway-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  application.disconnectGateway();
                  setNotice({
                    tone: "info",
                    message: "Gateway接続を解除しました",
                  });
                }}
              >
                切断
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={connecting}
              >
                {connecting && <LoaderCircle className="spin" size={15} />}
                {connecting ? "接続中" : "接続"}
              </button>
            </div>
          </form>
        )}
      </section>
    </section>
  );
};

const AssetPanel = ({
  application,
  setNotice,
}: Readonly<{
  application: StageWebApplication;
  setNotice: (notice?: Notice) => void;
}>) => {
  const workspace = useWorkspace(application.store);
  const [kind, setKind] = useState<AssetKind>("backdrop");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <section className="workspace-panel asset-panel">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">ASSETS</span>
          <h2>素材</h2>
        </div>
        <div className="asset-import-controls">
          <select
            aria-label="素材の種類"
            value={kind}
            onChange={(event) =>
              setKind(event.target.value === "music" ? "music" : "backdrop")
            }
          >
            <option value="backdrop">背景</option>
            <option value="music">BGM</option>
          </select>
          <button
            className="button primary"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            {importing ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Plus size={15} />
            )}
            {importing ? "取込中" : "ファイルを追加"}
          </button>
          <input
            ref={fileRef}
            className="visually-hidden"
            type="file"
            accept={kind === "backdrop" ? "image/*" : "audio/*"}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setImporting(true);
              try {
                const asset = await application.importFileAsset(file, kind);
                const result = await application.store.dispatch({
                  type: "asset.import",
                  expectedRevision: application.store.getSnapshot().revision,
                  asset,
                });
                setNotice(
                  result.ok
                    ? {
                        tone: "success",
                        message: `${asset.name}を追加しました`,
                      }
                    : {
                        tone: "error",
                        message: result.message,
                        issues: result.validationIssues,
                      },
                );
              } catch (error) {
                setNotice({
                  tone: "error",
                  message:
                    error instanceof Error ? error.message : String(error),
                });
              } finally {
                setImporting(false);
              }
            }}
          />
        </div>
      </header>
      <div className="asset-grid">
        {workspace.scenario.assets.map((asset) => (
          <article className="asset-card" key={asset.id}>
            <div className={`asset-preview ${asset.kind}`}>
              {asset.kind === "backdrop" ? (
                <Image size={25} />
              ) : (
                <FileAudio size={25} />
              )}
            </div>
            <div className="asset-copy">
              <strong>{asset.name}</strong>
              <span>
                {asset.mimeType} · {(asset.byteSize / 1024).toFixed(1)} KiB
              </span>
              <code>{asset.digest.slice(0, 12)}</code>
            </div>
          </article>
        ))}
      </div>
      {workspace.scenario.assets.length === 0 && (
        <button
          className="empty-assets"
          onClick={() => fileRef.current?.click()}
        >
          <Library size={24} />
          <strong>素材はまだありません</strong>
          <span>背景画像またはBGMを追加</span>
        </button>
      )}
    </section>
  );
};

const PerformancePanel = ({
  application,
  selectedScene,
  simulatorPhase,
  setSimulatorPhase,
  setNotice,
}: Readonly<{
  application: StageWebApplication;
  selectedScene: Scene;
  simulatorPhase: SimulatorPhase;
  setSimulatorPhase: (phase: SimulatorPhase) => void;
  setNotice: (notice?: Notice) => void;
}>) => {
  const workspace = useWorkspace(application.store);
  const [range, setRange] = useState<"scene" | "all">("scene");
  const runAbort = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const running = [
    "preparing",
    "ready",
    "playing",
    "buffering",
    "stopping",
  ].includes(workspace.runtime.status);
  const start = () => {
    runAbort.current?.abort();
    const controller = new AbortController();
    runAbort.current = controller;
    void application.performance
      .play(
        range === "scene" ? { sceneIds: [selectedScene.id] } : {},
        controller.signal,
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (
          typeof result === "object" &&
          result &&
          "ok" in result &&
          result.ok === false &&
          "issues" in result
        ) {
          const issues = Array.isArray(result.issues) ? result.issues : [];
          setNotice({
            tone: "error",
            message: issues[0]?.message ?? "Runを開始できません",
            issues,
          });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setNotice({
            tone: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      });
  };
  const stop = () => {
    runAbort.current?.abort();
    runAbort.current = null;
    const controller = new AbortController();
    void application.performance.stop(controller.signal);
  };

  return (
    <section className="performance-panel" ref={panelRef}>
      <SimulatorView
        application={application}
        onPhaseChange={setSimulatorPhase}
      />
      <header className="performance-overlay top">
        <div className="stage-brand">
          <span className="stage-brand-mark">
            <Boxes size={16} />
          </span>
          <span>STAGE MONITOR</span>
        </div>
        <div className="stage-statuses">
          <span className={`status-chip simulator ${simulatorPhase}`}>
            <span />
            {simulatorPhase === "ready"
              ? "WASM READY"
              : simulatorPhase === "error"
                ? "WASM ERROR"
                : "WASM LOAD"}
          </span>
          <span className={`status-chip runtime ${workspace.runtime.status}`}>
            <Radio size={12} />
            {runtimeLabel[workspace.runtime.status]}
          </span>
          <IconButton
            label="全画面表示"
            onClick={() => void panelRef.current?.requestFullscreen()}
          >
            <Expand size={16} />
          </IconButton>
        </div>
      </header>
      <footer className="performance-overlay bottom">
        <div className="now-playing">
          <span className="eyebrow">NOW</span>
          <strong>
            {workspace.runtime.status === "playing"
              ? workspace.runtime.active.cue.label ||
                cueKindLabel[workspace.runtime.active.cue.kind]
              : selectedScene.title}
          </strong>
          <span>
            {workspace.runtime.status === "playing"
              ? cueSummary(
                  workspace.runtime.active.cue,
                  workspace.scenario.roles,
                )
              : `${selectedScene.lanes[0]?.cues.length ?? 0} cues`}
          </span>
        </div>
        <div className="performance-controls">
          <div className="segmented dark" aria-label="上演範囲">
            <button
              data-active={range === "scene"}
              onClick={() => setRange("scene")}
            >
              この場面
            </button>
            <button
              data-active={range === "all"}
              onClick={() => setRange("all")}
            >
              全場面
            </button>
          </div>
          {running ? (
            <button
              className="transport-button stop"
              onClick={stop}
              aria-label="上演を停止"
            >
              <Square size={20} fill="currentColor" />
            </button>
          ) : (
            <button
              className="transport-button play"
              onClick={start}
              disabled={simulatorPhase !== "ready"}
              aria-label="上演を開始"
            >
              <Play size={23} fill="currentColor" />
            </button>
          )}
        </div>
      </footer>
    </section>
  );
};

export const App = ({
  application,
}: Readonly<{ application: StageWebApplication }>) => {
  const workspace = useWorkspace(application.store);
  const [view, setView] = useState<WorkspaceView>("editor");
  const [selectedSceneId, setSelectedSceneId] = useState<string>(
    workspace.scenario.scenes[0]?.id ?? "",
  );
  const [simulatorPhase, setSimulatorPhase] =
    useState<SimulatorPhase>("loading");
  const [notice, setNotice] = useState<Notice>();
  const selectedScene =
    workspace.scenario.scenes.find((scene) => scene.id === selectedSceneId) ??
    workspace.scenario.scenes[0];
  const activeCueId =
    workspace.runtime.status === "playing"
      ? workspace.runtime.active.cue.id
      : undefined;

  useEffect(() => {
    if (
      !workspace.scenario.scenes.some((scene) => scene.id === selectedSceneId)
    )
      setSelectedSceneId(workspace.scenario.scenes[0]?.id ?? "");
  }, [selectedSceneId, workspace.scenario.scenes]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => setNotice(undefined),
      notice.tone === "error" ? 7000 : 2600,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  const addScene = async () => {
    const suffix = crypto.randomUUID();
    const scene: Scene = {
      id: asSceneId(`scene-${suffix}`),
      title: `場面 ${workspace.scenario.scenes.length + 1}`,
      lanes: [{ id: asLaneId(`lane-${suffix}`), name: "本線", cues: [] }],
    };
    const result = await application.store.dispatch({
      type: "scene.create",
      expectedRevision: application.store.getSnapshot().revision,
      scene,
    });
    if (result.ok) {
      setSelectedSceneId(scene.id);
      setView("editor");
      setNotice({ tone: "success", message: "場面を追加しました" });
    } else
      setNotice({
        tone: "error",
        message: result.message,
        issues: result.validationIssues,
      });
  };

  if (!selectedScene)
    return <main className="fatal-state">Scenarioに場面がありません</main>;

  return (
    <div className="app-shell" data-view={view}>
      <header className="app-header">
        <div className="brand-block">
          <span className="brand-mark">
            <Theater size={19} />
          </span>
          <div>
            <strong>Stack-chan Stage</strong>
            <span>DIRECTOR CONSOLE</span>
          </div>
        </div>
        <nav className="view-tabs" aria-label="ワークスペース">
          {viewItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              data-active={view === id}
              onClick={() => setView(id)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="header-meta">
          <span className="revision">
            <Save size={13} /> rev.{workspace.revision}
          </span>
          <span
            className={`mcp-state ${application.webMcp.supported ? "available" : "unavailable"}`}
            title={
              application.webMcp.supported
                ? `${application.webMcp.toolNames.length} tools`
                : "このブラウザではWebMCPを利用できません"
            }
          >
            <Link2 size={13} /> WebMCP
          </span>
        </div>
      </header>

      <div className="project-bar">
        <div className="project-title">
          <span className="eyebrow">SCENARIO</span>
          <input
            aria-label="演目名"
            key={`${workspace.scenario.id}:${workspace.scenario.title}`}
            defaultValue={workspace.scenario.title}
            onBlur={(event) => {
              const title = event.target.value.trim();
              if (!title || title === workspace.scenario.title) return;
              void application.store.dispatch({
                type: "scenario.replace",
                expectedRevision: application.store.getSnapshot().revision,
                scenario: { ...workspace.scenario, title },
              });
            }}
          />
        </div>
        <span className="project-count">
          <Clapperboard size={14} /> {workspace.scenario.scenes.length} scenes ·{" "}
          {workspace.scenario.scenes.reduce(
            (count, scene) =>
              count +
              scene.lanes.reduce(
                (laneCount, lane) => laneCount + lane.cues.length,
                0,
              ),
            0,
          )}{" "}
          cues
        </span>
      </div>

      <main className="workspace-layout">
        <div className="authoring-area">
          <SceneRail
            scenes={workspace.scenario.scenes}
            selectedId={selectedScene.id}
            onSelect={(sceneId) => {
              setSelectedSceneId(sceneId);
              setView("editor");
            }}
            onAdd={() => void addScene()}
            onDelete={(scene) => {
              if (!window.confirm(`「${scene.title}」を削除しますか？`)) return;
              void application.store
                .dispatch({
                  type: "scene.delete",
                  expectedRevision: application.store.getSnapshot().revision,
                  sceneId: scene.id,
                })
                .then((result) =>
                  setNotice(
                    result.ok
                      ? { tone: "success", message: "場面を削除しました" }
                      : {
                          tone: "error",
                          message: result.message,
                          issues: result.validationIssues,
                        },
                  ),
                );
            }}
          />
          <div className="work-surface">
            {view === "editor" && (
              <Timeline
                application={application}
                scene={selectedScene}
                activeCueId={activeCueId}
                setNotice={setNotice}
              />
            )}
            {view === "cast" && (
              <CastPanel
                application={application}
                scene={selectedScene}
                setNotice={setNotice}
              />
            )}
            {view === "assets" && (
              <AssetPanel application={application} setNotice={setNotice} />
            )}
            {view === "performance" && (
              <div className="mobile-performance-placeholder" />
            )}
          </div>
        </div>
        <PerformancePanel
          application={application}
          selectedScene={selectedScene}
          simulatorPhase={simulatorPhase}
          setSimulatorPhase={setSimulatorPhase}
          setNotice={setNotice}
        />
      </main>

      <nav className="mobile-nav" aria-label="モバイルナビゲーション">
        {viewItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-active={view === id}
            onClick={() => setView(id)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {notice && (
        <aside
          className={`notice ${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          <span>{notice.message}</span>
          {notice.issues && notice.issues.length > 1 && (
            <small>
              {notice.issues
                .slice(1, 3)
                .map((entry) => entry.message)
                .join(" / ")}
            </small>
          )}
          <IconButton label="閉じる" onClick={() => setNotice(undefined)}>
            <X size={14} />
          </IconButton>
        </aside>
      )}
    </div>
  );
};
