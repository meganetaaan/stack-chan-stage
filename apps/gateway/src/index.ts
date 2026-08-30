import { pathToFileURL } from "node:url";

import { createGatewayServer } from "./server";

export { createGatewayServer } from "./server";

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const server = createGatewayServer({
    ...(process.env.STAGE_GATEWAY_HOST === undefined
      ? {}
      : { host: process.env.STAGE_GATEWAY_HOST }),
    ...(process.env.STAGE_GATEWAY_PORT === undefined
      ? {}
      : { port: Number(process.env.STAGE_GATEWAY_PORT) }),
    ...(process.env.STAGE_GATEWAY_TOKEN === undefined
      ? {}
      : { token: process.env.STAGE_GATEWAY_TOKEN }),
  });
  const address = await server.listen();
  console.info(`[gateway] pairing token: ${server.token}`);
  console.info(
    `[gateway] browser endpoint: ws://localhost:${address.port}/browser/control?sessionId=stage&token=<token>`,
  );

  const shutdown = async () => {
    await server.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
