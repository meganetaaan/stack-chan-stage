import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.STAGE_PUBLIC_BASE ?? "/",
  plugins: [react()],
  define: {
    "import.meta.env.VITE_WASM_BUILD_ID": JSON.stringify(
      "c6171cff-stage-native-v1",
    ),
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: "es2023",
  },
});
