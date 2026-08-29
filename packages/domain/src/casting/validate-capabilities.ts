import { issue, type ValidationIssue } from "../shared";
import type { Cue } from "../scenario/types";
import {
  DEFAULT_AUDIO_FORMAT,
  type Actor,
  type CapabilityRequirement,
} from "./types";

export const requiredCapabilities = (
  cue: Cue,
): readonly CapabilityRequirement[] => {
  switch (cue.kind) {
    case "speech":
      return [
        {
          kind: "speech",
          format: DEFAULT_AUDIO_FORMAT,
          playbackEndedAck: true,
        },
      ];
    case "expression":
      return [{ kind: "expression", expression: cue.expression }];
    case "motion":
      return cue.motion.kind === "preset"
        ? [{ kind: "motion.preset", name: cue.motion.name }]
        : [
            {
              kind: "motion.pose",
              axes:
                cue.motion.roll === undefined
                  ? ["yaw", "pitch"]
                  : ["yaw", "pitch", "roll"],
              duration: true,
            },
          ];
    case "lighting.set":
      return [{ kind: "lighting.set" }];
    case "lighting.play":
      return [{ kind: "lighting.play", effect: cue.effect }];
    default:
      return [];
  }
};

const sameFormat = (
  left: typeof DEFAULT_AUDIO_FORMAT,
  right: typeof DEFAULT_AUDIO_FORMAT,
): boolean =>
  left.codec === right.codec &&
  left.sampleRate === right.sampleRate &&
  left.channels === right.channels &&
  left.frameDurationMs === right.frameDurationMs;

export const validateCueForActor = (
  cue: Cue,
  actor: Actor,
): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const requirement of requiredCapabilities(cue)) {
    let supported = false;
    switch (requirement.kind) {
      case "speech":
        supported =
          actor.capabilities.speech?.playbackEndedAck === true &&
          actor.capabilities.speech.formats.some((format) =>
            sameFormat(format, requirement.format),
          ) === true;
        break;
      case "expression":
        supported =
          actor.capabilities.expressions?.includes(requirement.expression) ===
          true;
        break;
      case "motion.preset":
        supported =
          actor.capabilities.motion?.presets.includes(requirement.name) ===
          true;
        break;
      case "motion.pose":
        supported =
          actor.capabilities.motion?.pose?.duration === true &&
          requirement.axes.every(
            (axis) =>
              actor.capabilities.motion?.pose?.axes.includes(axis) === true,
          );
        break;
      case "lighting.set":
        supported = actor.capabilities.lighting?.setColor === true;
        break;
      case "lighting.play":
        supported =
          actor.capabilities.lighting?.effects.includes(requirement.effect) ===
          true;
        break;
    }
    if (!supported) {
      issues.push(
        issue(
          "actor.capability_missing",
          `Actor「${actor.name}」はCue ${cue.id} に必要な ${requirement.kind} capabilityを満たしません`,
          ["actors", actor.id, "capabilities"],
        ),
      );
    }
  }
  return issues;
};
