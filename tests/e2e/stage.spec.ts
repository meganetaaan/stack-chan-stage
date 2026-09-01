import { readFile } from "node:fs/promises";

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

const installSpeechSynthesisHarness = (
  page: Page,
  utteranceDurationMs = 1_200,
) =>
  page.addInitScript(
    ({ utteranceDurationMs }) => {
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
              window.setTimeout(() => utterance.onend?.(), utteranceDurationMs);
            }, 0);
          },
        },
      });
    },
    { utteranceDurationMs },
  );

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
  test.setTimeout(90_000);
  await installSpeechSynthesisHarness(page, 2_400);
  const browserErrors = captureBrowserErrors(page);
  await page.goto("/");
  await waitForSimulator(page);
  await expect(page.getByRole("button", { name: "台本に追加" })).toHaveCount(0);

  const screenPixels = await inspectSimulatorPixels(page);
  expect(screenPixels.opaque).toBeGreaterThan(70_000);
  expect(screenPixels.colored).toBeGreaterThan(1_000);

  const speechTrack = page.locator("[data-cue-id='cue-greeting']");
  await expect(speechTrack.locator(".cue-script-text")).toContainText(
    "語り手「ようこそ。人とAIが一緒につくる、Stack-chan Stageです。」",
  );
  await expect(speechTrack.locator(".cue-main")).toHaveAccessibleName(
    /セリフ: 語り手「ようこそ。人とAIが一緒につくる、Stack-chan Stageです。」.*を編集/,
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
  await expect(page.locator(".cue-track")).toHaveCount(6);
  await expect(page.locator(".cue-script-text").nth(1)).toContainText(
    "途中に挿入したセリフです。",
  );

  const insertedTrack = page
    .locator(".cue-track")
    .filter({ hasText: "途中に挿入したセリフです。" });
  await insertedTrack
    .locator(".cue-drag-handle")
    .dragTo(page.locator("[data-insert-index='6']"));
  await expect(page.locator(".cue-script-text").nth(5)).toContainText(
    "途中に挿入したセリフです。",
  );

  await insertedTrack
    .locator(".cue-drag-handle")
    .dragTo(page.locator(".timeline-header"));
  await expect(page.locator(".cue-script-text").first()).toContainText(
    "途中に挿入したセリフです。",
  );

  const timelinePanel = page.locator(".timeline-panel");
  const timelineBounds = await timelinePanel.boundingBox();
  const cueListBounds = await page.locator(".cue-list").boundingBox();
  if (!timelineBounds || !cueListBounds)
    throw new Error("timeline bounds are unavailable");
  await insertedTrack.locator(".cue-drag-handle").dragTo(timelinePanel, {
    targetPosition: {
      x: 120,
      y: cueListBounds.y + cueListBounds.height - timelineBounds.y + 16,
    },
  });
  await expect(page.locator(".cue-script-text").nth(5)).toContainText(
    "途中に挿入したセリフです。",
  );

  const firstCue = page.locator("[data-cue-id='cue-greeting']");
  await insertedTrack.locator(".cue-drag-handle").dragTo(firstCue, {
    targetPosition: { x: 120, y: 8 },
  });
  await expect(page.locator(".cue-script-text").nth(3)).toContainText(
    "途中に挿入したセリフです。",
  );

  await insertedTrack.getByRole("button", { name: "削除" }).click();
  await expect(page.locator(".cue-track")).toHaveCount(5);

  const terminalSlot = page.locator("[data-insert-index='5']");
  await terminalSlot.hover();
  await terminalSlot
    .getByRole("button", { name: "末尾にコマンドを追加" })
    .click();
  await editor
    .getByRole("textbox", { name: "セリフ", exact: true })
    .fill("末尾に追加したセリフです。");
  await editor.getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".cue-script-text").nth(5)).toContainText(
    "末尾に追加したセリフです。",
  );
  await page
    .locator(".cue-track")
    .nth(5)
    .getByRole("button", { name: "削除" })
    .click();
  await expect(page.locator(".cue-track")).toHaveCount(5);

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

test("演出・配役・素材をプロジェクトZIPで書き出して読み戻せる", async ({
  page,
}) => {
  await installWebMcpHarness(page);
  const browserErrors = captureBrowserErrors(page);
  await page.goto("/");
  await waitForSimulator(page);

  const title = page.getByRole("textbox", { name: "演目名" });
  await title.fill("WebMCP プロジェクト");
  await title.press("Tab");

  await page.getByRole("button", { name: "素材" }).click();
  await page.locator(".asset-panel input[type='file']").setInputFiles({
    name: "archive-backdrop.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  const uploadedAsset = page
    .locator(".asset-card")
    .filter({ hasText: "archive-backdrop.png" });
  await expect(uploadedAsset).toHaveCount(1);

  await expect(
    callWebMcp(page, "stage.cast.set", {
      expectedRevision: 2,
      scope: "global",
      cast: {
        assignments: {
          narrator: "actor-away",
          guest: "wasm-actor",
        },
      },
    }),
  ).resolves.toMatchObject({ ok: true, newRevision: 3 });
  await expect(
    callWebMcp(page, "stage.cue.create", {
      expectedRevision: 3,
      sceneId: "scene-opening",
      laneId: "lane-opening",
      cue: {
        id: "cue-project-archive",
        kind: "speech",
        roleId: "narrator",
        text: "ファイルから復元されるセリフです。",
      },
    }),
  ).resolves.toMatchObject({ ok: true, newRevision: 4 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "プロジェクトを書き出す" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "WebMCP プロジェクト.stackchan-stage.zip",
  );
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("project download path is unavailable");
  const archive = await readFile(downloadPath);

  await title.fill("置換前の一時タイトル");
  await title.press("Tab");
  await expect(title).toHaveValue("置換前の一時タイトル");

  await page.locator(".project-file-actions input[type='file']").setInputFiles({
    name: "restored.stackchan-stage.zip",
    mimeType: "application/zip",
    buffer: archive,
  });
  const dialog = page.getByRole("dialog", { name: "プロジェクトを読み込む" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("WebMCP プロジェクト");
  await expect(dialog).toContainText("未接続のActorがあります");
  await expect(dialog).toContainText("actor-away");
  await dialog.getByRole("button", { name: "置き換えて開く" }).click();

  await expect(title).toHaveValue("WebMCP プロジェクト");
  await expect(
    page.locator("[data-cue-id='cue-project-archive']"),
  ).toContainText("ファイルから復元されるセリフです。");
  await page.getByRole("button", { name: "素材" }).click();
  await expect(uploadedAsset).toHaveCount(1);
  await page.getByRole("button", { name: "配役" }).click();
  await expect(
    page.getByRole("combobox", { name: "語り手のActor" }),
  ).toHaveValue("actor-away");
  await expect(
    page
      .getByRole("combobox", { name: "語り手のActor" })
      .getByRole("option", { name: "未接続: actor-away" }),
  ).toBeAttached();
  const projectInput = page.locator(".project-file-actions input[type='file']");
  const invalidProject = {
    name: "invalid.stackchan-stage.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("not a zip"),
  };
  await projectInput.setInputFiles(invalidProject);
  await expect(page.getByRole("alert")).toContainText(
    "プロジェクトファイルを展開できません",
  );
  await expect(title).toHaveValue("WebMCP プロジェクト");
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

    await expect(
      page.getByRole("button", { name: "プロジェクトを開く" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "プロジェクトを書き出す" }),
    ).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "プロジェクトを書き出す" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    if (!downloadPath)
      throw new Error("mobile project download path is unavailable");
    await page
      .locator(".project-file-actions input[type='file']")
      .setInputFiles({
        name: "mobile.stackchan-stage.zip",
        mimeType: "application/zip",
        buffer: await readFile(downloadPath),
      });
    const projectDialog = page.getByRole("dialog", {
      name: "プロジェクトを読み込む",
    });
    await expect(projectDialog).toBeVisible();
    const dialogBounds = await projectDialog.boundingBox();
    if (!dialogBounds) throw new Error("project dialog bounds are unavailable");
    expect(dialogBounds.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.y).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(390);
    expect(dialogBounds.y + dialogBounds.height).toBeLessThanOrEqual(844);
    await projectDialog.getByRole("button", { name: "キャンセル" }).click();

    await expect(page.locator("[data-cue-id='cue-greeting']")).toContainText(
      "語り手「ようこそ。人とAIが一緒につくる、Stack-chan Stageです。」",
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

test("WebMCPで共同演出を推敲し、確認後に全場面を上演できる", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installWebMcpHarness(page);
  await installSpeechSynthesisHarness(page);
  const browserErrors = captureBrowserErrors(page);
  const loadedDemoAssets = new Map<string, number>();
  page.on("response", (response) => {
    if (response.url().includes("/demo/"))
      loadedDemoAssets.set(response.url(), response.status());
  });
  await page.goto("/");
  await waitForSimulator(page);

  await test.step("15 toolsと初期workspaceを取得する", async () => {
    const webMcpState = page.locator(".mcp-state");
    await expect(webMcpState).toHaveClass(/available/);
    await expect(webMcpState).toHaveAttribute("title", "15 tools");
    await expect(
      callWebMcp(page, "stage.workspace.get", {}),
    ).resolves.toMatchObject({
      ok: true,
      workspace: {
        revision: 0,
        scenario: {
          id: "scenario-first-stage",
          title: "WebMCPとつくる舞台",
          scenes: [{}, { id: "scene-collaboration" }, {}],
          assets: [{}, {}, {}, {}],
        },
      },
    });

    await page.getByRole("button", { name: "素材" }).click();
    await expect(page.locator(".asset-card")).toHaveCount(4);
    await expect(page.locator(".asset-preview img")).toHaveCount(3);
    await expect(page.locator(".asset-card").first()).toContainText(
      "Apache-2.0",
    );
    await page.getByRole("button", { name: "演出", exact: true }).click();
  });

  await test.step("台詞・表情・動き・背景を同じrevision列で更新する", async () => {
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
    ] as const;
    for (const update of updates)
      await expect(
        callWebMcp(page, "stage.cue.update", {
          expectedRevision: update.expectedRevision,
          sceneId: "scene-collaboration",
          laneId: "lane-collaboration",
          cueId: update.cueId,
          cue: update.cue,
        }),
      ).resolves.toMatchObject({
        ok: true,
        newRevision: update.expectedRevision + 1,
      });

    await page.getByRole("button", { name: /共同演出/ }).click();
    await expect(
      page.locator("[data-cue-id='cue-collaboration-backdrop']"),
    ).toContainText("Human-Agent Revision Loop");
    await expect(
      page.locator("[data-cue-id='cue-collaboration-expression']"),
    ).toContainText("笑顔");
    const revisedLine = page.locator("[data-cue-id='cue-collaboration-line']");
    await expect(revisedLine).toContainText(
      "WebMCPなら、AIがページの構造を読み、人と同じ舞台へ演出を書き戻せます。",
    );
    await expect(revisedLine).toContainText("発見を観客と分かち合うように");
    await expect(
      page.locator("[data-cue-id='cue-collaboration-motion']"),
    ).toContainText("拍手する");
  });

  await test.step("古いrevisionを拒否して13 Cueを検証する", async () => {
    await expect(
      callWebMcp(page, "stage.cue.move", {
        expectedRevision: 3,
        sceneId: "scene-collaboration",
        laneId: "lane-collaboration",
        cueId: "cue-collaboration-motion",
        toIndex: 0,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "revision_conflict",
      currentRevision: 4,
    });
    await expect(
      callWebMcp(page, "stage.scenario.validate", {}),
    ).resolves.toMatchObject({ ok: true, cueCount: 13 });
  });

  await test.step("共同演出だけをpreviewして人間の確認で止める", async () => {
    const preview = callWebMcp(page, "stage.performance.preview", {
      sceneIds: ["scene-collaboration"],
      fromCueId: "cue-collaboration-backdrop",
      toCueId: "cue-collaboration-motion",
    });
    await expect(
      page.locator("[data-stage-backdrop='asset-098175752ee272ec0455bf6a']"),
    ).toBeAttached({ timeout: 15_000 });
    successfulRunResultSchema.parse(await preview);
    await expect(page.locator(".status-chip.runtime")).toContainText("終演");
    await expect(page.locator("[data-stage-backdrop]")).toHaveCount(0);
    await page
      .locator(".performance-panel")
      .click({ position: { x: 20, y: 200 } });
  });

  await test.step("承認後に全場面を背景とBGM付きで上演する", async () => {
    const play = callWebMcp(page, "stage.performance.play", {});
    await expect(
      page.locator("[data-stage-backdrop='asset-112ad9726dd07c40e653c0b3']"),
    ).toBeAttached({ timeout: 15_000 });
    await expect(
      page.locator("[data-stage-backdrop='asset-098175752ee272ec0455bf6a']"),
    ).toBeAttached({ timeout: 20_000 });
    await expect(
      page.locator("[data-stage-backdrop='asset-82e872b655d3c86f88bb07c2']"),
    ).toBeAttached({ timeout: 20_000 });
    successfulRunResultSchema.parse(await play);
    await expect(page.locator(".status-chip.runtime")).toContainText("終演");
    expect(
      [...loadedDemoAssets.entries()].filter(([url]) =>
        url.endsWith("webmcp-night-loop.wav"),
      ),
    ).toEqual([[expect.stringContaining("/demo/webmcp-night-loop.wav"), 200]]);
  });

  expect(browserErrors).toEqual([]);
});
