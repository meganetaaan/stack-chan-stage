import type {
  AssetKind,
  AssetMetadata,
  ValidationIssue,
} from "@stackchan-stage/domain";

export type FileAssetImportProgress = Readonly<{
  current: number;
  fileName: string;
  total: number;
}>;

export type FileAssetImportFailure = Readonly<{
  fileName: string;
  message: string;
  issues: readonly ValidationIssue[];
}>;

export type FileAssetImportSummary = Readonly<{
  added: readonly AssetMetadata[];
  skipped: readonly AssetMetadata[];
  failures: readonly FileAssetImportFailure[];
}>;

type AddAssetResult =
  | Readonly<{ ok: true; added: boolean }>
  | Readonly<{
      ok: false;
      message: string;
      issues: readonly ValidationIssue[];
    }>;

export const importFileAssets = async (
  files: readonly File[],
  kind: AssetKind,
  dependencies: Readonly<{
    prepare: (file: File, kind: AssetKind) => Promise<AssetMetadata>;
    add: (asset: AssetMetadata) => Promise<AddAssetResult>;
    onProgress?: (progress: FileAssetImportProgress) => void;
  }>,
): Promise<FileAssetImportSummary> => {
  const added: AssetMetadata[] = [];
  const skipped: AssetMetadata[] = [];
  const failures: FileAssetImportFailure[] = [];

  for (const [index, file] of files.entries()) {
    dependencies.onProgress?.({
      current: index + 1,
      fileName: file.name,
      total: files.length,
    });
    try {
      const asset = await dependencies.prepare(file, kind);
      const result = await dependencies.add(asset);
      if (!result.ok) {
        failures.push({
          fileName: file.name,
          message: result.message,
          issues: result.issues,
        });
      } else if (result.added) added.push(asset);
      else skipped.push(asset);
    } catch (error) {
      failures.push({
        fileName: file.name,
        message: error instanceof Error ? error.message : String(error),
        issues: [],
      });
    }
  }

  return { added, skipped, failures };
};
