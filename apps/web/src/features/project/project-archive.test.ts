import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  asActorId,
  asAssetId,
  asCueId,
  asLaneId,
  asRoleId,
  asScenarioId,
  asSceneId,
  type CastPlan,
  type Scenario,
} from "@stackchan-stage/domain";

import {
  createProjectArchive,
  projectArchiveFileName,
  ProjectArchiveError,
  readProjectArchive,
} from "./project-archive";

const digest = async (blob: Blob) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const fixture = async () => {
  const roleId = asRoleId("role-narrator");
  const actorId = asActorId("actor-device-1");
  const backdrop = new Blob(["image-data"], { type: "image/png" });
  const music = new Blob(["music-data"], { type: "audio/ogg" });
  const backdropDigest = await digest(backdrop);
  const musicDigest = await digest(music);
  const backdropId = asAssetId(`asset-${backdropDigest.slice(0, 24)}`);
  const musicId = asAssetId(`asset-${musicDigest.slice(0, 24)}`);
  const scenario: Scenario = {
    schemaVersion: 1,
    id: asScenarioId("scenario-archive"),
    title: "WebMCPの舞台",
    roles: [{ id: roleId, name: "語り手" }],
    scenes: [
      {
        id: asSceneId("scene-opening"),
        title: "開演",
        lanes: [
          {
            id: asLaneId("lane-opening"),
            name: "本線",
            cues: [
              {
                id: asCueId("cue-backdrop"),
                kind: "backdrop.set",
                assetId: backdropId,
                transition: { kind: "cut" },
              },
              {
                id: asCueId("cue-speech"),
                kind: "speech",
                roleId,
                text: "プロジェクトを読み書きします。",
              },
              {
                id: asCueId("cue-music"),
                kind: "music.start",
                assetId: musicId,
                loop: false,
                volume: 0.7,
                fadeInMs: 100,
              },
            ],
          },
        ],
      },
    ],
    assets: [
      {
        id: backdropId,
        kind: "backdrop",
        name: "説明図",
        mimeType: backdrop.type,
        byteSize: backdrop.size,
        digest: backdropDigest,
        sourceUrl: "https://example.com/image.png",
        license: "CC BY 4.0",
      },
      {
        id: musicId,
        kind: "music",
        name: "テーマ曲",
        mimeType: music.type,
        byteSize: music.size,
        digest: musicDigest,
      },
    ],
  };
  const castPlan: CastPlan = {
    global: { assignments: { [roleId]: actorId } },
    scenes: {},
  };
  const blobs = new Map([
    [backdropId, backdrop],
    [musicId, music],
  ]);
  return { scenario, castPlan, blobs, actorId };
};

describe("Project archive", () => {
  it("Scenario、Cast、素材BlobをZIPで往復する", async () => {
    const source = await fixture();
    const archive = await createProjectArchive({
      scenario: source.scenario,
      castPlan: source.castPlan,
      loadBlob: async (assetId) => source.blobs.get(assetId),
    });

    const project = await readProjectArchive(archive, []);

    expect(project.scenario).toEqual(source.scenario);
    expect(project.castPlan).toEqual(source.castPlan);
    expect(project.summary).toMatchObject({
      title: "WebMCPの舞台",
      sceneCount: 1,
      cueCount: 3,
      roleCount: 1,
      castAssignmentCount: 1,
      assetCount: 2,
      unresolvedActorIds: [source.actorId],
      castIncluded: true,
    });
    await expect(project.assetBlobs[0]?.blob.text()).resolves.toBe(
      "image-data",
    );
    await expect(project.assetBlobs[1]?.blob.text()).resolves.toBe(
      "music-data",
    );
  });

  it("改ざんされた素材と未定義ファイルを拒否する", async () => {
    const source = await fixture();
    const archive = await createProjectArchive({
      scenario: source.scenario,
      castPlan: source.castPlan,
      loadBlob: async (assetId) => source.blobs.get(assetId),
    });
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    files[manifest.assets[0].path] = strToU8("image-dAta");
    const tampered = new Blob([zipSync(files)]);

    await expect(readProjectArchive(tampered, [])).rejects.toMatchObject({
      code: "project.asset_digest_mismatch",
    });

    files[manifest.assets[0].path] = strToU8("image-data");
    files["unexpected.txt"] = strToU8("hidden");
    await expect(
      readProjectArchive(new Blob([zipSync(files)]), []),
    ).rejects.toMatchObject({ code: "project.unexpected_entry" });
  });

  it("素材本体が欠けた書出しを拒否し、安全なファイル名を作る", async () => {
    const source = await fixture();
    await expect(
      createProjectArchive({
        scenario: source.scenario,
        castPlan: source.castPlan,
        loadBlob: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(ProjectArchiveError);
    expect(projectArchiveFileName('  WebMCP: "舞台" / 第1幕  ')).toBe(
      "WebMCP- -舞台- - 第1幕.stackchan-stage.zip",
    );
  });

  it("未知versionとpath traversalをmanifest境界で拒否する", async () => {
    const source = await fixture();
    const archive = await createProjectArchive({
      scenario: source.scenario,
      castPlan: source.castPlan,
      loadBlob: async (assetId) => source.blobs.get(assetId),
    });
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));

    manifest.schemaVersion = 2;
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    await expect(
      readProjectArchive(new Blob([zipSync(files)]), []),
    ).rejects.toMatchObject({ code: "project.manifest_invalid" });

    manifest.schemaVersion = 1;
    manifest.assets[0].path = "../outside.png";
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    await expect(
      readProjectArchive(new Blob([zipSync(files)]), []),
    ).rejects.toMatchObject({ code: "project.manifest_invalid" });
  });

  it("ZIPではない入力を展開前に拒否する", async () => {
    await expect(
      readProjectArchive(new Blob(["not a zip"]), []),
    ).rejects.toMatchObject({
      code: "project.invalid_zip",
      message: "プロジェクトファイルを展開できません",
    });
  });
});
