import type { ReviewFinding } from "@/generated/review";
import type { CouncilReport } from "@/lib/orchestration";
import {
  assignedSecondReviewCandidates,
  type SecondReviewReport,
} from "@/lib/second-review";

type Severity = ReviewFinding["proposed_severity"];
export type FinalModelJudgment = {
  model_id: string;
  label: string;
  first_round: "reported" | "not_reported" | "unavailable";
  second_round:
    | "supported"
    | "not_supported"
    | "uncertain"
    | "failed"
    | "not_assigned"
    | "deferred"
    | "not_run";
  effective_verdict: "supported" | "not_supported" | "uncertain" | "unknown";
  opinion_source: "first_round" | "second_round" | "none";
  proposed_severity: Severity | null;
  rationale: string | null;
  evidence: ReviewFinding["evidence"] | null;
};
export type FinalFinding = {
  id: string;
  title: string;
  category: string;
  evidence: ReviewFinding["evidence"];
  rationale: string;
  recommendation: string;
  reported_by: string[];
  first_round_agreement: number;
  judgments: FinalModelJudgment[];
  supporting_models: string[];
  not_supported_models: string[];
  uncertain_models: string[];
  missing_models: string[];
  /** Assigned reassessments with no accepted response; never a fresh vote. */
  pending_reassessment_models: string[];
  /** Pending reviewers whose original source-bound finding remains the last accepted opinion. */
  retained_after_failed_review_models: string[];
  outcome: "supported" | "not_supported" | "unresolved";
  review_state: "first_round" | "reviewed" | "deferred" | "not_reviewed";
  severity_disagreement: boolean;
  proposed_severity: Severity | null;
  requires_review: boolean;
  next_action: string;
};
/** Titles come from original model reports and can be disputed later. */
export function findingHeadline(finding: FinalFinding): string {
  if (finding.outcome === "not_supported")
    return `Unsupported claim: ${finding.title}`;
  if (finding.not_supported_models.length)
    return `Disputed claim: ${finding.title}`;
  return finding.title;
}

/** A missing or uncertain response is never an explicit objection. */
export function oppositionNotice(finding: FinalFinding): string | null {
  const count = finding.not_supported_models.length;
  if (!count) return null;
  const denominator = finding.judgments.length;
  const who =
    count === 1 ? "1 model explicitly does" : `${count} models explicitly do`;
  return `${who} not support this claim (${count}/${denominator}). Verify the original claim before acting on its recommendation.`;
}

export type FinalReviewReport = {
  schema_version: "1.1.0";
  kind: "dtcc-consolidated-findings";
  aggregation_policy: "last-valid-opinion-v1";
  source_sha256: string;
  baseline_sha256: string | null;
  findings: FinalFinding[];
  summary: {
    total_findings: number;
    high: number;
    medium: number;
    low: number;
    unrated: number;
    requires_review: number;
    supported: number;
    not_supported: number;
    unresolved: number;
    first_round_completed: number;
    second_round_assigned: number;
    second_round_completed: number;
    retained_after_failed_review: number;
  };
  interpretation: string;
};
const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
const highest = (values: Severity[]) =>
  values.reduce<Severity | null>(
    (a, b) => (a === null || rank[b] > rank[a] ? b : a),
    null,
  );

/** Keep every distinct retained rating; a merged claim can have conflicting originals. */
export function currentModelSeverities(
  baseline: CouncilReport,
  findingId: string,
  judgment: FinalModelJudgment,
): Severity[] {
  if (judgment.opinion_source !== "first_round")
    return judgment.proposed_severity ? [judgment.proposed_severity] : [];
  const finding = baseline.findings.find((item) => item.id === findingId)!;
  const run = baseline.models.find(
    (item) => item.model_id === judgment.model_id,
  )!;
  return [
    ...new Set(
      finding.members
        .filter((member) => member.model_id === judgment.model_id)
        .map(
          (member) =>
            run.review!.findings[member.finding_index].proposed_severity,
        ),
    ),
  ].sort((a, b) => rank[b] - rank[a]);
}

/** Read model over already-validated reports; never mutates either original round.
 * Import/export boundaries must validate the exact baseline hash before calling.
 */
export function buildFinalReviewReport(
  baseline: CouncilReport,
  review?: SecondReviewReport | null,
): FinalReviewReport {
  if (review && review.source_sha256 !== baseline.source_sha256)
    throw new Error("Review source does not match the baseline.");
  const findings = baseline.findings.map((finding): FinalFinding => {
    const queued =
      baseline.review_queue?.some((item) => item.finding_id === finding.id) ??
      finding.agreement < 3;
    const deferred = review?.plan.deferred_ids.includes(finding.id) ?? false;
    const selected = review?.plan.candidate_ids.includes(finding.id) ?? false;
    const judgments = baseline.models.map((run): FinalModelJudgment => {
      const members = finding.members.filter(
        (item) => item.model_id === run.model_id,
      );
      const original = members.map(
        (member) => run.review!.findings[member.finding_index],
      );
      const originalRepresentative = original.reduce<ReviewFinding | null>(
        (selected, item) =>
          selected === null ||
          rank[item.proposed_severity] > rank[selected.proposed_severity]
            ? item
            : selected,
        null,
      );
      const first_round =
        run.status === "failed"
          ? "unavailable"
          : original.length
            ? "reported"
            : "not_reported";
      const assigned = review
        ? assignedSecondReviewCandidates(review.plan, run.model_id).includes(
            finding.id,
          )
        : false;
      const secondRun = review?.models.find(
        (item) => item.model_id === run.model_id,
      );
      const assessment = secondRun?.review?.assessments.find(
        (item) => item.finding_id === finding.id,
      );
      const second_round = !review
        ? "not_run"
        : deferred
          ? "deferred"
          : assessment
            ? assessment.verdict
            : assigned
              ? "failed"
              : "not_assigned";
      const effective_verdict =
        assessment?.verdict ?? (original.length ? "supported" : "unknown");
      const opinion_source = assessment
        ? "second_round"
        : original.length
          ? "first_round"
          : "none";
      return {
        model_id: run.model_id,
        label: run.label,
        first_round,
        second_round,
        effective_verdict,
        opinion_source,
        proposed_severity: assessment
          ? assessment.proposed_severity
          : highest(original.map((item) => item.proposed_severity)),
        rationale:
          assessment?.rationale ?? originalRepresentative?.rationale ?? null,
        evidence:
          assessment?.evidence ?? originalRepresentative?.evidence ?? null,
      };
    });
    const modelsWith = (verdict: FinalModelJudgment["effective_verdict"]) =>
      judgments
        .filter((item) => item.effective_verdict === verdict)
        .map((item) => item.model_id);
    const supporting_models = modelsWith("supported");
    const not_supported_models = modelsWith("not_supported");
    const uncertain_models = modelsWith("uncertain");
    const missing_models = modelsWith("unknown");
    const pending_reassessment_models = judgments
      .filter((item) => item.second_round === "failed")
      .map((item) => item.model_id);
    const retained_after_failed_review_models = judgments
      .filter(
        (item) =>
          item.second_round === "failed" &&
          item.opinion_source === "first_round",
      )
      .map((item) => item.model_id);
    const severities = judgments.flatMap((item) =>
      currentModelSeverities(baseline, finding.id, item),
    );
    const severity_disagreement = new Set(severities).size > 1;
    const outcome =
      !deferred && supporting_models.length === 3
        ? "supported"
        : !deferred && not_supported_models.length === 3
          ? "not_supported"
          : "unresolved";
    return {
      id: finding.id,
      title: finding.title,
      category: finding.category,
      evidence: finding.evidence,
      rationale: finding.rationale,
      recommendation: finding.recommendation,
      reported_by: [...finding.supporting_models],
      first_round_agreement: finding.agreement,
      judgments,
      supporting_models,
      not_supported_models,
      uncertain_models,
      missing_models,
      pending_reassessment_models,
      retained_after_failed_review_models,
      outcome,
      review_state: deferred
        ? "deferred"
        : selected
          ? "reviewed"
          : queued
            ? "not_reviewed"
            : "first_round",
      severity_disagreement,
      proposed_severity: highest(severities),
      requires_review:
        outcome !== "supported" ||
        severity_disagreement ||
        pending_reassessment_models.length > 0,
      next_action: pending_reassessment_models.length
        ? "Complete the outstanding reassessment or have a qualified reviewer check the evidence. Retained first-round opinions are not new second-round confirmations."
        : outcome === "supported"
          ? severity_disagreement
            ? "Validate exploitability and reconcile severity with a human reviewer."
            : "Validate exploitability and remediation with a human reviewer."
          : outcome === "not_supported"
            ? "Retain the original claim and counterevidence for human adjudication."
            : deferred
              ? "Review this deferred claim manually; no extra model round was executed."
              : "Resolve missing context or conflicting judgments with source review and a focused test.",
    };
  });
  // Sort only the derived view. Stable ties preserve the original finding order.
  findings.sort(
    (a, b) =>
      (b.proposed_severity ? rank[b.proposed_severity] : 0) -
      (a.proposed_severity ? rank[a.proposed_severity] : 0),
  );
  return {
    schema_version: "1.1.0",
    kind: "dtcc-consolidated-findings",
    aggregation_policy: "last-valid-opinion-v1",
    source_sha256: baseline.source_sha256,
    baseline_sha256: review?.baseline_sha256 ?? null,
    findings,
    summary: {
      total_findings: findings.length,
      high: findings.filter((finding) => finding.proposed_severity === "HIGH")
        .length,
      medium: findings.filter(
        (finding) => finding.proposed_severity === "MEDIUM",
      ).length,
      low: findings.filter((finding) => finding.proposed_severity === "LOW")
        .length,
      unrated: findings.filter((finding) => finding.proposed_severity === null)
        .length,
      requires_review: findings.filter((finding) => finding.requires_review)
        .length,
      supported: findings.filter((finding) => finding.outcome === "supported")
        .length,
      not_supported: findings.filter(
        (finding) => finding.outcome === "not_supported",
      ).length,
      unresolved: findings.filter((finding) => finding.outcome === "unresolved")
        .length,
      first_round_completed: baseline.models.filter(
        (model) => model.status === "succeeded",
      ).length,
      second_round_assigned: review?.plan.model_ids.length ?? 0,
      second_round_completed:
        review?.models.filter((model) => model.status === "succeeded").length ??
        0,
      retained_after_failed_review: findings.filter(
        (finding) => finding.retained_after_failed_review_models.length > 0,
      ).length,
    },
    interpretation:
      "One record per first-round claim. The latest accepted judgment is shown: a valid second-round decision replaces that model's earlier opinion; a failed reassessment retains its original finding and severity when available, with the unfinished reassessment marked separately. Retained opinions are not fresh second-round confirmations. First-round discovery and second-round evidence remain unchanged. Agreement is not an accuracy probability; no finding or counterjudgment certifies contract safety. Claims missed by every first-round model are outside this report.",
  };
}
