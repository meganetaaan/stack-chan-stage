export const createStageMotion = (delay) => {
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
      case "bow":
        await setPose(robot, 0, 0.3, 0, 450);
        await delay(350);
        await setPose(robot, 0, 0, 0, 450);
        return;
      case "look-left":
        await setPose(robot, -0.28, 0, 0, 350);
        return;
      case "look-right":
        await setPose(robot, 0.28, 0, 0, 350);
        return;
      default:
        throw Object.assign(new Error(`Unsupported motion preset: ${name}`), {
          code: "unsupported_motion",
          retryable: false,
        });
    }
  };

  return Object.freeze({ setPose, playPreset });
};
