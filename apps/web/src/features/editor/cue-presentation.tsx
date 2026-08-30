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

import type { Cue, Role } from "@stackchan-stage/domain";

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

export const cueSummary = (cue: Cue, roles: readonly Role[]) => {
  const role =
    "roleId" in cue
      ? roles.find((candidate) => candidate.id === cue.roleId)?.name
      : undefined;
  switch (cue.kind) {
    case "speech":
      return `${role ?? cue.roleId}「${cue.text}」`;
    case "expression":
      return `${role ?? cue.roleId} · ${cue.expression}`;
    case "motion":
      return `${role ?? cue.roleId} · ${cue.motion.kind === "preset" ? cue.motion.name : "ポーズ"}`;
    case "lighting.set":
      return `${role ?? cue.roleId} · ${cue.color} · ${Math.round(cue.brightness * 100)}%`;
    case "lighting.play":
      return `${role ?? cue.roleId} · ${cue.effect}`;
    case "backdrop.set":
      return `${cue.assetId} · ${cue.transition.kind}`;
    case "music.start":
      return `${cue.assetId} · ${Math.round(cue.volume * 100)}%`;
    case "music.stop":
      return `${cue.fadeOutMs} ms`;
    case "pause":
      return `${cue.durationMs} ms`;
  }
};
