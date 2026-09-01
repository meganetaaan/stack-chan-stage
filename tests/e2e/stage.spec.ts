import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

type BrowserWebMcpTool = Readonly<{
  name: string;
  execute: (
    input: Record<string, unknown>,
    options: Readonly<{ signal: AbortSignal }>,
  ) => Promise<unknown>;
}>;

declare global {
  interface Window {
    readonly __stageWebMcpTools?: Map<string, BrowserWebMcpTool>;
  }
}

const captureBrowserErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
};

const waitForSimulator = async (page: Page) => {
  await expect(page.locator("[data-simulator-phase='ready']")).toBeAttached({
    timeout: 30_000,
  });
};

const installWebMcpHarness = (page: Page) =>
  page.addInitScript(() => {
    const tools = new Map<string, BrowserWebMcpTool>();
    Object.defineProperty(window, "__stageWebMcpTools", { value: tools });
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool(tool: BrowserWebMcpTool) {
          tools.set(tool.name, tool);
        },
      },
    });
  });

const installSpeechSynthesisHarness = (page: Page) =>
  page.addInitScript(() => {
    class FakeSpeechSynthesisUtterance {
      readonly text: string;
      voice = null;
      lang = "";
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(text: string) {
        this.text = text;
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
            name: "E2E Japanese Voice",
            voiceURI: "e2e-ja-JP",
          },
        ],
        speak(utterance: FakeSpeechSynthesisUtterance) {
          window.setTimeout(() => {
            utterance.onstart?.();
            window.setTimeout(() => utterance.onend?.(), 1_200);
          }, 0);
        },
      },
    });
  });

const callWebMcp = (page: Page, name: string, input: Record<string, unknown>) =>
  page.evaluate(
    async ({ toolName, toolInput }) => {
      const tool = window.__stageWebMcpTools?.get(toolName);
      if (!tool) throw new Error(`${toolName} is not registered`);
      return tool.execute(toolInput, {
        signal: new AbortController().signal,
      });
    },
    { toolName: name, toolInput: input },
  );

const successfulRunResultSchema = z
  .object({
    ok: z.literal(true),
    runId: z.string().min(1),
    state: z.object({ status: z.literal("completed") }).loose(),
  })
  .loose();

const inspectSimulatorPixels = (page: Page) =>
  page
    .locator(".simulator-screen-source")
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d");
      if (!context) return { opaque: 0, colored: 0 };
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let opaque = 0;
      let colored = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if ((pixels[index + 3] ?? 0) > 0) opaque += 1;
        if (
          (pixels[index] ?? 0) +
            (pixels[index + 1] ?? 0) +
            (pixels[index + 2] ?? 0) >
          24
        )
          colored += 1;
      }
      return { opaque, colored };
    });

const countBrightMouthPixels = (page: Page) =>
  page
    .locator(".simulator-screen-source")
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Simulator screen has no 2D context");
      const pixels = context.getImageData(115, 119, 90, 58).data;
      let bright = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          (pixels[index] ?? 0) +
            (pixels[index + 1] ?? 0) +
            (pixels[index + 2] ?? 0) >
          24
        )
          bright += 1;
      }
      return bright;
    });

test("キューを検証して編集し、WASM Actorで上演できる", async ({ page }) => {
  await installSpeechSynthesisHarness(page);
  const browserErrors = captureBrowserErrors(page);
  await page.goto("/");
  await waitForSimulator(page);
  await expect(page.getByRole("button", { name: "台本に追加" })).toHaveCount(0);

  const screenPixels = await inspectSimulatorPixels(page);
  expect(screenPixels.opaque).toBeGreaterThan(70_000);
  expect(screenPixels.colored).toBeGreaterThan(1_000);

  const speechTrack = page.locator("[data-cue-id='cue-greeting']");
  await expect(speechTrack.locator(".cue-script-text")).toContainText(
    "語り手「ようこそ、スタックチャン・ステージへ。」",
  );
  await expect(speechTrack.locator(".cue-main")).toHaveAccessibleName(
    /セリフ: 語り手「ようこそ、スタックチャン・ステージへ。」.*を編集/,
  );
  await speechTrack.locator(".cue-main").click();
  const editForm = page.getByRole("article", { name: "台本を編集" });
  await expect(editForm).toBeVisible();
  await expect(speechTrack.locator(".cue-inline-editor")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await editForm.getByRole("button", { name: "キャンセル" }).click();

  const secondLineSlot = page.locator("[data-insert-index='1']");
  await secondLineSlot.hover();
  await secondLineSlot
    .getByRole("button", { name: "2行目にコマンドを挿入" })
    .click();
  const editor = page.getByRole("article", { name: "台本に行を追加" });
  const speechField = editor.getByRole("textbox", {
    name: "セリフ",
    exact: true,
  });
  await speechField.fill("   ");
  await editor.getByRole("button", { name: "保存" }).click();
  await expect(editor.getByRole("alert")).toHaveText(
    "セリフを入力してください",
  );
  await speechField.fill("途中に挿入したセリフです。");
  await editor.getByRole("button", { name: "保存" }).click();
  await expect(editor).not.toBeAttached();
  await expect(page.locator(".cue-track")).toHaveCount(4);
  await expect(page.locator(".cue-script-text").nth(1)).toContainText(
    "途中に挿入したセリフです。",
  );

  const insertedTrack = page
    .locator(".cue-track")
    .filter({ hasText: "途中に挿入したセリフです。" });
  await insertedTrack
    .locator(".cue-drag-handle")
    .dragTo(page.locator("[data-insert-index='4']"));
  await expect(page.locator(".cue-script-text").nth(3)).toContainText(
    "途中に挿入したセリフです。",
  );

  const firstCue = page.locator("[data-cue-id='cue-greeting']");
  await insertedTrack.locator(".cue-drag-handle").dragTo(firstCue, {
    targetPosition: { x: 120, y: 8 },
  });
  await expect(page.locator(".cue-script-text").nth(1)).toContainText(
    "途中に挿入したセリフです。",
  );

  await insertedTrack.getByRole("button", { name: "削除" }).click();
  await expect(page.locator(".cue-track")).toHaveCount(3);

  const terminalSlot = page.locator("[data-insert-index='3']");
  await terminalSlot.hover();
  await terminalSlot
    .getByRole("button", { name: "末尾にコマンドを追加" })
    .click();
  await editor
    .getByRole("textbox", { name: "セリフ", exact: true })
    .fill("末尾に追加したセリフです。");
  await editor.getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".cue-script-text").nth(3)).toContainText(
    "末尾に追加したセリフです。",
  );
  await page
    .locator(".cue-track")
    .nth(3)
    .getByRole("button", { name: "削除" })
    .click();
  await expect(page.locator(".cue-track")).toHaveCount(3);

  await page.getByRole("button", { name: "上演を開始" }).click();
  await expect(page.locator(".now-playing")).toContainText("セリフ");
  await expect.poll(() => countBrightMouthPixels(page)).toBeGreaterThan(900);
  const mouthPixelSamples: number[] = [];
  await expect
    .poll(
      async () => {
        mouthPixelSamples.push(await countBrightMouthPixels(page));
        return Math.max(...mouthPixelSamples) - Math.min(...mouthPixelSamples);
      },
      { timeout: 1_000, intervals: [50, 70, 90, 110, 130] },
    )
    .toBeGreaterThan(300);
  await expect(page.locator(".status-chip.runtime")).toContainText("終演", {
    timeout: 20_000,
  });
  expect(await countBrightMouthPixels(page)).toBeLessThan(900);
  expect(browserErrors).toEqual([]);
});

test.describe("タッチ操作", () => {
  test.use({ hasTouch: true });

  test("モバイル表示で各ワークスペースと舞台を切り替えられる", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const browserErrors = captureBrowserErrors(page);
    await page.goto("/");
    await waitForSimulator(page);

    await expect(page.locator(".cue-script-text").nth(1)).toContainText(
      "語り手「ようこそ、スタックチャン・ステージへ。」",
    );
    await expect(page.getByRole("button", { name: "台本に追加" })).toHaveCount(
      0,
    );
    const touchInsert = page.getByRole("button", {
      name: "2行目にコマンドを挿入",
    });
    await expect(touchInsert).toHaveCSS("opacity", "1");
    await expect(touchInsert).toHaveCSS("pointer-events", "auto");
    await touchInsert.click();
    const insertEditor = page.getByRole("article", { name: "台本に行を追加" });
    await expect(insertEditor).toBeVisible();
    await insertEditor.getByRole("button", { name: "キャンセル" }).click();

    await expect(
      page.getByRole("button", { name: "開演を削除" }),
    ).toBeVisible();
    const firstCue = page.locator(".cue-track").first();
    await expect(firstCue.locator(".cue-drag-handle")).toBeHidden();
    await firstCue.locator(".cue-menu-trigger").click();
    await expect(
      firstCue.getByRole("button", { name: "下へ移動" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    const mobileNavigation = page.getByRole("navigation", {
      name: "モバイルナビゲーション",
    });
    await expect(mobileNavigation).toBeVisible();
    await mobileNavigation.getByRole("button", { name: "配役" }).click();
    await expect(page.getByRole("heading", { name: "配役" })).toBeVisible();
    await mobileNavigation.getByRole("button", { name: "上演" }).click();
    await expect(page.locator(".performance-panel")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "上演を開始" }),
    ).toBeVisible();
    const mobileScreenPixels = await inspectSimulatorPixels(page);
    expect(mobileScreenPixels.opaque).toBeGreaterThan(70_000);
    expect(mobileScreenPixels.colored).toBeGreaterThan(1_000);

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    expect(browserErrors).toEqual([]);
  });
});

test("「間を置く」は指定時間後に終了する", async ({ page }) => {
  await installWebMcpHarness(page);
  const browserErrors = captureBrowserErrors(page);
  await page.goto("/");
  await waitForSimulator(page);

  await expect(
    callWebMcp(page, "stage.cue.create", {
      expectedRevision: 0,
      sceneId: "scene-opening",
      laneId: "lane-opening",
      cue: {
        id: "cue-e2e-pause",
        kind: "pause",
        durationMs: 300,
      },
      index: 0,
    }),
  ).resolves.toMatchObject({ ok: true, newRevision: 1 });

  const startedAt = Date.now();
  const result = successfulRunResultSchema.parse(
    await callWebMcp(page, "stage.performance.preview", {
      sceneIds: ["scene-opening"],
      fromCueId: "cue-e2e-pause",
      toCueId: "cue-e2e-pause",
    }),
  );

  expect(result.state.status).toBe("completed");
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
  expect(browserErrors).toEqual([]);
});

test("WebMCPで台本を取得・追記・推敲すると同じ画面へ反映される", async ({
  page,
}) => {
  await installWebMcpHarness(page);
  await installSpeechSynthesisHarness(page);
  const browserErrors = captureBrowserErrors(page);
  const motionEvents: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[WasmDriver] applyRotation")) motionEvents.push(text);
  });
  await page.goto("/");
  await waitForSimulator(page);

  const webMcpState = page.locator(".mcp-state");
  await expect(webMcpState).toHaveClass(/available/);
  await expect(webMcpState).toHaveAttribute("title", "15 tools");

  await expect(
    callWebMcp(page, "stage.workspace.get", {}),
  ).resolves.toMatchObject({
    ok: true,
    workspace: {
      revision: 0,
      scenario: { id: "scenario-first-stage" },
    },
  });

  const firstDraft = {
    id: "cue-webmcp-draft",
    kind: "speech",
    roleId: "narrator",
    text: "WebMCPから台本に一行を追加します。",
    direction: "語りかけるように",
  };
  await expect(
    callWebMcp(page, "stage.cue.create", {
      expectedRevision: 0,
      sceneId: "scene-opening",
      laneId: "lane-opening",
      cue: firstDraft,
    }),
  ).resolves.toMatchObject({ ok: true, newRevision: 1 });
  await expect(page.locator("[data-cue-id='cue-webmcp-draft']")).toContainText(
    "語り手「WebMCPから台本に一行を追加します。」",
  );

  const revisedDraft = {
    ...firstDraft,
    text: "WebMCPと一緒に、この台本を推敲していきましょう。",
    direction: "観客へ自然に呼びかける",
  };
  await expect(
    callWebMcp(page, "stage.cue.update", {
      expectedRevision: 1,
      sceneId: "scene-opening",
      laneId: "lane-opening",
      cueId: firstDraft.id,
      cue: revisedDraft,
    }),
  ).resolves.toMatchObject({ ok: true, newRevision: 2 });
  const revisedLine = page.locator("[data-cue-id='cue-webmcp-draft']");
  await expect(revisedLine).toContainText(
    "語り手「WebMCPと一緒に、この台本を推敲していきましょう。」",
  );
  await expect(revisedLine).toContainText("観客へ自然に呼びかける");

  await expect(
    callWebMcp(page, "stage.cue.move", {
      expectedRevision: 1,
      sceneId: "scene-opening",
      laneId: "lane-opening",
      cueId: firstDraft.id,
      toIndex: 0,
    }),
  ).resolves.toMatchObject({
    ok: false,
    code: "revision_conflict",
    currentRevision: 2,
  });
  await expect(
    callWebMcp(page, "stage.scenario.validate", {}),
  ).resolves.toMatchObject({ ok: true, cueCount: 6 });

  const previewInput = {
    sceneIds: ["scene-opening"],
    fromCueId: "cue-nod",
    toCueId: "cue-nod",
  };
  const firstPreview = successfulRunResultSchema.parse(
    await callWebMcp(page, "stage.performance.preview", previewInput),
  );
  const secondPreview = successfulRunResultSchema.parse(
    await callWebMcp(page, "stage.performance.preview", previewInput),
  );

  expect(firstPreview.runId).not.toBe(secondPreview.runId);
  expect(motionEvents).toEqual([
    expect.stringContaining("p=0.18 r=0 time=0.22"),
    expect.stringContaining("p=-0.12 r=0 time=0.22"),
    expect.stringContaining("p=0 r=0 time=0.22"),
    expect.stringContaining("p=0.18 r=0 time=0.22"),
    expect.stringContaining("p=-0.12 r=0 time=0.22"),
    expect.stringContaining("p=0 r=0 time=0.22"),
  ]);
  expect(browserErrors).toEqual([]);
});
