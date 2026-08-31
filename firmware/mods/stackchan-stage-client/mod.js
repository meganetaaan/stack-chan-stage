import { emotionFromName } from "face-state";
import archiveConfig from "mod/config";
import { createStageClientCore } from "stage-client-core";
import { createStageLipSync } from "stage-lip-sync";
import { createStageMotion } from "stage-motion-presets";
import { createStageRuntimeEnvironment } from "stage-runtime-environment";
import Timer from "timer";

const delay = (milliseconds) =>
  new Promise((resolve) => Timer.set(resolve, milliseconds));

const motion = createStageMotion(delay);
const lipSync = createStageLipSync(delay);

const defaultCapabilities = Object.freeze({
  protocolVersion: 1,
  speech: {
    formats: [
      { codec: "opus", sampleRate: 24000, channels: 1, frameDurationMs: 20 },
    ],
    streaming: true,
    playbackEndedAck: true,
  },
  expressions: [
    "NEUTRAL",
    "ANGRY",
    "SAD",
    "HAPPY",
    "SLEEPY",
    "DOUBTFUL",
    "COLD",
    "HOT",
  ],
  motion: {
    presets: [
      "neutral",
      "nod",
      "shake",
      "tilt",
      "bow",
      "look-around",
      "look-left",
      "look-right",
      "clap",
      "thinking",
    ],
    pose: { axes: ["yaw", "pitch", "roll"], duration: true },
  },
  lighting: { setColor: true, effects: ["blink", "pulse", "rainbow"] },
});

const stageError = (code, message, retryable = false) =>
  Object.assign(new Error(message), { code, retryable });

const parseColor = (value, brightness) => {
  const scale = Math.max(0, Math.min(1, brightness));
  return [1, 3, 5].map((offset) =>
    Math.round(Number.parseInt(value.slice(offset, offset + 2), 16) * scale),
  );
};

const applyLightingEffect = async (robot, cue) => {
  const durationMs = Math.max(100, Number(cue.parameters?.durationMs ?? 1200));
  const color = String(cue.parameters?.color ?? "#ffffff");
  const [red, green, blue] = parseColor(
    color,
    Number(cue.parameters?.brightness ?? 0.4),
  );
  switch (cue.effect) {
    case "blink":
    case "pulse":
      robot.lighting.lightBlink(
        "head",
        red,
        green,
        blue,
        Number(cue.parameters?.intervalMs ?? 180),
      );
      break;
    case "rainbow":
      robot.lighting.lightRainbow("head");
      break;
    default:
      throw stageError(
        "unsupported_lighting_effect",
        `Unsupported lighting effect: ${cue.effect}`,
      );
  }
  await delay(durationMs);
  robot.lighting.lightOff("head");
};

const createCueApplication = (robot, media) => async (command, lifecycle) => {
  const { cue } = command;
  switch (cue.kind) {
    case "speech":
      if (!command.audio)
        throw stageError(
          "audio_metadata_missing",
          "Speech Cue has no audio stream metadata",
        );
      await lipSync.play(
        robot.face,
        (markStarted) =>
          media.awaitPlayback(command.audio.streamId, markStarted),
        lifecycle.markStarted,
      );
      return;
    case "expression": {
      const emotion = emotionFromName(cue.expression);
      if (emotion === undefined)
        throw stageError(
          "unsupported_expression",
          `Unsupported expression: ${cue.expression}`,
        );
      lifecycle.markStarted();
      robot.face.setEmotion(emotion);
      return;
    }
    case "motion":
      lifecycle.markStarted();
      if (cue.motion.kind === "preset")
        await motion.playPreset(robot, cue.motion.name);
      else
        await motion.setPose(
          robot,
          cue.motion.yaw,
          cue.motion.pitch,
          cue.motion.roll ?? 0,
          cue.motion.durationMs,
        );
      return;
    case "lighting.set": {
      lifecycle.markStarted();
      const [red, green, blue] = parseColor(cue.color, cue.brightness);
      robot.lighting.lightOn("head", red, green, blue);
      return;
    }
    case "lighting.play":
      lifecycle.markStarted();
      await applyLightingEffect(robot, cue);
      return;
    default:
      throw stageError(
        "unsupported_cue",
        `Cue kind is not handled by an Actor: ${cue.kind}`,
      );
  }
};

export function onContextCreated(robot) {
  const supplied =
    globalThis.stackchanStage ?? archiveConfig.stage ?? archiveConfig;
  const config = {
    ...supplied,
    capabilities: supplied.capabilities ?? defaultCapabilities,
  };
  const environment = createStageRuntimeEnvironment(config);
  const core = createStageClientCore({
    actorId: config.actorId ?? "wasm-actor",
    sessionId: config.sessionId ?? "wasm-session",
    send: environment.send,
    applyCue: createCueApplication(robot, environment.media),
    cancelCue: async () => {
      await environment.media.abortActive("Cue cancelled");
      motion.hideHands(robot);
      await motion.setPose(robot, 0, 0, 0, 250);
      robot.lighting.lightOff("head");
    },
  });
  environment.start((message) => core.handleMessage(message));
}

export default { onContextCreated };
