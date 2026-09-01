import {
  ArrowDown,
  ArrowUp,
  Boxes,
  Cable,
  ChevronRight,
  Clapperboard,
  Expand,
  FileAudio,
  Files,
  GripVertical,
  Image,
  Layers3,
  Library,
  Link2,
  LoaderCircle,
  MoreVertical,
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
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

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
import {
  BROWSER_VOICE_READY_TIMEOUT_MS,
  DEFAULT_BROWSER_VOICE_ID,
  resolveSpeechSynthesisVoice,
} from "@stackchan-stage/tts";

import type { StageWebApplication } from "./composition/application";
import { CueEditor } from "./features/editor/CueEditor";
import {
  CueKindIcon,
  cueKindLabel,
  cueScriptNote,
  cueScriptText,
  cueSummary,
} from "./features/editor/cue-presentation";
import {
  importFileAssets,
  type FileAssetImportProgress,
} from "./features/assets/import-file-assets";
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

const CueActionMenu = ({
  label,
  canMoveUp,
  canMoveDown,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDelete,
}: Readonly<{
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}>) => {
  const [open, setOpen] = useState(false);
  const closeAndRun = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div
      className="cue-mobile-actions"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        event.currentTarget
          .querySelector<HTMLButtonElement>(".cue-menu-trigger")
          ?.focus();
      }}
    >
      <IconButton
        label={`${label}の操作`}
        className="cue-menu-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreVertical size={17} />
      </IconButton>
      {open && (
        <div className="cue-action-menu" aria-label={`${label}の操作一覧`}>
          <button type="button" onClick={() => closeAndRun(onEdit)}>
            <Pencil size={15} /> 編集
          </button>
          <button
            type="button"
            disabled={!canMoveUp}
            onClick={() => closeAndRun(onMoveUp)}
          >
            <ArrowUp size={15} /> 上へ移動
          </button>
          <button
            type="button"
            disabled={!canMoveDown}
            onClick={() => closeAndRun(onMoveDown)}
          >
            <ArrowDown size={15} /> 下へ移動
          </button>
          <button
            className="danger"
            type="button"
            onClick={() => closeAndRun(onDelete)}
          >
            <Trash2 size={15} /> 削除
          </button>
        </div>
      )}
    </div>
  );
};

const CueInsertSlot = ({
  index,
  terminal,
  disabled,
  dragActive,
  dropTarget,
  onInsert,
  onDragOver,
  onDrop,
}: Readonly<{
  index: number;
  terminal?: boolean;
  disabled: boolean;
  dragActive: boolean;
  dropTarget: boolean;
  onInsert: () => void;
  onDragOver: (event: React.DragEvent<HTMLLIElement>) => void;
  onDrop: (event: React.DragEvent<HTMLLIElement>) => void;
}>) => (
  <li
    className={terminal ? "cue-insert-slot terminal" : "cue-insert-slot"}
    data-insert-index={index}
    data-drag-active={dragActive}
    data-drop-target={dropTarget}
    role="presentation"
    onDragOver={onDragOver}
    onDrop={onDrop}
  >
    <span className="cue-insert-line" aria-hidden="true" />
    <button
      className="cue-insert-button"
      type="button"
      disabled={disabled || dragActive}
      aria-label={
        terminal ? "末尾にコマンドを追加" : `${index + 1}行目にコマンドを挿入`
      }
      onClick={onInsert}
    >
      <Plus size={13} aria-hidden="true" />
      コマンドを挿入
    </button>
  </li>
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
  const [editor, setEditor] = useState<
    | Readonly<{ mode: "create"; index: number }>
    | Readonly<{ mode: "edit"; cueId: Cue["id"] }>
  >();
  const draggedCueIdRef = useRef<Cue["id"] | undefined>(undefined);
  const [draggedCueId, setDraggedCueId] = useState<Cue["id"]>();
  const [dropIndex, setDropIndex] = useState<number>();
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

  useEffect(() => {
    setEditor(undefined);
    draggedCueIdRef.current = undefined;
    setDraggedCueId(undefined);
    setDropIndex(undefined);
  }, [scene.id]);

  if (!lane) return null;

  const submitCue = async (cue: Cue) => {
    if (!editor) return;
    await dispatch(
      editor.mode === "edit"
        ? {
            type: "cue.update",
            expectedRevision: application.store.getSnapshot().revision,
            sceneId: scene.id,
            laneId: lane.id,
            cueId: editor.cueId,
            cue,
          }
        : {
            type: "cue.create",
            expectedRevision: application.store.getSnapshot().revision,
            sceneId: scene.id,
            laneId: lane.id,
            cue,
            index: editor.index,
          },
    );
    setEditor(undefined);
  };

  const resetDrag = () => {
    draggedCueIdRef.current = undefined;
    setDraggedCueId(undefined);
    setDropIndex(undefined);
  };

  const dropCueAt = async (boundaryIndex: number) => {
    const draggedId = draggedCueIdRef.current;
    if (!draggedId) return;
    const fromIndex = lane.cues.findIndex((cue) => cue.id === draggedId);
    const toIndex =
      boundaryIndex > fromIndex ? boundaryIndex - 1 : boundaryIndex;
    const cueId = draggedId;
    resetDrag();
    if (fromIndex < 0 || toIndex === fromIndex) return;
    await dispatch({
      type: "cue.move",
      expectedRevision: application.store.getSnapshot().revision,
      sceneId: scene.id,
      laneId: lane.id,
      cueId,
      toIndex,
    });
  };

  const renderCreateEditor = (index: number) =>
    editor?.mode === "create" && editor.index === index ? (
      <li className="cue-track cue-track-editor">
        <span className="cue-index">{index + 1}</span>
        <CueEditor
          scenario={workspace.scenario}
          onClose={() => setEditor(undefined)}
          onSubmit={submitCue}
        />
      </li>
    ) : null;

  const renderInsertSlot = (index: number, terminal = false) => (
    <CueInsertSlot
      index={index}
      terminal={terminal}
      disabled={editor !== undefined}
      dragActive={draggedCueId !== undefined}
      dropTarget={dropIndex === index}
      onInsert={() => setEditor({ mode: "create", index })}
      onDragOver={(event) => {
        if (!draggedCueIdRef.current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropIndex(index);
      }}
      onDrop={(event) => {
        if (!draggedCueIdRef.current) return;
        event.preventDefault();
        void dropCueAt(index);
      }}
    />
  );

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
      </header>

      <ol className="cue-list" data-drag-active={draggedCueId !== undefined}>
        {lane.cues.map((cue, index) => {
          const scriptText = cueScriptText(
            cue,
            workspace.scenario.roles,
            workspace.scenario.assets,
          );
          const scriptNote = cueScriptNote(cue);
          const isEditing = editor?.mode === "edit" && editor.cueId === cue.id;
          const displayIndex =
            index +
            1 +
            (editor?.mode === "create" && editor.index <= index ? 1 : 0);
          return (
            <Fragment key={cue.id}>
              {renderInsertSlot(index)}
              {renderCreateEditor(index)}
              <li
                className={
                  isEditing ? "cue-track cue-track-editor" : "cue-track"
                }
                data-cue-id={cue.id}
              >
                <span className="cue-index">{displayIndex}</span>
                {isEditing ? (
                  <CueEditor
                    scenario={workspace.scenario}
                    cue={cue}
                    onClose={() => setEditor(undefined)}
                    onSubmit={submitCue}
                  />
                ) : (
                  <article
                    className="cue-card"
                    data-active={cue.id === activeCueId}
                    data-dragging={cue.id === draggedCueId}
                  >
                    <span
                      className="cue-drag-handle"
                      draggable={editor === undefined}
                      title={`${scriptText}をドラッグして並べ替え`}
                      aria-hidden="true"
                      onDragStart={(event) => {
                        draggedCueIdRef.current = cue.id;
                        setDraggedCueId(cue.id);
                        setDropIndex(index);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", cue.id);
                        const card = event.currentTarget.closest(".cue-card");
                        if (card) event.dataTransfer.setDragImage(card, 20, 20);
                      }}
                      onDragEnd={resetDrag}
                    >
                      <GripVertical size={16} />
                    </span>
                    <button
                      className="cue-main"
                      onClick={() => setEditor({ mode: "edit", cueId: cue.id })}
                    >
                      <span
                        className={`cue-icon kind-${cue.kind.replace(".", "-")}`}
                        title={cueKindLabel[cue.kind]}
                      >
                        <CueKindIcon kind={cue.kind} />
                      </span>
                      <span className="cue-copy">
                        <span className="cue-script-text">
                          <span className="visually-hidden">
                            {cueKindLabel[cue.kind]}:{" "}
                          </span>
                          {scriptText}
                        </span>
                        {scriptNote && (
                          <span className="cue-script-note">
                            （{scriptNote}）
                          </span>
                        )}
                      </span>
                      {cue.id === activeCueId && (
                        <span className="live-indicator">
                          <span /> LIVE
                        </span>
                      )}
                    </button>
                    <div className="cue-actions">
                      <IconButton
                        label="この行を編集"
                        onClick={() =>
                          setEditor({ mode: "edit", cueId: cue.id })
                        }
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
                    <CueActionMenu
                      label={scriptText}
                      canMoveUp={index > 0}
                      canMoveDown={index < lane.cues.length - 1}
                      onEdit={() => setEditor({ mode: "edit", cueId: cue.id })}
                      onMoveUp={() =>
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
                      onMoveDown={() =>
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
                      onDelete={() =>
                        void dispatch({
                          type: "cue.delete",
                          expectedRevision:
                            application.store.getSnapshot().revision,
                          sceneId: scene.id,
                          laneId: lane.id,
                          cueId: cue.id,
                        })
                      }
                    />
                  </article>
                )}
              </li>
            </Fragment>
          );
        })}
        {lane.cues.length > 0 && renderInsertSlot(lane.cues.length, true)}
        {renderCreateEditor(lane.cues.length)}
      </ol>
      {lane.cues.length === 0 && !editor && (
        <button
          className="empty-lane"
          onClick={() => setEditor({ mode: "create", index: 0 })}
        >
          <Plus size={20} /> 台本の最初の行を書く
        </button>
      )}
    </section>
  );
};

const readBrowserVoices = (): readonly SpeechSynthesisVoice[] => {
  if (typeof globalThis.speechSynthesis === "undefined") return [];
  return [...globalThis.speechSynthesis.getVoices()].sort((left, right) => {
    const leftJapanese = left.lang.toLowerCase().startsWith("ja") ? 0 : 1;
    const rightJapanese = right.lang.toLowerCase().startsWith("ja") ? 0 : 1;
    return (
      leftJapanese - rightJapanese ||
      Number(right.default) - Number(left.default) ||
      Number(right.localService) - Number(left.localService) ||
      left.name.localeCompare(right.name)
    );
  });
};

const useBrowserVoices = () => {
  const [state, setState] = useState<
    Readonly<{
      voices: readonly SpeechSynthesisVoice[];
      status: "loading" | "ready" | "unavailable";
    }>
  >(() => {
    const voices = readBrowserVoices();
    return {
      voices,
      status:
        voices.length > 0
          ? "ready"
          : typeof globalThis.speechSynthesis === "undefined"
            ? "unavailable"
            : "loading",
    };
  });
  useEffect(() => {
    if (typeof globalThis.speechSynthesis === "undefined") {
      setState({ voices: [], status: "unavailable" });
      return;
    }
    const update = () => {
      const voices = readBrowserVoices();
      if (voices.length > 0) setState({ voices, status: "ready" });
    };
    update();
    globalThis.speechSynthesis.addEventListener("voiceschanged", update);
    const timeout = setTimeout(
      () =>
        setState((current) =>
          current.voices.length > 0
            ? current
            : { voices: [], status: "unavailable" },
        ),
      BROWSER_VOICE_READY_TIMEOUT_MS,
    );
    return () => {
      clearTimeout(timeout);
      globalThis.speechSynthesis.removeEventListener("voiceschanged", update);
    };
  }, []);
  return state;
};

const browserVoiceValue = (voice: SpeechSynthesisVoice) =>
  voice.voiceURI || voice.name;

const BrowserVoiceSelect = ({
  ariaLabel,
  locale,
  onChange,
  value,
  voices,
}: Readonly<{
  ariaLabel: string;
  locale?: string | undefined;
  onChange: (voiceId: string) => void;
  value: string;
  voices: readonly SpeechSynthesisVoice[];
}>) => {
  const isAvailable =
    value === DEFAULT_BROWSER_VOICE_ID ||
    voices.some((voice) => voice.voiceURI === value || voice.name === value);
  let defaultLabel = "ブラウザ既定";
  if (voices.length > 0) {
    const resolved = resolveSpeechSynthesisVoice(voices, {
      voiceId: DEFAULT_BROWSER_VOICE_ID,
      ...(locale ? { locale } : {}),
    });
    defaultLabel = `ブラウザ既定 · ${resolved.name} (${resolved.lang})`;
  }

  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value={DEFAULT_BROWSER_VOICE_ID}>{defaultLabel}</option>
      {!isAvailable && (
        <option value={value} disabled>
          {value}（このブラウザでは利用不可）
        </option>
      )}
      {voices.map((voice) => {
        const optionValue = browserVoiceValue(voice);
        return (
          <option value={optionValue} key={`${optionValue}:${voice.lang}`}>
            {voice.name} · {voice.lang}
            {voice.localService ? " · ローカル" : " · リモート"}
          </option>
        );
      })}
    </select>
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
  const [voiceId, setVoiceId] = useState(DEFAULT_BROWSER_VOICE_ID);
  const browserVoiceState = useBrowserVoices();
  const browserVoices = browserVoiceState.voices;
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [gateway, setGateway] = useState({
    gatewayUrl: "ws://127.0.0.1:8787",
    token: "",
    sessionId: "stage",
    ttsEndpoint: "",
    ttsToken: "",
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

  const saveRoleVoice = async (role: Role, nextVoiceId: string) => {
    const result = await application.store.dispatch({
      type: "role.update",
      expectedRevision: application.store.getSnapshot().revision,
      roleId: role.id,
      role: {
        ...role,
        voice: {
          ...role.voice,
          provider: "browser",
          voiceId: nextVoiceId,
        },
      },
    });
    setNotice(
      result.ok
        ? { tone: "success", message: `${role.name}の音声を更新しました` }
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

      {browserVoiceState.status === "unavailable" &&
        !application.isTtsEndpointConfigured() && (
          <p className="capability-note" role="status">
            この環境ではブラウザ音声を利用できません。音声付き上演には、ブラウザ再生可能な音声を返すOpus
            TTS endpointが必要です。
          </p>
        )}

      <div className="cast-grid">
        {workspace.scenario.roles.map((role) => {
          const assigned = ownRecordValue(scoped.assignments, role.id) ?? "";
          const roleVoice = role.voice ?? {
            provider: "browser",
            voiceId: DEFAULT_BROWSER_VOICE_ID,
            locale: "ja-JP",
          };
          return (
            <div className="cast-row" key={role.id}>
              <div className="role-avatar">{role.name.slice(0, 1)}</div>
              <div className="role-copy">
                <strong>{role.name}</strong>
                <span>{role.description || role.id}</span>
              </div>
              <div className="cast-controls">
                <label className="cast-control">
                  <span>Actor</span>
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
                        {actor.availability !== "online"
                          ? "（オフライン）"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cast-control">
                  <span>ブラウザ音声</span>
                  <BrowserVoiceSelect
                    ariaLabel={`${role.name}のブラウザ音声`}
                    locale={roleVoice.locale}
                    value={roleVoice.voiceId}
                    voices={browserVoices}
                    onChange={(nextVoiceId) =>
                      void saveRoleVoice(role, nextVoiceId)
                    }
                  />
                </label>
              </div>
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
            <span>ブラウザ音声</span>
            <BrowserVoiceSelect
              ariaLabel="新しい役のブラウザ音声"
              locale="ja-JP"
              value={voiceId}
              voices={browserVoices}
              onChange={setVoiceId}
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
                  ...(gateway.ttsToken.trim()
                    ? { ttsToken: gateway.ttsToken.trim() }
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
                placeholder="http://127.0.0.1:8788/stage/v1/tts/opus"
              />
              <small className="field-hint">
                実機でセリフを上演する場合に指定
              </small>
            </label>
            <label className="field">
              <span>Opus TTS token</span>
              <input
                type="password"
                value={gateway.ttsToken}
                onChange={(event) =>
                  setGateway((current) => ({
                    ...current,
                    ttsToken: event.target.value,
                  }))
                }
                autoComplete="off"
              />
              <small className="field-hint">
                Stack-chan AI側の専用token（URLには含めません）
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
  const [importProgress, setImportProgress] =
    useState<FileAssetImportProgress>();
  const importing = importProgress !== undefined;
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
            disabled={importing}
            onChange={(event) =>
              setKind(event.target.value === "music" ? "music" : "backdrop")
            }
          >
            <option value="backdrop">背景</option>
            <option value="music">BGM</option>
          </select>
          <button
            className="button primary"
            aria-label={
              importProgress
                ? `${importProgress.current}/${importProgress.total}件目、${importProgress.fileName}を取込中`
                : "素材ファイルをまとめて追加"
            }
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            {importing ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Files size={15} />
            )}
            {importProgress
              ? `${importProgress.current}/${importProgress.total} 取込中`
              : "まとめて追加"}
          </button>
          <input
            ref={fileRef}
            className="visually-hidden"
            type="file"
            multiple
            accept={kind === "backdrop" ? "image/*" : "audio/*"}
            onChange={async (event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length === 0) return;
              const selectedKind = kind;
              try {
                const summary = await importFileAssets(files, selectedKind, {
                  prepare: application.importFileAsset,
                  async add(asset) {
                    const snapshot = application.store.getSnapshot();
                    if (
                      snapshot.scenario.assets.some(
                        (current) => current.id === asset.id,
                      )
                    )
                      return { ok: true, added: false };
                    const result = await application.store.dispatch({
                      type: "asset.import",
                      expectedRevision: snapshot.revision,
                      asset,
                    });
                    return result.ok
                      ? { ok: true, added: true }
                      : {
                          ok: false,
                          message: result.message,
                          issues: result.validationIssues,
                        };
                  },
                  onProgress: setImportProgress,
                });
                const added = summary.added.length;
                const skipped = summary.skipped.length;
                const failed = summary.failures.length;
                if (failed > 0) {
                  const first = summary.failures[0];
                  const firstFailure = first
                    ? `${first.fileName}: ${first.message}`
                    : "不明なファイル";
                  setNotice({
                    tone: "error",
                    message: `${added}件を追加、${failed}件を追加できませんでした：${firstFailure}`,
                    issues: summary.failures.flatMap((failure) =>
                      failure.issues.length > 0
                        ? failure.issues.map((entry) => ({
                            ...entry,
                            message: `${failure.fileName}: ${entry.message}`,
                          }))
                        : [
                            {
                              code: "asset.file_import_failed",
                              message: `${failure.fileName}: ${failure.message}`,
                              path: [],
                              severity: "error" as const,
                            },
                          ],
                    ),
                  });
                } else if (added > 0)
                  setNotice({
                    tone: "success",
                    message: `${added}件の素材を追加しました${skipped > 0 ? `（追加済み${skipped}件）` : ""}`,
                  });
                else
                  setNotice({
                    tone: "info",
                    message: `${skipped}件の素材は追加済みです`,
                  });
              } finally {
                setImportProgress(undefined);
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
          <span>背景画像またはBGMをまとめて追加</span>
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
                  workspace.scenario.assets,
                )
              : `${selectedScene.lanes[0]?.cues.length ?? 0} キュー`}
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
          <Clapperboard size={14} /> {workspace.scenario.scenes.length} 場面 ·{" "}
          {workspace.scenario.scenes.reduce(
            (count, scene) =>
              count +
              scene.lanes.reduce(
                (laneCount, lane) => laneCount + lane.cues.length,
                0,
              ),
            0,
          )}{" "}
          キュー
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
