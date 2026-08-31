import type { CueId, RunPlan, ValidationIssue } from "@stackchan-stage/domain";

export type PreviewSpeechMode = "audible" | "skip";

export type PreviewPlan = Readonly<{
  plan: RunPlan;
  skippedCueIds: readonly CueId[];
  warnings: readonly ValidationIssue[];
}>;

export const applyPreviewSpeechMode = (
  plan: RunPlan,
  mode: PreviewSpeechMode = "audible",
): PreviewPlan => {
  if (mode === "audible") return { plan, skippedCueIds: [], warnings: [] };

  const skippedCueIds = plan.cues.flatMap((entry) =>
    entry.cue.kind === "speech" ? [entry.cue.id] : [],
  );
  if (skippedCueIds.length === 0) return { plan, skippedCueIds, warnings: [] };

  return {
    plan: {
      ...plan,
      cues: plan.cues.filter((entry) => entry.cue.kind !== "speech"),
      speech: [],
    },
    skippedCueIds,
    warnings: [
      {
        code: "speech.skipped",
        message: `音声を省略する指定により、セリフ${skippedCueIds.length}件を試演から除外しました`,
        path: [],
        severity: "warning",
      },
    ],
  };
};
