import type { CouncilReport } from "@/lib/orchestration";
import {
  buildSecondReviewPlan,
  type SecondReviewReport,
} from "@/lib/second-review";

export type ReviewStage = "findings" | "second" | "final";

/** Availability only: changing stages never starts a provider request. */
export function reviewStageAvailability(
  baseline: CouncilReport | null,
  secondRound: SecondReviewReport | null,
  running: boolean,
) {
  const plan =
    baseline?.schema_version === "2.1.0"
      ? buildSecondReviewPlan(baseline)
      : null;
  const hasSecondRound =
    !!baseline && secondRound?.source_sha256 === baseline.source_sha256;
  const secondReviewAvailable = !!plan && !running;
  const finalReportAvailable =
    !!baseline && !running && (hasSecondRound || !!plan?.skipped_reason);
  const finalReportReason = hasSecondRound
    ? "The report combines first-round findings and second-round judgments."
    : plan?.skipped_reason === "insufficient_reviewers"
      ? "Second Review requires at least two completed model reviews. The Final Report contains the available first-round findings."
      : plan?.skipped_reason === "no_disagreements"
        ? "No findings require Second Review. The Final Report contains the first-round findings."
        : plan?.skipped_reason === "no_eligible_assignments"
          ? "No eligible model assignments remain for Second Review. The Final Report preserves the available findings and unresolved coverage."
          : "Run Second Review to add the assigned models’ judgments to the Final Report.";
  return {
    plan,
    secondReviewAvailable,
    finalReportAvailable,
    finalReportReason,
  };
}
