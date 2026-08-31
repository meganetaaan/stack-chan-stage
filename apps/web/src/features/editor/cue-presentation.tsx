import {
  AudioLines,
  Clock3,
  Image,
  Lightbulb,
  MessageSquareText,
  Music,
  Music2,
  PersonStanding,
  Smile,
} from "lucide-react";

import type { AssetMetadata, Cue, Role } from "@stackchan-stage/domain";

export const cueKindLabel: Record<Cue["kind"], string> = {
  speech: "セリフ",
  expression: "表情",
  motion: "モーション",
  "lighting.set": "照明",
  "lighting.play": "照明エフェクト",
  "backdrop.set": "背景",
  "music.start": "BGM開始",
  "music.stop": "BGM停止",
  pause: "間",
};

export const CueKindIcon = ({ kind }: Readonly<{ kind: Cue["kind"] }>) => {
  const properties = { size: 16, strokeWidth: 1.8, "aria-hidden": true };
  switch (kind) {
    case "speech":
      return <MessageSquareText {...properties} />;
    case "expression":
      return <Smile {...properties} />;
    case "motion":
      return <PersonStanding {...properties} />;
    case "lighting.set":
      return <Lightbulb {...properties} />;
    case "lighting.play":
      return <AudioLines {...properties} />;
    case "backdrop.set":
      return <Image {...properties} />;
    case "music.start":
      return <Music {...properties} />;
    case "music.stop":
      return <Music2 {...properties} />;
    case "pause":
      return <Clock3 {...properties} />;
  }
};

const expressionLabel: Readonly<Record<string, string>> = {
  NEUTRAL: "いつもの表情",
  HAPPY: "笑顔",
  ANGRY: "怒った表情",
  SAD: "悲しい表情",
  SLEEPY: "眠そうな表情",
  DOUBTFUL: "不思議そうな表情",
  COLD: "寒そうな表情",
  HOT: "暑そうな表情",
};

export const motionPresetOptions = [
  { name: "neutral", label: "正面を向く" },
  { name: "nod", label: "うなずく" },
  { name: "shake", label: "首を横に振る" },
  { name: "tilt", label: "首をかしげる" },
  { name: "bow", label: "お辞儀する" },
  { name: "look-around", label: "あたりを見回す" },
  { name: "look-left", label: "左を見る" },
  { name: "look-right", label: "右を見る" },
  { name: "clap", label: "拍手する" },
  { name: "thinking", label: "手を添えて考える" },
] as const;

const motionLabel = Object.fromEntries(
  motionPresetOptions.map(({ name, label }) => [name, label]),
);

const formatDuration = (durationMs: number) =>
  durationMs >= 1_000
    ? `${Number((durationMs / 1_000).toFixed(1))}秒`
    : `${durationMs}ミリ秒`;

export const cueScriptText = (
  cue: Cue,
  roles: readonly Role[],
  assets: readonly AssetMetadata[] = [],
) => {
  const role =
    "roleId" in cue
      ? roles.find((candidate) => candidate.id === cue.roleId)?.name
      : undefined;
  const roleName = "roleId" in cue ? (role ?? cue.roleId) : undefined;
  const assetName =
    "assetId" in cue
      ? (assets.find((asset) => asset.id === cue.assetId)?.name ?? cue.assetId)
      : undefined;
  switch (cue.kind) {
    case "speech":
      return `${roleName}「${cue.text}」`;
    case "expression":
      return `${roleName}　${expressionLabel[cue.expression] ?? cue.expression}`;
    case "motion":
      return cue.motion.kind === "preset"
        ? `${roleName}　${motionLabel[cue.motion.name] ?? cue.motion.name}`
        : `${roleName}　yaw ${cue.motion.yaw} / pitch ${cue.motion.pitch} / ${formatDuration(cue.motion.durationMs)}`;
    case "lighting.set":
      return `${roleName}のライト　${cue.color} / ${Math.round(cue.brightness * 100)}%`;
    case "lighting.play":
      return `${roleName}のライト　${cue.effect}`;
    case "backdrop.set":
      return `「${assetName}」へ${
        cue.transition.kind === "cut"
          ? "切り替える"
          : cue.transition.kind === "fade"
            ? `${formatDuration(cue.transition.durationMs)}かけてフェードする`
            : `${formatDuration(cue.transition.durationMs)}かけて${cue.transition.direction}へスライドする`
      }`;
    case "music.start":
      return `「${assetName}」を音量${Math.round(cue.volume * 100)}%で再生${cue.loop ? "（ループ）" : ""}`;
    case "music.stop":
      return cue.fadeOutMs > 0
        ? `${formatDuration(cue.fadeOutMs)}でフェードアウト`
        : "すぐに停止";
    case "pause":
      return `${formatDuration(cue.durationMs)}、間を置く`;
  }
};

export const cueScriptNote = (cue: Cue) =>
  [cue.label, cue.kind === "speech" ? cue.direction : undefined]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

export const cueSummary = cueScriptText;
