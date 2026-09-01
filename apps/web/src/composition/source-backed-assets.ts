import type { AssetId, AssetMetadata } from "@stackchan-stage/domain";

type SourceAssetDependencies = Readonly<{
  loadBlob: (assetId: AssetId) => Promise<Blob | undefined>;
  saveBlob: (assetId: AssetId, blob: Blob) => Promise<void>;
  fetch?: typeof fetch;
}>;

const hexadecimal = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const loadSourceBackedAsset = async (
  asset: AssetMetadata,
  dependencies: SourceAssetDependencies,
): Promise<Blob | undefined> => {
  const stored = await dependencies.loadBlob(asset.id);
  if (stored) return stored;
  if (!asset.sourceUrl) return undefined;

  const response = await (dependencies.fetch ?? fetch)(asset.sourceUrl);
  if (!response.ok)
    throw new Error(
      `素材「${asset.name}」の取得に失敗しました (HTTP ${response.status})`,
    );
  const blob = await response.blob();
  if (blob.type.toLowerCase() !== asset.mimeType.toLowerCase())
    throw new Error(`素材「${asset.name}」のMIME種別が登録情報と一致しません`);
  if (blob.size !== asset.byteSize)
    throw new Error(`素材「${asset.name}」のサイズが登録情報と一致しません`);
  const digest = hexadecimal(
    await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
  );
  if (digest !== asset.digest)
    throw new Error(`素材「${asset.name}」の内容が登録情報と一致しません`);
  await dependencies.saveBlob(asset.id, blob);
  return blob;
};
