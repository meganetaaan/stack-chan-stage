import type { PlannedSpeech } from "@stackchan-stage/domain";

export type AudioPrefetchPolicy = Readonly<{
  minimumReadySpeechCues: number;
  maximumPreparedSpeechCues: number;
  maximumPreparedBytes: number;
  maximumSingleCueBytes: number;
}>;

export const DEFAULT_AUDIO_PREFETCH_POLICY: AudioPrefetchPolicy = {
  minimumReadySpeechCues: 1,
  maximumPreparedSpeechCues: 3,
  maximumPreparedBytes: 12 * 1024 * 1024,
  maximumSingleCueBytes: 4 * 1024 * 1024,
};

export type AudioWindowPlan =
  | Readonly<{ ok: true; speech: readonly PlannedSpeech[]; totalBytes: number }>
  | Readonly<{ ok: false; code: "audio_too_large"; speech: PlannedSpeech }>;

export const planAudioWindow = (
  speech: readonly PlannedSpeech[],
  startIndex: number,
  prepared: ReadonlyMap<string, number>,
  policy: AudioPrefetchPolicy = DEFAULT_AUDIO_PREFETCH_POLICY,
): AudioWindowPlan => {
  const selected: PlannedSpeech[] = [];
  const reservedFingerprints = new Set(prepared.keys());
  let totalBytes = [...prepared.values()].reduce(
    (sum, bytes) => sum + bytes,
    0,
  );
  let preparedCount = prepared.size;

  for (const candidate of speech.slice(startIndex)) {
    if (reservedFingerprints.has(candidate.fingerprint)) continue;
    if (preparedCount >= policy.maximumPreparedSpeechCues) break;
    if (candidate.estimatedBytes > policy.maximumSingleCueBytes)
      return { ok: false, code: "audio_too_large", speech: candidate };
    if (totalBytes + candidate.estimatedBytes > policy.maximumPreparedBytes)
      break;
    selected.push(candidate);
    reservedFingerprints.add(candidate.fingerprint);
    preparedCount += 1;
    totalBytes += candidate.estimatedBytes;
  }
  return { ok: true, speech: selected, totalBytes };
};

export type AudioCacheEntry = Readonly<{
  fingerprint: string;
  byteSize: number;
  lastUsed: number;
}>;

export const evictAudioLru = (
  entries: readonly AudioCacheEntry[],
  policy: AudioPrefetchPolicy = DEFAULT_AUDIO_PREFETCH_POLICY,
  protectedFingerprints: ReadonlySet<string> = new Set(),
): readonly AudioCacheEntry[] => {
  const kept = [...entries];
  const totals = () => kept.reduce((sum, entry) => sum + entry.byteSize, 0);
  while (
    kept.length > policy.maximumPreparedSpeechCues ||
    totals() > policy.maximumPreparedBytes
  ) {
    const evictable = kept
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !protectedFingerprints.has(entry.fingerprint))
      .sort((left, right) => left.entry.lastUsed - right.entry.lastUsed)[0];
    if (!evictable) break;
    kept.splice(evictable.index, 1);
  }
  return kept;
};
