import type { AuditReport } from "@/generated/report";
import { councilMarkdown } from "@/lib/council-export";
import {
  firstReviewEvidenceMethod,
  type CouncilReport,
} from "@/lib/orchestration";
import {
  canonicalReviewJson,
  secondReviewEvidenceMethod,
  secondReviewReasoningEffort,
  type SecondReviewReport,
} from "@/lib/second-review";
import {
  buildFinalReviewReport,
  currentModelSeverities,
  findingHeadline,
  oppositionNotice,
} from "@/lib/final-report";
import { sha256 } from "@/lib/static-analysis";

const interpretation =
  "The first round remains an independent three-model review. Second-round models saw peer assessments; their responses are not additional independent votes and do not change first-round agreement. The final view uses each model's latest accepted judgment and retains original findings when an assigned reassessment fails. Retained opinions are not fresh confirmations, and pending reassessments still require review. The original second-round outcome record below retains its own policy and counts; it is not rewritten to match the final view. Supported and not_supported are model judgments, not proof of a vulnerability or proof of absence. Token counts cover returned successful attempts only; failed or cancelled requests may incur unreported usage.";
const literal = (value: string) =>
  value.replace(/[\\`*_{}[\]()#+.!<>|]/g, "\\$&");
function fence(value: string, language: string) {
  const marks = "`".repeat(
    Math.max(3, ...(value.match(/`+/g) ?? []).map((part) => part.length + 1)),
  );
  return `${marks}${language}\n${value}\n${marks}`;
}
async function verifySource(
  baseline: CouncilReport,
  review: SecondReviewReport,
  staticReport?: AuditReport,
) {
  if (
    baseline.source_sha256 !== review.source_sha256 ||
    review.baseline_sha256 !== (await sha256(canonicalReviewJson(baseline))) ||
    (staticReport && staticReport.source_sha256 !== baseline.source_sha256)
  )
    throw new Error(
      "Exported reviews must refer to the exact same baseline and source.",
    );
}

export async function secondReviewMarkdown(
  baseline: CouncilReport,
  review: SecondReviewReport,
  staticReport?: AuditReport,
) {
  await verifySource(baseline, review, staticReport);
  const labels = (ids: string[]) =>
    ids
      .map((id) =>
        literal(baseline.models.find((model) => model.model_id === id)!.label),
      )
      .join(", ") || "None";
  return [
    "# DTCC — Risk report",
    consolidatedMarkdown(baseline, review),
    "## Bounded second review",
    `Source SHA-256: ${review.source_sha256}\nFirst-round SHA-256: ${review.baseline_sha256}\nCreated: ${review.created_at}\nStatus: ${review.status}\nElapsed: ${review.elapsed_ms} ms\nPolicy: ${review.policy_version}\nPrompt: ${review.prompt_version}`,
    interpretation,
    "## Review scope and resource limits",
    `Rounds used: ${review.rounds_used} / 1\nSelected candidates: ${review.plan.candidate_ids.length} / 12\nDeferred candidates: ${review.plan.deferred_ids.length}\nAssigned models: ${labels(review.plan.model_ids)}\nProvider requests made: ${review.execution.total_attempts} / ${review.execution.max_attempts_per_model * review.plan.model_ids.length} maximum\nAttempts per model: at most ${review.execution.max_attempts_per_model}\nModel deadline: ${review.execution.model_timeout_ms} ms across all attempts\nOverall deadline: ${review.execution.overall_timeout_ms} ms\nSkipped reason: ${review.plan.skipped_reason ?? "none"}`,
    ...(review.plan.assignments ?? []).map(
      (assignment) =>
        `Assigned to ${labels([assignment.model_id])}: ${assignment.candidate_ids.join(", ")}`,
    ),
    ...(review.plan.unassigned_model_ids
      ? [
          `Successful first-round models without an assigned task: ${labels(review.plan.unassigned_model_ids)}`,
        ]
      : []),
    "This round only reassesses selected first-round claims. It does not search for new findings, recover failed first-round models or establish that omitted vulnerabilities do not exist. The baseline hash binds these results to the exact first-round report; it is not a provider signature or an authenticity attestation.",
    "## Original second-round outcome record",
    "The following counts reproduce the accepted second-round record without modification. Latest available evidence, retained first-round opinions and pending reassessments are shown in the final findings above.",
    ...review.findings.map((finding) => {
      const original = baseline.findings.find(
        (item) => item.id === finding.finding_id,
      )!;
      return [
        `### ${finding.finding_id} · ${literal(original.title)}`,
        `First-round agreement: ${original.agreement}/3 (${original.confidence}) — unchanged\nRecorded second-round outcome: ${finding.status}\nDeferred: ${finding.deferred ? "yes" : "no"}\nRecorded supported severity: ${finding.proposed_severity ?? "none"}\nRecorded severity disagreement: ${finding.severity_disagreement ? "yes" : "no"}`,
        `Recorded support: ${labels(finding.supporting_models)}\nRecorded non-support: ${labels(finding.not_supported_models)}\nRecorded uncertainty: ${labels(finding.uncertain_models)}\nMissing assessment in this round: ${labels(finding.missing_models)}`,
        ...review.models.flatMap((model) => {
          const assessment = model.review?.assessments.find(
            (item) => item.finding_id === finding.finding_id,
          );
          return assessment
            ? [
                `**${literal(model.label)} · ${assessment.verdict} · ${assessment.proposed_severity ?? "no severity assigned"}**\n\n${literal(assessment.rationale)}\n\nLines ${assessment.evidence.line_start}–${assessment.evidence.line_end}\n\n${secondReviewEvidenceMethod(review, model.model_id)}\n\n${fence(assessment.evidence.excerpt, "solidity")}`,
              ]
            : [];
        }),
      ].join("\n\n");
    }),
    ...(review.findings.length
      ? []
      : ["No first-round disagreements were selected for reassessment."]),
    "## Second-round execution record",
    ...review.models.map((model) =>
      [
        `### ${literal(model.label)}`,
        `Model: ${literal(model.model_id)}\nStatus: ${model.status}\nElapsed: ${model.elapsed_ms} ms`,
        `Reasoning effort: ${secondReviewReasoningEffort(review, model.model_id)}`,
        ...model.attempts.map(
          (attempt) =>
            `Attempt ${attempt.attempt}: ${attempt.status} | Duration: ${attempt.elapsed_ms} ms | Scheduled delay before request: ${attempt.retry_delay_ms} ms | Error: ${attempt.error_code ?? "none"}`,
        ),
        model.review
          ? `Reported tokens: ${model.review.input_tokens ?? "unavailable"} input / ${model.review.output_tokens ?? "unavailable"} output\n\n${literal(model.review.summary)}`
          : literal(
              model.error?.detail ?? "No validated reassessment available.",
            ),
      ].join("\n\n"),
    ),
    "## Original first-round report — unchanged",
    `Evidence method: ${firstReviewEvidenceMethod(baseline)}`,
    staticReport
      ? councilMarkdown(staticReport, baseline)
      : fence(JSON.stringify(baseline, null, 2), "json"),
  ].join("\n\n");
}

export async function downloadSecondReviewReport(
  baseline: CouncilReport,
  review: SecondReviewReport,
  format: "json" | "md",
  staticReport?: AuditReport,
) {
  await verifySource(baseline, review, staticReport);
  const content =
    format === "md"
      ? await secondReviewMarkdown(baseline, review, staticReport)
      : JSON.stringify(
          {
            schema_version: "1.2.0",
            kind: "dtcc-consolidated-review",
            final_report: buildFinalReviewReport(baseline, review),
            ...(staticReport ? { static_report: staticReport } : {}),
            first_round: baseline,
            second_round: review,
            interpretation,
          },
          null,
          2,
        );
  const url = URL.createObjectURL(
    new Blob([content], {
      type:
        format === "json" ? "application/json" : "text/markdown;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dtcc-consolidated-review-${review.baseline_sha256.slice(0, 12)}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function consolidatedMarkdown(
  baseline: CouncilReport,
  review?: SecondReviewReport | null,
) {
  const final = buildFinalReviewReport(baseline, review);
  const labels = (ids: string[]) =>
    ids
      .map((id) =>
        literal(baseline.models.find((model) => model.model_id === id)!.label),
      )
      .join(", ") || "None";
  return [
    "## Risk overview",
    `Findings: ${final.summary.total_findings}\nProposed severity: ${final.summary.high} high · ${final.summary.medium} medium · ${final.summary.low} low · ${final.summary.unrated} without a current supported severity\nRequiring review: ${final.summary.requires_review}\nIndependent analysis: ${final.summary.first_round_completed}/3 models completed\nSecond Review: ${review ? (review.status === "skipped" ? "Not required or no eligible assignments" : `${final.summary.second_round_completed}/${final.summary.second_round_assigned} assigned models completed`) : "Not run"}`,
    ...(final.summary.retained_after_failed_review
      ? [
          `${final.summary.retained_after_failed_review} finding(s) retain original evidence because an assigned reassessment did not complete. This preserves earlier evidence; it does not count as a successful second review.`,
        ]
      : []),
    "## Findings and recommended actions",
    ...final.findings.map((finding, index) =>
      [
        `### ${index + 1}. ${literal(findingHeadline(finding))}`,
        ...(oppositionNotice(finding)
          ? [`**Judgment:** ${oppositionNotice(finding)}`]
          : []),
        `Proposed severity: ${finding.proposed_severity ?? "No current supported severity"}${finding.severity_disagreement ? " — disputed" : ""}\nReview required: ${finding.requires_review ? "yes" : "no additional model disagreement; human validation remains necessary"}\nLatest available support: ${finding.supporting_models.length}/3 models\nIndependent discovery: ${finding.first_round_agreement}/3 models — unchanged`,
        `**Original finding and potential impact**\n\n${literal(finding.rationale)}`,
        ...(finding.not_supported_models.length
          ? [
              "**Reasons given for non-support**",
              ...finding.judgments
                .filter(
                  (item) =>
                    item.effective_verdict === "not_supported" &&
                    item.rationale,
                )
                .map(
                  (item) =>
                    `- **${literal(item.label)}:** ${literal(item.rationale!)}`,
                ),
            ]
          : []),
        `**${finding.not_supported_models.length || !finding.supporting_models.length ? "Original recommendation — evaluate before acting" : "Proposed recommendation"}**\n\n${literal(finding.recommendation)}`,
        `**Next review action**\n\n${finding.next_action}`,
        ...(finding.pending_reassessment_models.length
          ? [
              `Pending reassessment: ${labels(finding.pending_reassessment_models)}\nOriginal opinion retained: ${labels(finding.retained_after_failed_review_models)}. Retained support is not a new second-round confirmation.`,
            ]
          : []),
        [
          "| Model | First round | Second round | Effective judgment | Opinion source | Proposed severity |",
          "| --- | --- | --- | --- | --- | --- |",
          ...finding.judgments.map((item) => {
            const severities = currentModelSeverities(
              baseline,
              finding.id,
              item,
            );
            const severity = severities.length
              ? `${severities.join(" / ")}${severities.length > 1 ? " (original ratings differ)" : ""}`
              : "Not rated";
            return `| ${literal(item.label)} | ${item.first_round} | ${item.second_round} | ${item.effective_verdict} | ${item.opinion_source} | ${severity} |`;
          }),
        ].join("\n"),
        `Source evidence: lines ${finding.evidence.line_start}–${finding.evidence.line_end}\nFinding ID: ${finding.id}`,
        fence(finding.evidence.excerpt, "solidity"),
      ].join("\n\n"),
    ),
    ...(final.findings.length
      ? []
      : [
          "No first-round claims were retained. This is not evidence that the contract is safe.",
        ]),
    "## Method and interpretation",
    `Final report schema: ${final.schema_version}\nAggregation policy: ${final.aggregation_policy}\nSource SHA-256: ${final.source_sha256}`,
    final.interpretation,
  ].join("\n\n");
}

/** Export the same consolidated view before or after peer review. */
export async function downloadFinalReviewReport(
  baseline: CouncilReport,
  review: SecondReviewReport | null,
  format: "json" | "md",
  staticReport?: AuditReport,
) {
  if (review)
    return downloadSecondReviewReport(baseline, review, format, staticReport);
  if (staticReport && staticReport.source_sha256 !== baseline.source_sha256)
    throw new Error("Exported reports must refer to the same source.");
  const final = buildFinalReviewReport(baseline);
  const content =
    format === "json"
      ? JSON.stringify(
          {
            schema_version: "1.2.0",
            kind: "dtcc-consolidated-review",
            final_report: final,
            first_round: baseline,
            second_round: null,
            ...(staticReport ? { static_report: staticReport } : {}),
          },
          null,
          2,
        )
      : [
          "# DTCC — Risk report",
          consolidatedMarkdown(baseline),
          "## Original first-round report — unchanged",
          staticReport
            ? councilMarkdown(staticReport, baseline)
            : fence(JSON.stringify(baseline, null, 2), "json"),
        ].join("\n\n");
  const url = URL.createObjectURL(
    new Blob([content], {
      type:
        format === "json" ? "application/json" : "text/markdown;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dtcc-consolidated-review-${baseline.source_sha256.slice(0, 12)}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
