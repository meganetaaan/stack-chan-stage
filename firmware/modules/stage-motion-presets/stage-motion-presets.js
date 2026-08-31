export const createStageMotion = (delay) => {
  const playHandAnimation = async (robot, name, durationMs) => {
    if (typeof robot.ui?.setHandAnimation !== "function")
      throw Object.assign(new Error(`Hand animation is unavailable: ${name}`), {
        code: "unsupported_motion",
        retryable: false,
      });
    robot.ui.setHandAnimation(name);
    try {
      await delay(durationMs);
    } finally {
      robot.ui.setHandAnimation("none");
    }
  };

  const setPose = async (robot, yaw, pitch, roll, durationMs) => {
    await robot.motion.setPose(
      { rotation: { y: yaw, p: pitch, r: roll } },
      durationMs / 1000,
    );
    await delay(durationMs);
  };

  const playPreset = async (robot, name) => {
    switch (name) {
      case "neutral":
        await setPose(robot, 0, 0, 0, 350);
        return;
      case "nod":
        await setPose(robot, 0, 0.18, 0, 220);
        await setPose(robot, 0, -0.12, 0, 220);
        await setPose(robot, 0, 0, 0, 220);
        return;
      case "shake":
        await setPose(robot, -0.22, 0, 0, 220);
        await setPose(robot, 0.22, 0, 0, 300);
        await setPose(robot, 0, 0, 0, 220);
        return;
      case "tilt":
        await setPose(robot, 0, 0.04, 0.2, 320);
        await delay(450);
        await setPose(robot, 0, 0, 0, 320);
        return;
      case "bow":
        await setPose(robot, 0, 0.3, 0, 450);
        await delay(350);
        await setPose(robot, 0, 0, 0, 450);
        return;
      case "look-around":
        await setPose(robot, -0.3, 0.03, 0, 350);
        await delay(200);
        await setPose(robot, 0.3, 0.03, 0, 550);
        await delay(200);
        await setPose(robot, 0, 0, 0, 350);
        return;
      case "look-left":
        await setPose(robot, -0.28, 0, 0, 350);
        return;
      case "look-right":
        await setPose(robot, 0.28, 0, 0, 350);
        return;
      case "clap":
        await playHandAnimation(robot, "clap", 1650);
        return;
      case "thinking":
        await playHandAnimation(robot, "thinking", 2800);
        return;
      default:
        throw Object.assign(new Error(`Unsupported motion preset: ${name}`), {
          code: "unsupported_motion",
          retryable: false,
        });
    }
  };

  return Object.freeze({
    setPose,
    playPreset,
    hideHands: (robot) => robot.ui?.setHandAnimation?.("none"),
  });
};
