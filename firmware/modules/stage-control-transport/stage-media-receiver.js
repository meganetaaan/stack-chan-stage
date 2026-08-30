const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const protocolError = (code, message) =>
  Object.assign(new Error(message), { code });

/**
 * Credit-based, one-stream media receiver. A credit is returned only after the
 * playback sink has consumed a packet, keeping the device-side queue bounded.
 */
export function createStageMediaReceiver(options) {
  const {
    actorId,
    sessionId,
    player,
    send,
    initialPacketCredit = 3,
    maximumPacketBytes = 4096,
  } = options;
  let stream;
  const waiters = new Map();

  const emitCredit = (active, packets) =>
    send({
      type: "audio.credit",
      protocolVersion: 1,
      sessionId,
      actorId,
      streamId: active.streamId,
      packets,
    });

  const notifyStarted = (active) => {
    if (active.started) return;
    active.started = true;
    for (const waiter of active.waiters) waiter.onStarted?.();
  };

  const bindWaiter = (active, waiter) => {
    active.waiters.add(waiter);
    if (active.started) waiter.onStarted?.();
    active.completion.promise.then(waiter.resolve, waiter.reject);
  };

  const open = async (message) => {
    if (stream)
      throw protocolError(
        "stream_busy",
        `Stream ${stream.streamId} is still active`,
      );
    const completion = deferred();
    completion.promise.catch(() => {});
    const active = {
      streamId: message.streamId,
      cueExecutionId: message.cueExecutionId,
      expectedPackets: message.packetCount,
      receivedPackets: 0,
      availableCredit: initialPacketCredit,
      started: false,
      ended: false,
      writes: new Set(),
      waiters: new Set(),
      completion,
    };
    stream = active;
    const pending = waiters.get(message.streamId);
    if (pending) {
      waiters.delete(message.streamId);
      for (const waiter of pending) bindWaiter(active, waiter);
    }
    try {
      await player.open(message.format);
      emitCredit(active, initialPacketCredit);
    } catch (error) {
      stream = undefined;
      completion.reject(error);
      throw error;
    }
  };

  const receivePacket = (input) => {
    const packet = input instanceof Uint8Array ? input : new Uint8Array(input);
    const active = stream;
    if (!active)
      throw protocolError(
        "stream_not_open",
        "Binary audio arrived without audio.open",
      );
    if (active.ended)
      throw protocolError(
        "stream_ended",
        "Binary audio arrived after audio.end",
      );
    if (packet.byteLength === 0 || packet.byteLength > maximumPacketBytes) {
      throw protocolError(
        "invalid_packet",
        `Opus packet must be 1..${maximumPacketBytes} bytes`,
      );
    }
    if (active.availableCredit <= 0)
      throw protocolError("credit_exceeded", "Audio packet credit exceeded");
    if (active.receivedPackets >= active.expectedPackets) {
      throw protocolError(
        "packet_count_exceeded",
        "More Opus packets than declared were received",
      );
    }

    active.availableCredit -= 1;
    active.receivedPackets += 1;
    notifyStarted(active);
    const write = Promise.resolve(player.writePacket(packet)).then(
      () => {
        if (stream === active && !active.ended) {
          active.availableCredit += 1;
          emitCredit(active, 1);
        }
      },
      (error) => {
        active.completion.reject(error);
        throw error;
      },
    );
    active.writes.add(write);
    write.then(
      () => active.writes.delete(write),
      () => active.writes.delete(write),
    );
    return write;
  };

  const end = async (message) => {
    const active = stream;
    if (!active || active.streamId !== message.streamId) {
      throw protocolError(
        "stream_mismatch",
        `Cannot end inactive stream ${message.streamId}`,
      );
    }
    if (active.receivedPackets !== active.expectedPackets) {
      throw protocolError(
        "packet_count_mismatch",
        `Expected ${active.expectedPackets} Opus packets, received ${active.receivedPackets}`,
      );
    }
    active.ended = true;
    try {
      await Promise.all([...active.writes]);
      await player.finishPlayback();
      active.completion.resolve();
    } catch (error) {
      active.completion.reject(error);
      throw error;
    } finally {
      if (stream === active) stream = undefined;
    }
  };

  const abort = async (message) => {
    const active = stream;
    if (!active || active.streamId !== message.streamId) return;
    active.ended = true;
    const error = protocolError("audio_aborted", message.reason);
    try {
      await player.abort();
    } finally {
      active.completion.reject(error);
      if (stream === active) stream = undefined;
    }
  };

  const handleJson = (message) => {
    if (message.sessionId !== sessionId || message.actorId !== actorId)
      return Promise.resolve();
    switch (message.type) {
      case "audio.open":
        return open(message);
      case "audio.end":
        return end(message);
      case "audio.abort":
        return abort(message);
      default:
        return Promise.resolve();
    }
  };

  const awaitPlayback = (streamId, onStarted) => {
    const waiter = { ...deferred(), onStarted };
    if (stream?.streamId === streamId) bindWaiter(stream, waiter);
    else {
      const pending = waiters.get(streamId) ?? [];
      pending.push(waiter);
      waiters.set(streamId, pending);
    }
    return waiter.promise;
  };

  const abortActive = async (reason = "Cue cancelled") => {
    if (!stream) {
      const error = protocolError("audio_aborted", reason);
      for (const pending of waiters.values()) {
        for (const waiter of pending) waiter.reject(error);
      }
      waiters.clear();
      return;
    }
    await abort({ streamId: stream.streamId, reason });
  };

  return Object.freeze({
    handleJson,
    receivePacket,
    awaitPlayback,
    abortActive,
  });
}
