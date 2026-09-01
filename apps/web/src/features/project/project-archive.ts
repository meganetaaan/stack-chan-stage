import {
  AsyncUnzipInflate,
  Unzip,
  UnzipPassThrough,
  zip,
  type AsyncZippable,
  type UnzipFile,
} from "fflate";
import { z } from "zod";

import {
  castPlanSchema,
  emptyCastPlan,
  parseScenario,
  validateScenario,
  type Actor,
  type AssetId,
  type AssetMetadata,
  type CastPlan,
  type Scenario,
  type ValidationIssue,
} from "@stackchan-stage/domain";
import type { ProjectAssetBlob } from "@stackchan-stage/application";

export const PROJECT_ARCHIVE_MIME_TYPE = "application/zip";
export const PROJECT_ARCHIVE_EXTENSION = ".stackchan-stage.zip";
export const MAX_PROJECT_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_PROJECT_ARCHIVE_ENTRIES = 1024;
export const MAX_PROJECT_ASSET_BYTES = 25 * 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const sha256Pattern = /^[0-9a-f]{64}$/;
const assetPathPattern = /^assets\/[0-9a-f]{64}\.[a-z0-9]+$/;

const archiveAssetSchema = z
  .object({
    id: z.string().trim().min(1),
    path: z.string().regex(assetPathPattern),
  })
  .strict();

export const projectArchiveManifestSchema = z
  .object({
    format: z.literal("stackchan-stage-project"),
    schemaVersion: z.literal(1),
    scenario: z.literal("scenario.json"),
    cast: z.literal("cast.json").optional(),
    assets: z.array(archiveAssetSchema),
  })
  .strict();

export type ProjectArchiveManifest = z.output<
  typeof projectArchiveManifestSchema
>;

export type ProjectImportSummary = Readonly<{
  title: string;
  sceneCount: number;
  cueCount: number;
  roleCount: number;
  castAssignmentCount: number;
  assetCount: number;
  assetBytes: number;
  unresolvedActorIds: readonly string[];
  castIncluded: boolean;
}>;

export type PreparedProjectImport = Readonly<{
  scenario: Scenario;
  castPlan: CastPlan;
  assetBlobs: readonly ProjectAssetBlob[];
  summary: ProjectImportSummary;
}>;

export class ProjectArchiveError extends Error {
  readonly code: string;
  readonly issues: readonly ValidationIssue[];

  constructor(
    code: string,
    message: string,
    issues: readonly ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "ProjectArchiveError";
    this.code = code;
    this.issues = issues;
  }
}

const error = (code: string, message: string): ProjectArchiveError =>
  new ProjectArchiveError(code, message);

const bytesToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const blobBytes = async (blob: Blob): Promise<Uint8Array> =>
  new Uint8Array(await blob.arrayBuffer());

const hasZipSignature = (data: Uint8Array) =>
  data.byteLength >= 4 &&
  data[0] === 0x50 &&
  data[1] === 0x4b &&
  ((data[2] === 0x03 && data[3] === 0x04) ||
    (data[2] === 0x05 && data[3] === 0x06) ||
    (data[2] === 0x07 && data[3] === 0x08));

const zipAsync = (files: AsyncZippable): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (zipError, data) => {
      if (zipError) reject(zipError);
      else resolve(data);
    });
  });

const unzipAsync = (
  data: Uint8Array,
): Promise<Readonly<Record<string, Uint8Array>>> =>
  new Promise((resolve, reject) => {
    const files: Record<string, Uint8Array> = {};
    const activeFiles = new Set<UnzipFile>();
    const paths = new Set<string>();
    let entryCount = 0;
    let declaredBytes = 0;
    let expandedBytes = 0;
    let archivePushed = false;
    let settled = false;
    const fail = (caught: unknown) => {
      if (settled) return;
      settled = true;
      activeFiles.forEach((file) => file.terminate());
      reject(caught);
    };
    const finishIfReady = () => {
      if (settled || !archivePushed || activeFiles.size > 0) return;
      settled = true;
      resolve(files);
    };
    const archive = new Unzip((file) => {
      if (settled) return;
      entryCount += 1;
      if (entryCount > MAX_PROJECT_ARCHIVE_ENTRIES) {
        fail(
          error("project.too_many_entries", "ZIP内のファイル数が多すぎます"),
        );
        return;
      }
      if (paths.has(file.name)) {
        fail(
          error(
            "project.duplicate_entry",
            `ZIP内で${file.name}が重複しています`,
          ),
        );
        return;
      }
      paths.add(file.name);
      declaredBytes += file.originalSize ?? 0;
      if (declaredBytes > MAX_PROJECT_ARCHIVE_BYTES) {
        fail(
          error("project.too_large", "展開後のサイズが256 MiBを超えています"),
        );
        return;
      }
      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      activeFiles.add(file);
      file.ondata = (unzipError, chunk, final) => {
        if (settled) return;
        if (unzipError) {
          fail(unzipError);
          return;
        }
        entryBytes += chunk.byteLength;
        expandedBytes += chunk.byteLength;
        if (
          expandedBytes > MAX_PROJECT_ARCHIVE_BYTES ||
          (file.name.startsWith("assets/") &&
            entryBytes > MAX_PROJECT_ASSET_BYTES)
        ) {
          fail(
            error(
              "project.too_large",
              file.name.startsWith("assets/")
                ? `${file.name}は25 MiBを超えています`
                : "展開後のサイズが256 MiBを超えています",
            ),
          );
          return;
        }
        chunks.push(chunk);
        if (!final) return;
        const output = new Uint8Array(entryBytes);
        let offset = 0;
        chunks.forEach((part) => {
          output.set(part, offset);
          offset += part.byteLength;
        });
        files[file.name] = output;
        activeFiles.delete(file);
        finishIfReady();
      };
      try {
        file.start();
      } catch (caught) {
        fail(caught);
      }
    });
    archive.register(UnzipPassThrough);
    archive.register(AsyncUnzipInflate);
    try {
      archive.push(data, true);
      archivePushed = true;
      finishIfReady();
    } catch (caught) {
      fail(caught);
    }
  });

const parseJson = (bytes: Uint8Array, label: string): unknown => {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw error("project.invalid_json", `${label}をJSONとして読めません`);
  }
};

const mimeExtension = (mimeType: string) => {
  const extensions: Readonly<Record<string, string>> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/webm": "webm",
  };
  return extensions[mimeType.toLowerCase()] ?? "bin";
};

const archivePathFor = (asset: AssetMetadata) =>
  `assets/${asset.digest.toLowerCase()}.${mimeExtension(asset.mimeType)}`;

const validateAssetMetadata = (asset: AssetMetadata) => {
  if (!sha256Pattern.test(asset.digest))
    throw error(
      "project.asset_digest_invalid",
      `素材「${asset.name}」のSHA-256が不正です`,
    );
  if (asset.byteSize > MAX_PROJECT_ASSET_BYTES)
    throw error(
      "project.asset_too_large",
      `素材「${asset.name}」は25 MiBを超えています`,
    );
  const expectedPrefix = asset.kind === "backdrop" ? "image/" : "audio/";
  if (!asset.mimeType.startsWith(expectedPrefix))
    throw error(
      "project.asset_mime_invalid",
      `素材「${asset.name}」のMIME種別が用途と一致しません`,
    );
};

const castReferenceIssues = (
  scenario: Scenario,
  castPlan: CastPlan,
): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const roleIds = new Set<string>(scenario.roles.map((role) => role.id));
  const sceneIds = new Set<string>(scenario.scenes.map((scene) => scene.id));
  const inspectAssignments = (
    assignments: Readonly<Partial<Record<string, string>>>,
    path: readonly (string | number)[],
  ) => {
    Object.keys(assignments).forEach((roleId) => {
      if (!roleIds.has(roleId))
        issues.push({
          code: "cast.role_not_found",
          message: `配役が存在しないRole ${roleId}を参照しています`,
          path: [...path, "assignments", roleId],
          severity: "error",
        });
    });
  };
  inspectAssignments(castPlan.global.assignments, ["castPlan", "global"]);
  Object.entries(castPlan.scenes).forEach(([sceneId, cast]) => {
    if (!sceneIds.has(sceneId))
      issues.push({
        code: "cast.scene_not_found",
        message: `配役が存在しないScene ${sceneId}を参照しています`,
        path: ["castPlan", "scenes", sceneId],
        severity: "error",
      });
    if (cast)
      inspectAssignments(cast.assignments, ["castPlan", "scenes", sceneId]);
  });
  return issues;
};

const validateProject = (scenario: Scenario, castPlan: CastPlan) => {
  const issues = [
    ...validateScenario(scenario),
    ...castReferenceIssues(scenario, castPlan),
  ];
  if (scenario.scenes.length === 0)
    issues.push({
      code: "scenario.scene_required",
      message: "プロジェクトには1つ以上の場面が必要です",
      path: ["scenes"],
      severity: "error" as const,
    });
  if (issues.some((issue) => issue.severity === "error"))
    throw new ProjectArchiveError(
      "project.validation_failed",
      issues[0]?.message ?? "プロジェクトの内容が不正です",
      issues,
    );
};

const castActorIds = (castPlan: CastPlan) => {
  const ids = new Set<string>();
  const collect = (cast: CastPlan["global"]) => {
    Object.values(cast.assignments).forEach((actorId) => {
      if (actorId) ids.add(actorId);
    });
    if (cast.standInActorId) ids.add(cast.standInActorId);
  };
  collect(castPlan.global);
  Object.values(castPlan.scenes).forEach((cast) => {
    if (cast) collect(cast);
  });
  return ids;
};

const castAssignmentCount = (castPlan: CastPlan) => {
  const count = (cast: CastPlan["global"]) =>
    Object.values(cast.assignments).filter(Boolean).length +
    (cast.standInActorId ? 1 : 0);
  return (
    count(castPlan.global) +
    Object.values(castPlan.scenes).reduce(
      (total, cast) => total + (cast ? count(cast) : 0),
      0,
    )
  );
};

const projectSummary = (
  scenario: Scenario,
  castPlan: CastPlan,
  actors: readonly Actor[],
  castIncluded: boolean,
): ProjectImportSummary => {
  const availableActors = new Set<string>(actors.map((actor) => actor.id));
  const unresolvedActorIds = [...castActorIds(castPlan)]
    .filter((actorId) => !availableActors.has(actorId))
    .sort();
  return {
    title: scenario.title,
    sceneCount: scenario.scenes.length,
    cueCount: scenario.scenes.reduce(
      (sceneTotal, scene) =>
        sceneTotal +
        scene.lanes.reduce(
          (laneTotal, lane) => laneTotal + lane.cues.length,
          0,
        ),
      0,
    ),
    roleCount: scenario.roles.length,
    castAssignmentCount: castAssignmentCount(castPlan),
    assetCount: scenario.assets.length,
    assetBytes: scenario.assets.reduce(
      (total, asset) => total + asset.byteSize,
      0,
    ),
    unresolvedActorIds,
    castIncluded,
  };
};

export const createProjectArchive = async ({
  scenario,
  castPlan,
  loadBlob,
}: Readonly<{
  scenario: Scenario;
  castPlan: CastPlan;
  loadBlob: (assetId: AssetId) => Promise<Blob | undefined>;
}>): Promise<Blob> => {
  validateProject(scenario, castPlan);
  if (
    scenario.assets.reduce((total, asset) => total + asset.byteSize, 0) >
    MAX_PROJECT_ARCHIVE_BYTES
  )
    throw error("project.too_large", "素材の合計サイズが256 MiBを超えています");
  if (scenario.assets.length + 3 > MAX_PROJECT_ARCHIVE_ENTRIES)
    throw error("project.too_many_entries", "素材の数が多すぎます");

  const manifestAssets: ProjectArchiveManifest["assets"][number][] = [];
  const scenarioData = encoder.encode(JSON.stringify(scenario, null, 2));
  const castData = encoder.encode(JSON.stringify(castPlan, null, 2));
  let expandedBytes = scenarioData.byteLength + castData.byteLength;
  const files: AsyncZippable = {
    "scenario.json": scenarioData,
    "cast.json": castData,
  };
  for (const asset of scenario.assets) {
    validateAssetMetadata(asset);
    const blob = await loadBlob(asset.id);
    if (!blob)
      throw error(
        "project.asset_missing",
        `素材「${asset.name}」の本体が見つかりません`,
      );
    const data = await blobBytes(blob);
    if (data.byteLength !== asset.byteSize)
      throw error(
        "project.asset_size_mismatch",
        `素材「${asset.name}」のサイズが登録情報と一致しません`,
      );
    const digest = await sha256Hex(data);
    if (digest !== asset.digest)
      throw error(
        "project.asset_digest_mismatch",
        `素材「${asset.name}」の内容が登録情報と一致しません`,
      );
    expandedBytes += data.byteLength;
    if (expandedBytes > MAX_PROJECT_ARCHIVE_BYTES)
      throw error(
        "project.too_large",
        "プロジェクトの展開後サイズが256 MiBを超えています",
      );
    const path = archivePathFor(asset);
    if (files[path])
      throw error(
        "project.asset_path_duplicate",
        `素材「${asset.name}」の保存先が重複しています`,
      );
    files[path] = data;
    manifestAssets.push({ id: asset.id, path });
  }
  const manifest: ProjectArchiveManifest = {
    format: "stackchan-stage-project",
    schemaVersion: 1,
    scenario: "scenario.json",
    cast: "cast.json",
    assets: manifestAssets,
  };
  const manifestData = encoder.encode(JSON.stringify(manifest, null, 2));
  if (expandedBytes + manifestData.byteLength > MAX_PROJECT_ARCHIVE_BYTES)
    throw error(
      "project.too_large",
      "プロジェクトの展開後サイズが256 MiBを超えています",
    );
  files["manifest.json"] = manifestData;
  const archive = await zipAsync(files);
  if (archive.byteLength > MAX_PROJECT_ARCHIVE_BYTES)
    throw error(
      "project.too_large",
      "プロジェクトファイルが256 MiBを超えています",
    );
  return new Blob([bytesToArrayBuffer(archive)], {
    type: PROJECT_ARCHIVE_MIME_TYPE,
  });
};

export const readProjectArchive = async (
  file: Blob,
  actors: readonly Actor[],
): Promise<PreparedProjectImport> => {
  if (file.size > MAX_PROJECT_ARCHIVE_BYTES)
    throw error(
      "project.too_large",
      "プロジェクトファイルが256 MiBを超えています",
    );

  const archiveBytes = await blobBytes(file);
  if (!hasZipSignature(archiveBytes))
    throw error("project.invalid_zip", "プロジェクトファイルを展開できません");
  let files: Readonly<Record<string, Uint8Array>>;
  try {
    files = await unzipAsync(archiveBytes);
  } catch (caught) {
    if (caught instanceof ProjectArchiveError) throw caught;
    throw error("project.invalid_zip", "プロジェクトファイルを展開できません");
  }
  const entries = Object.entries(files).filter(([path]) => !path.endsWith("/"));
  if (entries.length > MAX_PROJECT_ARCHIVE_ENTRIES)
    throw error("project.too_many_entries", "ZIP内のファイル数が多すぎます");
  const expandedBytes = entries.reduce(
    (total, [, data]) => total + data.byteLength,
    0,
  );
  if (expandedBytes > MAX_PROJECT_ARCHIVE_BYTES)
    throw error("project.too_large", "展開後のサイズが256 MiBを超えています");

  const manifestBytes = files["manifest.json"];
  if (!manifestBytes)
    throw error("project.manifest_missing", "manifest.jsonがありません");
  const manifestResult = projectArchiveManifestSchema.safeParse(
    parseJson(manifestBytes, "manifest.json"),
  );
  if (!manifestResult.success)
    throw error(
      "project.manifest_invalid",
      "manifest.jsonの形式またはversionに対応していません",
    );
  const manifest = manifestResult.data;

  const expectedPaths = new Set([
    "manifest.json",
    manifest.scenario,
    ...(manifest.cast ? [manifest.cast] : []),
    ...manifest.assets.map((asset) => asset.path),
  ]);
  const unexpectedPath = entries.find(([path]) => !expectedPaths.has(path));
  if (unexpectedPath)
    throw error(
      "project.unexpected_entry",
      `ZIPに未定義のファイル ${unexpectedPath[0]} が含まれています`,
    );

  const scenarioBytes = files[manifest.scenario];
  if (!scenarioBytes)
    throw error("project.scenario_missing", "scenario.jsonがありません");
  const parsedScenario = parseScenario(
    parseJson(scenarioBytes, "scenario.json"),
  );
  if (!parsedScenario.ok)
    throw new ProjectArchiveError(
      "project.scenario_invalid",
      parsedScenario.issues[0]?.message ?? "scenario.jsonが不正です",
      parsedScenario.issues,
    );
  const scenario = parsedScenario.scenario;

  let castPlan = emptyCastPlan();
  if (manifest.cast) {
    const castBytes = files[manifest.cast];
    if (!castBytes)
      throw error("project.cast_missing", "cast.jsonがありません");
    const parsedCast = castPlanSchema.safeParse(
      parseJson(castBytes, "cast.json"),
    );
    if (!parsedCast.success)
      throw error("project.cast_invalid", "cast.jsonの形式が不正です");
    castPlan = parsedCast.data;
  }
  validateProject(scenario, castPlan);

  if (manifest.assets.length !== scenario.assets.length)
    throw error(
      "project.asset_manifest_mismatch",
      "素材一覧とmanifestの対応が一致しません",
    );
  const byId = new Map<string, ProjectArchiveManifest["assets"][number]>();
  const usedPaths = new Set<string>();
  for (const entry of manifest.assets) {
    if (byId.has(entry.id) || usedPaths.has(entry.path))
      throw error(
        "project.asset_manifest_duplicate",
        "manifestの素材IDまたは保存先が重複しています",
      );
    byId.set(entry.id, entry);
    usedPaths.add(entry.path);
  }

  const assetBlobs: ProjectAssetBlob[] = [];
  for (const asset of scenario.assets) {
    validateAssetMetadata(asset);
    const entry = byId.get(asset.id);
    if (!entry || !entry.path.startsWith(`assets/${asset.digest}.`))
      throw error(
        "project.asset_manifest_mismatch",
        `素材「${asset.name}」の保存先が登録情報と一致しません`,
      );
    const data = files[entry.path];
    if (!data)
      throw error(
        "project.asset_missing",
        `素材「${asset.name}」の本体がありません`,
      );
    if (data.byteLength !== asset.byteSize)
      throw error(
        "project.asset_size_mismatch",
        `素材「${asset.name}」のサイズが登録情報と一致しません`,
      );
    if ((await sha256Hex(data)) !== asset.digest)
      throw error(
        "project.asset_digest_mismatch",
        `素材「${asset.name}」のSHA-256が一致しません`,
      );
    assetBlobs.push({
      id: asset.id,
      blob: new Blob([bytesToArrayBuffer(data)], { type: asset.mimeType }),
    });
  }

  return {
    scenario,
    castPlan,
    assetBlobs,
    summary: projectSummary(
      scenario,
      castPlan,
      actors,
      manifest.cast !== undefined,
    ),
  };
};

export const projectArchiveFileName = (title: string) => {
  const safe = title
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${safe || "project"}${PROJECT_ARCHIVE_EXTENSION}`;
};

const sha256Hex = async (data: Uint8Array) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytesToArrayBuffer(data),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};
