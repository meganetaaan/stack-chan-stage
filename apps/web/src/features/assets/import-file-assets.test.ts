import { describe, expect, it, vi } from "vitest";

import {
  asAssetId,
  type AssetKind,
  type AssetMetadata,
} from "@stackchan-stage/domain";

import { importFileAssets } from "./import-file-assets";

const assetFor = (file: File, kind: AssetKind): AssetMetadata => ({
  id: asAssetId(`asset-${file.name}`),
  kind,
  name: file.name,
  mimeType: file.type,
  byteSize: file.size,
  digest: `digest-${file.name}`,
});

describe("file asset batch import", () => {
  it("一部が失敗しても残りのファイルを順番に追加する", async () => {
    const files = [
      new File(["a"], "first.png", { type: "image/png" }),
      new File(["b"], "broken.png", { type: "image/png" }),
      new File(["c"], "rejected.png", { type: "image/png" }),
      new File(["d"], "existing.png", { type: "image/png" }),
    ];
    const processed: string[] = [];

    const result = await importFileAssets(files, "backdrop", {
      prepare: async (file, kind) => {
        processed.push(`prepare:${file.name}`);
        if (file.name === "broken.png") throw new Error("壊れています");
        return assetFor(file, kind);
      },
      add: async (asset) => {
        processed.push(`add:${asset.name}`);
        if (asset.name === "rejected.png")
          return { ok: false, message: "追加できません", issues: [] };
        return { ok: true, added: asset.name !== "existing.png" };
      },
    });

    expect(processed).toEqual([
      "prepare:first.png",
      "add:first.png",
      "prepare:broken.png",
      "prepare:rejected.png",
      "add:rejected.png",
      "prepare:existing.png",
      "add:existing.png",
    ]);
    expect(result.added.map((asset) => asset.name)).toEqual(["first.png"]);
    expect(result.skipped.map((asset) => asset.name)).toEqual(["existing.png"]);
    expect(result.failures).toMatchObject([
      { fileName: "broken.png", message: "壊れています" },
      { fileName: "rejected.png", message: "追加できません" },
    ]);
  });

  it("処理中のファイル番号と総数を通知する", async () => {
    const files = [
      new File(["a"], "one.png", { type: "image/png" }),
      new File(["b"], "two.png", { type: "image/png" }),
    ];
    const onProgress = vi.fn();

    await importFileAssets(files, "backdrop", {
      prepare: async (file, kind) => assetFor(file, kind),
      add: async () => ({ ok: true, added: true }),
      onProgress,
    });

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { current: 1, fileName: "one.png", total: 2 },
      { current: 2, fileName: "two.png", total: 2 },
    ]);
  });
});
