import WebSocket from "WebSocket";

const withQuery = (url, values) => {
  const separator = url.includes("?") ? "&" : "?";
  const query = Object.keys(values)
    .map(
      (key) => `${encodeURIComponent(key)}=${encodeURIComponent(values[key])}`,
    )
    .join("&");
  return `${url}${separator}${query}`;
};

export function createStageWebSocketTransport(options) {
  const {
    url,
    token,
    sessionId,
    channel,
    hello,
    onJson,
    onBinary,
    onClose = () => {},
    WebSocketConstructor = WebSocket,
  } = options;
  let socket;

  const sendJson = (message) => {
    if (!socket) throw new Error(`${channel} WebSocket is not connected`);
    socket.send(JSON.stringify(message));
  };

  const sendBinary = (packet) => {
    if (!socket) throw new Error(`${channel} WebSocket is not connected`);
    socket.send(packet);
  };

  const start = () => {
    if (socket) return;
    socket = new WebSocketConstructor(withQuery(url, { token, sessionId }));
    socket.addEventListener("open", () => sendJson(hello));
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        try {
          Promise.resolve(onJson(JSON.parse(event.data))).catch((error) => {
            trace(`[stage:${channel}] message failed: ${error}\n`);
            socket?.close();
          });
        } catch (error) {
          trace(`[stage:${channel}] invalid JSON: ${error}\n`);
          socket.close();
        }
        return;
      }
      if (onBinary) {
        Promise.resolve(onBinary(event.data)).catch((error) => {
          trace(`[stage:${channel}] binary message failed: ${error}\n`);
          socket?.close();
        });
      }
    });
    socket.addEventListener("close", (event) => {
      socket = undefined;
      onClose(event);
    });
  };

  const stop = () => {
    const current = socket;
    socket = undefined;
    current?.close();
  };

  return Object.freeze({ start, stop, sendJson, sendBinary });
}
