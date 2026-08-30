import { expect, test, type Page } from "@playwright/test";

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

test("キューを検証して編集し、WASM Actorで上演できる", async ({ page }) => {
  await page.addInitScript(() => {
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
        getVoices: () => [],
        speak(utterance: FakeSpeechSynthesisUtterance) {
          window.setTimeout(() => {
            utterance.onstart?.();
            window.setTimeout(() => utterance.onend?.(), 25);
          }, 0);
        },
      },
    });
  });
  const browserErrors = captureBrowserErrors(page);
  await page.goto("/");
  await waitForSimulator(page);

  const screenPixels = await page
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
  expect(screenPixels.opaque).toBeGreaterThan(70_000);
  expect(screenPixels.colored).toBeGreaterThan(1_000);

  await page.getByRole("button", { name: "キューを追加" }).click();
  const dialog = page.getByRole("dialog", { name: "キューを追加" });
  const speechField = dialog.getByRole("textbox", {
    name: "セリフ",
    exact: true,
  });
  await speechField.fill("   ");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await speechField.fill("境界で検証したセリフです。");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).not.toBeAttached();
  await expect(page.locator(".cue-track")).toHaveCount(4);

  await page
    .locator(".cue-track")
    .nth(3)
    .getByRole("button", { name: "削除" })
    .click();
  await expect(page.locator(".cue-track")).toHaveCount(3);

  await page.getByRole("button", { name: "上演を開始" }).click();
  await expect(page.locator(".status-chip.runtime")).toContainText("終演", {
    timeout: 20_000,
  });
  expect(browserErrors).toEqual([]);
});

test("モバイル表示で各ワークスペースと舞台を切り替えられる", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const browserErrors = captureBrowserErrors(page);
  await page.goto("/");
  await waitForSimulator(page);

  const mobileNavigation = page.getByRole("navigation", {
    name: "モバイルナビゲーション",
  });
  await expect(mobileNavigation).toBeVisible();
  await mobileNavigation.getByRole("button", { name: "配役" }).click();
  await expect(page.getByRole("heading", { name: "配役" })).toBeVisible();
  await mobileNavigation.getByRole("button", { name: "上演" }).click();
  await expect(page.locator(".performance-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "上演を開始" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  expect(browserErrors).toEqual([]);
});
