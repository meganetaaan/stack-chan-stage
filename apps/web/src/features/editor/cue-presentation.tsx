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

const formatCueScriptText = (
  cue: Cue,
  roles: readonly Role[],
  assets: readonly AssetMetadata[] = [],
  omitRoleName = false,
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
      return `${omitRoleName ? "" : roleName}「${cue.text}」`;
    case "expression":
      return `${omitRoleName ? "" : roleName}（${expressionLabel[cue.expression] ?? cue.expression}）`;
    case "motion":
      if (cue.motion.kind === "preset") {
        const label = motionLabel[cue.motion.name] ?? cue.motion.name;
        return `${omitRoleName ? "" : roleName}（${label}）`;
      }
      return `${omitRoleName ? "" : roleName}（yaw ${cue.motion.yaw} / pitch ${cue.motion.pitch} / ${formatDuration(cue.motion.durationMs)}）`;
    case "lighting.set":
      return `${omitRoleName ? "" : `${roleName}の`}ライト　${cue.color} / ${Math.round(cue.brightness * 100)}%`;
    case "lighting.play":
      return `${omitRoleName ? "" : `${roleName}の`}ライト　${cue.effect}`;
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

export const cueScriptText = (
  cue: Cue,
  roles: readonly Role[],
  assets: readonly AssetMetadata[] = [],
) => formatCueScriptText(cue, roles, assets);

export type CueScriptLine = Readonly<{
  cue: Cue;
  text: string;
  fullText: string;
  continuesRole: boolean;
  roleName: string | undefined;
  roleNameVisible: boolean;
  bodyText: string;
  groupPosition: "none" | "single" | "start" | "middle" | "end";
}>;

type CueScriptLineDraft = Omit<CueScriptLine, "groupPosition"> &
  Readonly<{ groupRoleId: Role["id"] | undefined }>;

const roleNameFor = (roleId: Role["id"], roles: readonly Role[]) =>
  roles.find((role) => role.id === roleId)?.name ?? roleId;

const roleCueBodyText = (cue: Cue, roleNameVisible: boolean) => {
  switch (cue.kind) {
    case "speech":
      return `「${cue.text}」`;
    case "expression":
      return `（${expressionLabel[cue.expression] ?? cue.expression}）`;
    case "motion":
      return cue.motion.kind === "preset"
        ? `（${motionLabel[cue.motion.name] ?? cue.motion.name}）`
        : `（yaw ${cue.motion.yaw} / pitch ${cue.motion.pitch} / ${formatDuration(cue.motion.durationMs)}）`;
    case "lighting.set":
      return `${roleNameVisible ? "の" : ""}ライト　${cue.color} / ${Math.round(cue.brightness * 100)}%`;
    case "lighting.play":
      return `${roleNameVisible ? "の" : ""}ライト　${cue.effect}`;
    case "backdrop.set":
    case "music.start":
    case "music.stop":
    case "pause":
      return undefined;
  }
};

export const cueScriptLines = (
  cues: readonly Cue[],
  roles: readonly Role[],
  assets: readonly AssetMetadata[] = [],
): readonly CueScriptLine[] => {
  let activeRoleId: Role["id"] | undefined;
  let activeRoleName: string | undefined;

  const drafts: readonly CueScriptLineDraft[] = cues.map((cue) => {
    const roleId = "roleId" in cue ? cue.roleId : undefined;
    if (roleId !== undefined) {
      const roleName = roleNameFor(roleId, roles);
      const roleNameVisible = roleId !== activeRoleId;
      const bodyText = roleCueBodyText(cue, roleNameVisible);
      const fullText = formatCueScriptText(cue, roles, assets);

      activeRoleId = roleId;
      activeRoleName = roleName;
      return {
        cue,
        text:
          bodyText === undefined
            ? fullText
            : `${roleNameVisible ? roleName : ""}${bodyText}`,
        fullText,
        continuesRole: !roleNameVisible,
        roleName,
        roleNameVisible,
        bodyText: bodyText ?? fullText,
        groupRoleId: roleId,
      };
    }

    const fullText = formatCueScriptText(cue, roles, assets);
    if (cue.kind === "pause" && activeRoleId && activeRoleName) {
      return {
        cue,
        text: fullText,
        fullText,
        continuesRole: true,
        roleName: activeRoleName,
        roleNameVisible: false,
        bodyText: fullText,
        groupRoleId: activeRoleId,
      };
    }

    activeRoleId = undefined;
    activeRoleName = undefined;
    return {
      cue,
      text: fullText,
      fullText,
      continuesRole: false,
      roleName: undefined,
      roleNameVisible: false,
      bodyText: fullText,
      groupRoleId: undefined,
    };
  });

  return drafts.map(({ groupRoleId, ...line }, index) => {
    if (groupRoleId === undefined) return { ...line, groupPosition: "none" };

    const followsSameRole = drafts[index - 1]?.groupRoleId === groupRoleId;
    const precedesSameRole = drafts[index + 1]?.groupRoleId === groupRoleId;
    const groupPosition = followsSameRole
      ? precedesSameRole
        ? "middle"
        : "end"
      : precedesSameRole
        ? "start"
        : "single";
    return { ...line, groupPosition };
  });
};

export const cueScriptNote = (cue: Cue) =>
  [cue.label, cue.kind === "speech" ? cue.direction : undefined]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

export const cueSummary = cueScriptText;
