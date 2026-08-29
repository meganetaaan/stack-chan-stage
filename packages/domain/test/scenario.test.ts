import { describe, expect, it } from "vitest";

import {
  asAssetId,
  asCueId,
  asLaneId,
  asRoleId,
  cueSchema,
  parseScenario,
  validateScenario,
} from "../src";
import { scenarioFixture } from "./fixtures";

describe("Cue schema", () => {
  it("discriminated unionの各境界を検証する", () => {
    expect(
      cueSchema.parse({
        id: asCueId("speech-1"),
        kind: "speech",
        roleId: asRoleId("role-1"),
        text: "こんにちは",
      }),
    ).toMatchObject({ kind: "speech", text: "こんにちは" });

    expect(() =>
      cueSchema.parse({
        id: "motion-1",
        kind: "motion",
        roleId: "role-1",
        motion: { kind: "pose", yaw: 99, pitch: 0, durationMs: -1 },
      }),
    ).toThrow();
    expect(() =>
      cueSchema.parse({
        id: "pause-1",
        kind: "pause",
        durationMs: 10,
        roleId: "not-allowed",
      }),
    ).toThrow();
  });
});

describe("Scenario validation", () => {
  it("正しいScenarioをparseできる", () => {
    const parsed = parseScenario(scenarioFixture());
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.scenario.scenes[0]?.lanes).toHaveLength(1);
  });

  it("存在しないRole/AssetとMVP外の複数Laneを報告する", () => {
    const scenario = scenarioFixture();
    const lane = scenario.scenes[0]!.lanes[0];
    const invalid = {
      ...scenario,
      scenes: [
        {
          ...scenario.scenes[0]!,
          lanes: [
            {
              ...lane,
              cues: [
                {
                  id: asCueId("bad-role"),
                  kind: "speech" as const,
                  roleId: asRoleId("missing"),
                  text: "x",
                },
                {
                  id: asCueId("bad-asset"),
                  kind: "backdrop.set" as const,
                  assetId: asAssetId("missing"),
                  transition: { kind: "cut" as const },
                },
              ],
            },
            { id: asLaneId("lane-2"), name: "Second", cues: [] },
          ] as [typeof lane, typeof lane],
        },
      ],
    };
    expect(validateScenario(invalid).map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "scene.mvp_lane_count",
        "cue.role_not_found",
        "cue.asset_not_found",
      ]),
    );
  });
});
