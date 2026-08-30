import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
  asAssetId,
  asLaneId,
  asScenarioId,
  asSceneId,
  emptyCastPlan,
} from "@stackchan-stage/domain";
import { createIndexedDbAudioCache, createIndexedDbProjectStore } from "../src";

describe("IndexedDB persistence", () => {
  it("project snapshotとBlobを分離して保存する", async () => {
    const store = createIndexedDbProjectStore(`project-${crypto.randomUUID()}`);
    const snapshot = {
      scenario: {
        schemaVersion: 1 as const,
        id: asScenarioId("scenario-1"),
        title: "月食の夜",
        roles: [],
        scenes: [
          {
            id: asSceneId("scene-1"),
            title: "第一場",
            lanes: [
              {
                id: asLaneId("lane-1"),
                name: "本線",
                cues: [],
              },
            ] as const,
          },
        ],
        assets: [],
      },
      castPlan: emptyCastPlan(),
      revision: 4,
    };
    await store.save(snapshot);
    await store.saveBlob(
      asAssetId("asset-1"),
      new Blob(["backdrop"], { type: "image/png" }),
    );

    await expect(store.load()).resolves.toEqual(snapshot);
    const blob = await store.loadBlob(asAssetId("asset-1"));
    expect(await blob?.text()).toBe("backdrop");
    await store.close();
  });

  it("derived audioをbyte budget付きLRUでevictする", async () => {
    let time = 0;
    const cache = createIndexedDbAudioCache({
      databaseName: `audio-${crypto.randomUUID()}`,
      maximumBytes: 5,
      maximumEntries: 3,
      now: () => ++time,
    });
    await cache.put({
      id: asAssetId("audio-1"),
      fingerprint: "first",
      mimeType: "audio/ogg",
      byteSize: 3,
      data: Uint8Array.of(1, 2, 3),
    });
    await cache.put({
      id: asAssetId("audio-2"),
      fingerprint: "second",
      mimeType: "audio/ogg",
      byteSize: 3,
      data: Uint8Array.of(4, 5, 6),
    });

    await expect(cache.get("first")).resolves.toBeUndefined();
    await expect(cache.get("second")).resolves.toMatchObject({ id: "audio-2" });
    expect(await cache.entries()).toHaveLength(1);
    await cache.close();
  });
});
