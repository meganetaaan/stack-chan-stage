import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  asCueExecutionId,
  asCueId,
  asAssetId,
  type PlannedSpeech,
} from "@stackchan-stage/domain";
import {
  evictAudioLru,
  planAudioWindow,
  type AudioPrefetchPolicy,
} from "../src";

const speech = (index: number, bytes: number): PlannedSpeech => ({
  cueId: asCueId(`cue-${index}`),
  executionId: asCueExecutionId(`execution-${index}`),
  fingerprint: `fingerprint-${index}`,
  text: `speech ${index}`,
  voice: { provider: "test", voiceId: "voice" },
  estimatedBytes: bytes,
});

describe("Audio rolling prefetch", () => {
  const policy: AudioPrefetchPolicy = {
    minimumReadySpeechCues: 1,
    maximumPreparedSpeechCues: 3,
    maximumPreparedBytes: 1_000,
    maximumSingleCueBytes: 600,
  };

  it("cue数・byte数の複数上限を超えない", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 600 }), {
          minLength: 0,
          maxLength: 20,
        }),
        (sizes) => {
          const result = planAudioWindow(
            sizes.map(speech),
            0,
            new Map(),
            policy,
          );
          if (!result.ok)
            return result.speech.estimatedBytes > policy.maximumSingleCueBytes;
          return (
            result.speech.length <= policy.maximumPreparedSpeechCues &&
            result.totalBytes <= policy.maximumPreparedBytes
          );
        },
      ),
    );
  });

  it("単一Cue上限超過をprepare前にrejectする", () => {
    expect(
      planAudioWindow([speech(0, 601)], 0, new Map(), policy),
    ).toMatchObject({
      ok: false,
      code: "audio_too_large",
    });
  });

  it("同じfingerprintを先読み枠で重複して数えない", () => {
    const repeated = speech(0, 200);
    const result = planAudioWindow(
      [repeated, repeated, speech(1, 200), speech(2, 200)],
      0,
      new Map(),
      policy,
    );
    expect(result).toMatchObject({
      ok: true,
      speech: [repeated, speech(1, 200), speech(2, 200)],
    });
  });

  it("先読み枠が満杯なら枠外の長大Cueをまだ評価しない", () => {
    const result = planAudioWindow(
      [speech(3, 601)],
      0,
      new Map([
        ["fingerprint-0", 100],
        ["fingerprint-1", 100],
        ["fingerprint-2", 100],
      ]),
      policy,
    );
    expect(result).toEqual({ ok: true, speech: [], totalBytes: 300 });
  });

  it("保護中assetを残しLRUから解放する", () => {
    const remaining = evictAudioLru(
      [
        { fingerprint: "current", byteSize: 500, lastUsed: 1 },
        { fingerprint: "old", byteSize: 400, lastUsed: 2 },
        { fingerprint: "new", byteSize: 400, lastUsed: 3 },
      ],
      policy,
      new Set(["current"]),
    );
    expect(remaining.map((entry) => entry.fingerprint)).toEqual([
      "current",
      "new",
    ]);
  });
});
