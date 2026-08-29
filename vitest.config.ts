import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@stackchan-stage/domain": `${root}packages/domain/src/index.ts`,
      "@stackchan-stage/application": `${root}packages/application/src/index.ts`,
      "@stackchan-stage/protocol": `${root}packages/protocol/src/index.ts`,
      "@stackchan-stage/actor-wasm": `${root}packages/adapters/actor-wasm/src/index.ts`,
      "@stackchan-stage/actor-device": `${root}packages/adapters/actor-device/src/index.ts`,
      "@stackchan-stage/stage-browser": `${root}packages/adapters/stage-browser/src/index.ts`,
      "@stackchan-stage/tts": `${root}packages/adapters/tts/src/index.ts`,
      "@stackchan-stage/persistence-browser": `${root}packages/adapters/persistence-browser/src/index.ts`,
      "@stackchan-stage/webmcp": `${root}packages/adapters/webmcp/src/index.ts`,
    },
  },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", "dist", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/*/src/**/*.ts", "packages/adapters/*/src/**/*.ts"],
    },
  },
});
