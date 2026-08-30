import { createStageMediaReceiver } from "stage-media-receiver";
import { createStageOpusPlayer } from "stage-opus-player";
import { createStageWebSocketTransport } from "stage-control-transport";

const trimSlash = (value) => value.replace(/\/$/, "");

export function createStageRuntimeEnvironment(config) {
  const required = ["gatewayUrl", "token", "sessionId", "actorId"];
  const missing = required.filter(
    (key) => typeof config[key] !== "string" || config[key].length === 0,
  );
  if (missing.length > 0)
    throw new Error(
      `Missing Stack-chan Stage configuration: ${missing.join(", ")}`,
    );

  const baseUrl = trimSlash(config.gatewayUrl);
  const actor = {
    id: config.actorId,
    name: config.actorName ?? "Stack-chan",
    capabilities: config.capabilities,
  };
  let commandHandler = () => {};
  let control;
  const mediaReceiver = createStageMediaReceiver({
    actorId: actor.id,
    sessionId: config.sessionId,
    player: createStageOpusPlayer({ volume: config.volume ?? 0.8 }),
    send: (message) => media.sendJson(message),
    initialPacketCredit: config.initialPacketCredit ?? 3,
  });
  const media = createStageWebSocketTransport({
    url: `${baseUrl}/device/media`,
    token: config.token,
    sessionId: config.sessionId,
    channel: "media",
    hello: {
      type: "media.hello",
      protocolVersion: 1,
      sessionId: config.sessionId,
      actorId: actor.id,
    },
    onJson: mediaReceiver.handleJson,
    onBinary: mediaReceiver.receivePacket,
    onClose: () => mediaReceiver.abortActive("Media connection closed"),
  });
  control = createStageWebSocketTransport({
    url: `${baseUrl}/device/control`,
    token: config.token,
    sessionId: config.sessionId,
    channel: "control",
    hello: {
      type: "actor.hello",
      protocolVersion: 1,
      sessionId: config.sessionId,
      actor,
    },
    onJson: (message) => commandHandler(message),
  });

  return Object.freeze({
    send: control.sendJson,
    media: mediaReceiver,
    start: (handler) => {
      commandHandler = handler;
      control.start();
      media.start();
    },
    stop: () => {
      control.stop();
      media.stop();
    },
  });
}
