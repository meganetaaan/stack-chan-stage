import { describe, expect, it } from "vitest";

import { parseScenario, validateScenario } from "@stackchan-stage/domain";

import {
  defaultCastPlan,
  defaultScenario,
  demoMusicAssetId,
  finaleBackdropAssetId,
  openWebBackdropAssetId,
  revisionLoopBackdropAssetId,
} from "./default-workspace";

describe("default workspace", () => {
  it("公開base URLを持つ13 Cueのデモ演目を構成する", () => {
    const scenario = defaultScenario("https://example.test/stack-chan-stage/");

    expect(parseScenario(scenario)).toMatchObject({ ok: true });
    expect(validateScenario(scenario)).toEqual([]);
    expect(scenario).toMatchObject({
      id: "scenario-first-stage",
      title: "WebMCPとつくる舞台",
    });
    expect(scenario.scenes.map((scene) => scene.title)).toEqual([
      "開演",
      "共同演出",
      "フィナーレ",
    ]);
    expect(
      scenario.scenes.flatMap((scene) => scene.lanes[0].cues),
    ).toHaveLength(13);
    expect(scenario.assets.map((asset) => asset.id)).toEqual([
      openWebBackdropAssetId,
      revisionLoopBackdropAssetId,
      finaleBackdropAssetId,
      demoMusicAssetId,
    ]);
    expect(scenario.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUrl:
            "https://example.test/stack-chan-stage/demo/scene-01a-web-constellation.webp",
          license: expect.stringContaining("Apache-2.0"),
        }),
        expect.objectContaining({
          sourceUrl:
            "https://example.test/stack-chan-stage/demo/webmcp-night-loop.wav",
          mimeType: "audio/wav",
        }),
      ]),
    );

    const collaboration = scenario.scenes[1]?.lanes[0].cues;
    expect(collaboration).toEqual([
      expect.objectContaining({
        id: "cue-collaboration-backdrop",
        assetId: openWebBackdropAssetId,
      }),
      expect.objectContaining({
        id: "cue-collaboration-expression",
        expression: "DOUBTFUL",
      }),
      expect.objectContaining({
        id: "cue-collaboration-line",
        text: "この場面は、まだ下書きです。",
      }),
      expect.objectContaining({
        id: "cue-collaboration-motion",
        motion: { kind: "preset", name: "thinking" },
      }),
    ]);
    expect(defaultCastPlan().global.assignments).toMatchObject({
      narrator: "wasm-actor",
      guest: "wasm-actor",
    });
  });
});
