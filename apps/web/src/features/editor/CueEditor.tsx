import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { cueSchema, type Cue, type Scenario } from "@stackchan-stage/domain";

import {
  CueKindIcon,
  cueKindLabel,
  motionPresetOptions,
} from "./cue-presentation";

type FormState = Readonly<{
  id: string;
  label: string;
  kind: Cue["kind"];
  roleId: string;
  text: string;
  direction: string;
  expression: string;
  motionKind: "preset" | "pose";
  motionName: string;
  yaw: string;
  pitch: string;
  roll: string;
  durationMs: string;
  color: string;
  brightness: string;
  effect: string;
  assetId: string;
  transition: "cut" | "fade" | "slide";
  transitionDirection: "left" | "right" | "up" | "down";
  loop: boolean;
  volume: string;
  fadeMs: string;
}>;

const kinds: readonly Cue["kind"][] = [
  "speech",
  "expression",
  "motion",
  "lighting.set",
  "lighting.play",
  "backdrop.set",
  "music.start",
  "music.stop",
  "pause",
];

const isCueKind = (value: string): value is Cue["kind"] =>
  kinds.some((kind) => kind === value);

const transitionDirections: readonly FormState["transitionDirection"][] = [
  "left",
  "right",
  "up",
  "down",
];

const isTransitionDirection = (
  value: string,
): value is FormState["transitionDirection"] =>
  transitionDirections.some((direction) => direction === value);

const numberFromInput = (value: string) =>
  value.trim() === "" ? Number.NaN : Number(value);

const cueValidationMessage = (path: readonly PropertyKey[]) => {
  switch (path[0]) {
    case "text":
      return "セリフを入力してください";
    case "roleId":
      return "役を選択してください";
    case "assetId":
      return "素材を選択してください";
    case "brightness":
    case "volume":
      return "0〜1の範囲で入力してください";
    case "durationMs":
    case "fadeInMs":
    case "fadeOutMs":
    case "parameters":
    case "transition":
      return "時間は0以上の数値で入力してください";
    case "motion":
      return "ポーズの角度と時間を確認してください";
    default:
      return "入力内容を確認してください";
  }
};

const initialForm = (scenario: Scenario, cue?: Cue): FormState => {
  const firstRole = scenario.roles[0]?.id ?? "";
  const firstBackdrop =
    scenario.assets.find((asset) => asset.kind === "backdrop")?.id ?? "";
  const firstMusic =
    scenario.assets.find((asset) => asset.kind === "music")?.id ?? "";
  const base: FormState = {
    id: cue?.id ?? `cue-${crypto.randomUUID()}`,
    label: cue?.label ?? "",
    kind: cue?.kind ?? "speech",
    roleId: cue && "roleId" in cue ? cue.roleId : firstRole,
    text: cue?.kind === "speech" ? cue.text : "",
    direction: cue?.kind === "speech" ? (cue.direction ?? "") : "",
    expression: cue?.kind === "expression" ? cue.expression : "HAPPY",
    motionKind: cue?.kind === "motion" ? cue.motion.kind : "preset",
    motionName:
      cue?.kind === "motion" && cue.motion.kind === "preset"
        ? cue.motion.name
        : "nod",
    yaw:
      cue?.kind === "motion" && cue.motion.kind === "pose"
        ? String(cue.motion.yaw)
        : "0",
    pitch:
      cue?.kind === "motion" && cue.motion.kind === "pose"
        ? String(cue.motion.pitch)
        : "0",
    roll:
      cue?.kind === "motion" && cue.motion.kind === "pose"
        ? String(cue.motion.roll ?? 0)
        : "0",
    durationMs:
      cue?.kind === "motion" && cue.motion.kind === "pose"
        ? String(cue.motion.durationMs)
        : cue?.kind === "pause"
          ? String(cue.durationMs)
          : "600",
    color: cue?.kind === "lighting.set" ? cue.color : "#f6c344",
    brightness: cue?.kind === "lighting.set" ? String(cue.brightness) : "0.65",
    effect: cue?.kind === "lighting.play" ? cue.effect : "pulse",
    assetId:
      cue?.kind === "backdrop.set" || cue?.kind === "music.start"
        ? cue.assetId
        : firstBackdrop || firstMusic,
    transition: cue?.kind === "backdrop.set" ? cue.transition.kind : "fade",
    transitionDirection:
      cue?.kind === "backdrop.set" && cue.transition.kind === "slide"
        ? cue.transition.direction
        : "left",
    loop: cue?.kind === "music.start" ? cue.loop : true,
    volume: cue?.kind === "music.start" ? String(cue.volume) : "0.65",
    fadeMs:
      cue?.kind === "music.start"
        ? String(cue.fadeInMs)
        : cue?.kind === "music.stop"
          ? String(cue.fadeOutMs)
          : "500",
  };
  return base;
};

const rawCue = (form: FormState): Record<string, unknown> => {
  const base = {
    id: form.id.trim(),
    ...(form.label.trim() ? { label: form.label.trim() } : {}),
  };
  switch (form.kind) {
    case "speech":
      return {
        ...base,
        kind: form.kind,
        roleId: form.roleId,
        text: form.text,
        ...(form.direction.trim() ? { direction: form.direction.trim() } : {}),
      };
    case "expression":
      return {
        ...base,
        kind: form.kind,
        roleId: form.roleId,
        expression: form.expression,
      };
    case "motion":
      return {
        ...base,
        kind: form.kind,
        roleId: form.roleId,
        motion:
          form.motionKind === "preset"
            ? { kind: "preset", name: form.motionName }
            : {
                kind: "pose",
                yaw: numberFromInput(form.yaw),
                pitch: numberFromInput(form.pitch),
                roll: numberFromInput(form.roll),
                durationMs: numberFromInput(form.durationMs),
              },
      };
    case "lighting.set":
      return {
        ...base,
        kind: form.kind,
        roleId: form.roleId,
        color: form.color,
        brightness: numberFromInput(form.brightness),
      };
    case "lighting.play":
      return {
        ...base,
        kind: form.kind,
        roleId: form.roleId,
        effect: form.effect,
        parameters: {
          durationMs: numberFromInput(form.durationMs),
          color: form.color,
        },
      };
    case "backdrop.set":
      return {
        ...base,
        kind: form.kind,
        assetId: form.assetId,
        transition:
          form.transition === "cut"
            ? { kind: "cut" }
            : form.transition === "fade"
              ? { kind: "fade", durationMs: numberFromInput(form.fadeMs) }
              : {
                  kind: "slide",
                  direction: form.transitionDirection,
                  durationMs: numberFromInput(form.fadeMs),
                },
      };
    case "music.start":
      return {
        ...base,
        kind: form.kind,
        assetId: form.assetId,
        loop: form.loop,
        volume: numberFromInput(form.volume),
        fadeInMs: numberFromInput(form.fadeMs),
      };
    case "music.stop":
      return {
        ...base,
        kind: form.kind,
        fadeOutMs: numberFromInput(form.fadeMs),
      };
    case "pause":
      return {
        ...base,
        kind: form.kind,
        durationMs: numberFromInput(form.durationMs),
      };
  }
};

type CueEditorProps = Readonly<{
  scenario: Scenario;
  cue?: Cue;
  onClose: () => void;
  onSubmit: (cue: Cue) => Promise<void> | void;
}>;

export const CueEditor = ({
  scenario,
  cue,
  onClose,
  onSubmit,
}: CueEditorProps) => {
  const titleId = useId();
  const errorId = useId();
  const editorRef = useRef<HTMLElement>(null);
  const [form, setForm] = useState(() => initialForm(scenario, cue));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const assets = useMemo(
    () =>
      scenario.assets.filter((asset) =>
        form.kind === "backdrop.set"
          ? asset.kind === "backdrop"
          : asset.kind === "music",
      ),
    [form.kind, scenario.assets],
  );
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const updateKind = (kind: Cue["kind"]) => {
    const assetId =
      kind === "backdrop.set"
        ? (scenario.assets.find((asset) => asset.kind === "backdrop")?.id ?? "")
        : kind === "music.start"
          ? (scenario.assets.find((asset) => asset.kind === "music")?.id ?? "")
          : undefined;
    setForm((current) => ({
      ...current,
      kind,
      ...(assetId !== undefined ? { assetId } : {}),
    }));
  };

  useEffect(() => {
    const focusInside = window.requestAnimationFrame(() => {
      editorRef.current
        ?.querySelector<HTMLElement>(
          "[data-cue-primary], select:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
        )
        ?.focus();
    });
    return () => window.cancelAnimationFrame(focusInside);
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = cueSchema.safeParse(rawCue(form));
    if (!parsed.success) {
      setError(cueValidationMessage(parsed.error.issues[0]?.path ?? []));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onSubmit(parsed.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSaving(false);
    }
  };

  const roleField = [
    "speech",
    "expression",
    "motion",
    "lighting.set",
    "lighting.play",
  ].includes(form.kind);

  return (
    <article
      ref={editorRef}
      className="cue-inline-editor"
      aria-labelledby={titleId}
      aria-describedby={error ? errorId : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="cue-editor-header">
        <div className="cue-editor-heading">
          <span className={`cue-icon kind-${form.kind.replace(".", "-")}`}>
            <CueKindIcon kind={form.kind} />
          </span>
          <div>
            <span className="eyebrow">{cue ? "EDITING" : "NEW LINE"}</span>
            <h3 id={titleId}>{cue ? "台本を編集" : "台本に行を追加"}</h3>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          title="編集を閉じる"
          aria-label="編集を閉じる"
        >
          <X size={18} />
        </button>
      </header>
      <form className="cue-editor-form" onSubmit={save}>
        <div className="field-grid two-columns">
          <label className="field">
            <span>種類</span>
            <select
              value={form.kind}
              onChange={(event) => {
                if (isCueKind(event.target.value))
                  updateKind(event.target.value);
              }}
            >
              {kinds.map((kind) => (
                <option value={kind} key={kind}>
                  {cueKindLabel[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>注記</span>
            <input
              value={form.label}
              onChange={(event) => update("label", event.target.value)}
              placeholder="任意"
            />
          </label>
        </div>

        {roleField && (
          <label className="field">
            <span>役</span>
            <select
              value={form.roleId}
              onChange={(event) => update("roleId", event.target.value)}
              required
            >
              {scenario.roles.map((role) => (
                <option value={role.id} key={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {form.kind === "speech" && (
          <>
            <label className="field">
              <span>セリフ</span>
              <textarea
                data-cue-primary
                rows={4}
                value={form.text}
                onChange={(event) => update("text", event.target.value)}
                required
                autoFocus
              />
            </label>
            <label className="field">
              <span>演技指示</span>
              <input
                value={form.direction}
                onChange={(event) => update("direction", event.target.value)}
                placeholder="任意"
              />
            </label>
          </>
        )}

        {form.kind === "expression" && (
          <label className="field">
            <span>表情</span>
            <select
              value={form.expression}
              onChange={(event) => update("expression", event.target.value)}
            >
              {[
                "NEUTRAL",
                "HAPPY",
                "ANGRY",
                "SAD",
                "SLEEPY",
                "DOUBTFUL",
                "COLD",
                "HOT",
              ].map((expression) => (
                <option key={expression}>{expression}</option>
              ))}
            </select>
          </label>
        )}

        {form.kind === "motion" && (
          <>
            <label className="field">
              <span>指定方法</span>
              <select
                value={form.motionKind}
                onChange={(event) =>
                  update(
                    "motionKind",
                    event.target.value === "pose" ? "pose" : "preset",
                  )
                }
              >
                <option value="preset">プリセット</option>
                <option value="pose">ポーズ</option>
              </select>
            </label>
            {form.motionKind === "preset" ? (
              <label className="field">
                <span>プリセット</span>
                <select
                  value={form.motionName}
                  onChange={(event) => update("motionName", event.target.value)}
                >
                  {motionPresetOptions.map(({ name, label }) => (
                    <option key={name} value={name}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="field-grid four-columns">
                {(["yaw", "pitch", "roll", "durationMs"] as const).map(
                  (key) => (
                    <label className="field" key={key}>
                      <span>{key === "durationMs" ? "時間 (ms)" : key}</span>
                      <input
                        type="number"
                        step={key === "durationMs" ? 10 : 0.01}
                        value={form[key]}
                        onChange={(event) => update(key, event.target.value)}
                      />
                    </label>
                  ),
                )}
              </div>
            )}
          </>
        )}

        {(form.kind === "lighting.set" || form.kind === "lighting.play") && (
          <div className="field-grid three-columns">
            <label className="field">
              <span>色</span>
              <input
                type="color"
                value={form.color}
                onChange={(event) => update("color", event.target.value)}
              />
            </label>
            {form.kind === "lighting.set" ? (
              <label className="field">
                <span>明るさ</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={form.brightness}
                  onChange={(event) => update("brightness", event.target.value)}
                />
              </label>
            ) : (
              <>
                <label className="field">
                  <span>効果</span>
                  <select
                    value={form.effect}
                    onChange={(event) => update("effect", event.target.value)}
                  >
                    {["blink", "pulse", "rainbow"].map((effect) => (
                      <option key={effect}>{effect}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>時間 (ms)</span>
                  <input
                    type="number"
                    min="100"
                    value={form.durationMs}
                    onChange={(event) =>
                      update("durationMs", event.target.value)
                    }
                  />
                </label>
              </>
            )}
          </div>
        )}

        {(form.kind === "backdrop.set" || form.kind === "music.start") && (
          <label className="field">
            <span>素材</span>
            <select
              value={form.assetId}
              onChange={(event) => update("assetId", event.target.value)}
              required
            >
              <option value="" disabled>
                素材を選択
              </option>
              {assets.map((asset) => (
                <option value={asset.id} key={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
            {assets.length === 0 && (
              <small className="field-hint">
                先に素材タブからファイルを追加してください
              </small>
            )}
          </label>
        )}

        {form.kind === "backdrop.set" && (
          <div className="field-grid three-columns">
            <label className="field">
              <span>切替</span>
              <select
                value={form.transition}
                onChange={(event) =>
                  update(
                    "transition",
                    event.target.value === "cut" ||
                      event.target.value === "slide"
                      ? event.target.value
                      : "fade",
                  )
                }
              >
                <option value="cut">カット</option>
                <option value="fade">フェード</option>
                <option value="slide">スライド</option>
              </select>
            </label>
            {form.transition !== "cut" && (
              <label className="field">
                <span>時間 (ms)</span>
                <input
                  type="number"
                  min="0"
                  value={form.fadeMs}
                  onChange={(event) => update("fadeMs", event.target.value)}
                />
              </label>
            )}
            {form.transition === "slide" && (
              <label className="field">
                <span>方向</span>
                <select
                  value={form.transitionDirection}
                  onChange={(event) => {
                    if (isTransitionDirection(event.target.value))
                      update("transitionDirection", event.target.value);
                  }}
                >
                  {transitionDirections.map((direction) => (
                    <option key={direction}>{direction}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {form.kind === "music.start" && (
          <div className="field-grid three-columns">
            <label className="field">
              <span>音量</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={form.volume}
                onChange={(event) => update("volume", event.target.value)}
              />
            </label>
            <label className="field">
              <span>フェード (ms)</span>
              <input
                type="number"
                min="0"
                value={form.fadeMs}
                onChange={(event) => update("fadeMs", event.target.value)}
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={form.loop}
                onChange={(event) => update("loop", event.target.checked)}
              />
              <span>ループ</span>
            </label>
          </div>
        )}

        {form.kind === "music.stop" && (
          <label className="field">
            <span>フェードアウト (ms)</span>
            <input
              type="number"
              min="0"
              value={form.fadeMs}
              onChange={(event) => update("fadeMs", event.target.value)}
            />
          </label>
        )}
        {form.kind === "pause" && (
          <label className="field">
            <span>時間 (ms)</span>
            <input
              type="number"
              min="0"
              value={form.durationMs}
              onChange={(event) => update("durationMs", event.target.value)}
            />
          </label>
        )}

        {error && (
          <p className="form-error" id={errorId} role="alert">
            {error}
          </p>
        )}
        <footer className="cue-editor-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            キャンセル
          </button>
          <button className="button primary" type="submit" disabled={saving}>
            {saving ? "保存中" : "保存"}
          </button>
        </footer>
      </form>
    </article>
  );
};
