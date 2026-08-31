const DEFAULT_LEVELS = Object.freeze([0.25, 0.8, 0.4, 1, 0.55, 0.7]);

export const createStageLipSync = (
  delay,
  { intervalMs = 90, levels = DEFAULT_LEVELS } = {},
) => {
  const start = (face) => {
    let stopped = false;
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      face.setMouthOpen(0);
    };

    const animation = (async () => {
      let index = 0;
      try {
        while (!stopped) {
          face.setMouthOpen(levels[index]);
          index = (index + 1) % levels.length;
          await delay(intervalMs);
        }
      } finally {
        close();
      }
    })();

    return Object.freeze({
      async stop() {
        stopped = true;
        close();
        await animation;
      },
    });
  };

  const play = async (face, playback, markStarted) => {
    let animation;
    try {
      await playback(() => {
        if (animation) return;
        markStarted();
        animation = start(face);
      });
    } finally {
      if (animation) await animation.stop();
      else face.setMouthOpen(0);
    }
  };

  return Object.freeze({ play });
};
