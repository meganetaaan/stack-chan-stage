import { describe, expect, it, vi } from "vitest";

import { asAssetId, type AssetMetadata } from "@stackchan-stage/domain";

import { loadSourceBackedAsset } from "./source-backed-assets";

const hexadecimal = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const fixture = async () => {
  const blob = new Blob(["source-backed-image"], { type: "image/webp" });
  const digest = hexadecimal(
    await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
  );
  const asset: AssetMetadata = {
    id: asAssetId(`asset-${digest.slice(0, 24)}`),
    kind: "backdrop",
    name: "Source backdrop",
    mimeType: blob.type,
    byteSize: blob.size,
    digest,
    sourceUrl: "https://example.test/source.webp",
    license: "Apache-2.0",
  };
  return { asset, blob };
};

describe("source-backed assets", () => {
  it("保存済みBlobをネットワークへ出ずに返す", async () => {
    const { asset, blob } = await fixture();
    const fetchAsset = vi.fn<typeof fetch>();
    const saveBlob = vi.fn();

    await expect(
      loadSourceBackedAsset(asset, {
        loadBlob: async () => blob,
        saveBlob,
        fetch: fetchAsset,
      }),
    ).resolves.toBe(blob);
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("sourceUrlを検証してIndexedDB用Storeへ保存する", async () => {
    const { asset, blob } = await fixture();
    const saveBlob = vi.fn();

    await expect(
      loadSourceBackedAsset(asset, {
        loadBlob: async () => undefined,
        saveBlob,
        fetch: vi.fn(
          async () =>
            new Response(blob, {
              status: 200,
              headers: { "content-type": blob.type },
            }),
        ) as typeof fetch,
      }),
    ).resolves.toEqual(blob);
    expect(saveBlob).toHaveBeenCalledWith(asset.id, expect.any(Blob));
  });

  it("HTTP失敗と改ざんされた内容を保存しない", async () => {
    const { asset } = await fixture();
    const saveBlob = vi.fn();

    await expect(
      loadSourceBackedAsset(asset, {
        loadBlob: async () => undefined,
        saveBlob,
        fetch: vi.fn(
          async () => new Response(null, { status: 404 }),
        ) as typeof fetch,
      }),
    ).rejects.toThrow("HTTP 404");

    const changed = new Blob(["changed"], { type: "image/webp" });
    const sameSizedAsset = { ...asset, byteSize: changed.size };
    await expect(
      loadSourceBackedAsset(sameSizedAsset, {
        loadBlob: async () => undefined,
        saveBlob,
        fetch: vi.fn(
          async () =>
            new Response(changed, {
              status: 200,
              headers: { "content-type": changed.type },
            }),
        ) as typeof fetch,
      }),
    ).rejects.toThrow("内容が登録情報と一致しません");
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
