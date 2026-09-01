import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { chromium } from "@playwright/test";

const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUTPUT_PATH = resolve(process.argv[2] ?? "docs/media/hero-flow.gif");

const waitForServer = async (server) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`Preview server exited with ${server.exitCode}`);
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Preview server did not become ready within 30 seconds");
};

const run = (command, args) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else
        rejectRun(
          new Error(
            `${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}`,
          ),
        );
    });
  });

const callTool = (page, name, input) =>
  page.evaluate(
    async ({ name: toolName, input: toolInput }) => {
      const tool = window.__stageWebMcpTools?.get(toolName);
      if (!tool) throw new Error(`${toolName} is not registered`);
      return tool.execute(toolInput, {
        signal: new AbortController().signal,
      });
    },
    { name, input },
  );

const installHarnesses = async (page) => {
  await page.addInitScript(() => {
    const tools = new Map();
    Object.defineProperty(window, "__stageWebMcpTools", { value: tools });
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool(tool) {
          tools.set(tool.name, tool);
        },
      },
    });

    class FakeSpeechSynthesisUtterance {
      constructor(text) {
        this.text = text;
        this.voice = null;
        this.lang = "";
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: FakeSpeechSynthesisUtterance,
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel() {},
        getVoices: () => [
          {
            default: true,
            lang: "ja-JP",
            localService: true,
            name: "Hero Capture Voice",
            voiceURI: "hero-ja-JP",
          },
        ],
        speak(utterance) {
          setTimeout(() => {
            utterance.onstart?.();
            setTimeout(() => utterance.onend?.(), 500);
          }, 0);
        },
      },
    });
  });
};

const updates = [
  {
    expectedRevision: 0,
    cueId: "cue-collaboration-backdrop",
    cue: {
      id: "cue-collaboration-backdrop",
      kind: "backdrop.set",
      assetId: "asset-098175752ee272ec0455bf6a",
      transition: { kind: "slide", direction: "left", durationMs: 650 },
    },
  },
  {
    expectedRevision: 1,
    cueId: "cue-collaboration-expression",
    cue: {
      id: "cue-collaboration-expression",
      kind: "expression",
      roleId: "narrator",
      expression: "HAPPY",
    },
  },
  {
    expectedRevision: 2,
    cueId: "cue-collaboration-line",
    cue: {
      id: "cue-collaboration-line",
      kind: "speech",
      roleId: "narrator",
      text: "WebMCPなら、AIがページの構造を読み、人と同じ舞台へ演出を書き戻せます。",
      direction: "発見を観客と分かち合うように",
    },
  },
  {
    expectedRevision: 3,
    cueId: "cue-collaboration-motion",
    cue: {
      id: "cue-collaboration-motion",
      kind: "motion",
      roleId: "narrator",
      motion: { kind: "preset", name: "clap" },
    },
  },
];

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "stackchan-stage-hero-"),
);
const previewServer = spawn(
  "npm",
  [
    "run",
    "preview",
    "--workspace=@stackchan-stage/web",
    "--",
    "--port",
    String(PORT),
  ],
  { stdio: "inherit" },
);

let browser;
try {
  await waitForServer(previewServer);
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: temporaryDirectory,
      size: { width: 1440, height: 900 },
    },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await installHarnesses(page);

  const recordingStartedAt = Date.now();
  await page.goto(BASE_URL);
  await page
    .locator("[data-simulator-phase='ready']")
    .waitFor({ state: "attached", timeout: 30_000 });
  await page.locator(".mcp-state.available").waitFor();
  await page.getByRole("button", { name: /共同演出/ }).click();
  await page
    .locator(".performance-panel")
    .click({ position: { x: 20, y: 200 } });
  await page.waitForTimeout(500);
  const heroStartedAt = Date.now();

  for (const update of updates) {
    const result = await callTool(page, "stage.cue.update", {
      expectedRevision: update.expectedRevision,
      sceneId: "scene-collaboration",
      laneId: "lane-collaboration",
      cueId: update.cueId,
      cue: update.cue,
    });
    if (!result?.ok)
      throw new Error(`Cue update failed: ${JSON.stringify(result)}`);
    await page.waitForTimeout(350);
  }

  const validation = await callTool(page, "stage.scenario.validate", {});
  if (!validation?.ok)
    throw new Error(`Validation failed: ${JSON.stringify(validation)}`);
  await page.waitForTimeout(350);

  const preview = await callTool(page, "stage.performance.preview", {
    sceneIds: ["scene-collaboration"],
    fromCueId: "cue-collaboration-backdrop",
    toCueId: "cue-collaboration-motion",
  });
  if (!preview?.ok)
    throw new Error(`Preview failed: ${JSON.stringify(preview)}`);
  await page.waitForTimeout(500);

  await page
    .locator(".performance-panel")
    .click({ position: { x: 20, y: 200 } });
  const playPromise = callTool(page, "stage.performance.play", {});
  await page
    .locator("[data-stage-backdrop='asset-112ad9726dd07c40e653c0b3']")
    .waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(1_000);
  await callTool(page, "stage.performance.stop", {});
  const play = await playPromise;
  if (!play?.ok) throw new Error(`Play failed: ${JSON.stringify(play)}`);
  const heroEndedAt = Date.now();

  if (errors.length > 0)
    throw new Error(`Browser errors during capture:\n${errors.join("\n")}`);

  const video = page.video();
  await page.close();
  await context.close();
  const videoPath = await video.path();
  const startSeconds = Math.max(
    0,
    (heroStartedAt - recordingStartedAt) / 1000 - 0.25,
  );
  const durationSeconds = (heroEndedAt - heroStartedAt) / 1000 + 0.5;

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-ss",
    startSeconds.toFixed(3),
    "-t",
    durationSeconds.toFixed(3),
    "-filter_complex",
    "[0:v]fps=8,scale=960:600:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    "-loop",
    "0",
    OUTPUT_PATH,
  ]);
  process.stdout.write(
    `Captured ${OUTPUT_PATH} (${durationSeconds.toFixed(1)} seconds)\n`,
  );
} finally {
  await browser?.close();
  previewServer.kill("SIGTERM");
  await rm(temporaryDirectory, { recursive: true, force: true });
}
