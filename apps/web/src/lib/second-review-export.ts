import type { AuditReport } from "@/generated/report";
import { councilMarkdown } from "@/lib/council-export";
import type { CouncilReport } from "@/lib/orchestration";
import type { SecondReviewReport } from "@/lib/second-review";

const interpretation =
  "The first round remains an independent three-model review. Second-round models saw peer assessments; their responses are not additional independent votes and do not change first-round agreement. Supported and not_supported are peer-informed judgments, not proof of a vulnerability or proof of absence. Missing, uncertain, conflicting and deferred assessments remain unresolved. Token counts cover returned successful attempts only; failed or cancelled requests may incur unreported usage.";
const literal = (value: string) =>
  value.replace(/[\\`*_{}[\]()#+.!<>|]/g, "\\$&");
function fence(value: string, language: string) {
  const marks = "`".repeat(
    Math.max(3, ...(value.match(/`+/g) ?? []).map((part) => part.length + 1)),
  );
  return `${marks}${language}\n${value}\n${marks}`;
}
function verifySource(
  baseline: CouncilReport,
  review: SecondReviewReport,
  staticReport?: AuditReport,
) {
  if (
    baseline.source_sha256 !== review.source_sha256 ||
    (staticReport && staticReport.source_sha256 !== baseline.source_sha256)
  )
    throw new Error("Exported reviews must refer to the same source.");
}

export function secondReviewMarkdown(
  baseline: CouncilReport,
  review: SecondReviewReport,
  staticReport?: AuditReport,
) {
  verifySource(baseline, review, staticReport);
  const labels = (ids: string[]) =>
    ids
      .map((id) =>
        literal(baseline.models.find((model) => model.model_id === id)!.label),
      )
      .join(", ") || "None";
  return [
    "# DTCC — Bounded second review",
    `Source SHA-256: ${review.source_sha256}\nFirst-round SHA-256: ${review.baseline_sha256}\nCreated: ${review.created_at}\nStatus: ${review.status}\nElapsed: ${review.elapsed_ms} ms\nPolicy: ${review.policy_version}\nPrompt: ${review.prompt_version}`,
    interpretation,
    "## Review scope and resource limits",
    `Rounds used: ${review.rounds_used} / 1\nSelected candidates: ${review.plan.candidate_ids.length} / 12\nDeferred candidates: ${review.plan.deferred_ids.length}\nAssigned models: ${labels(review.plan.model_ids)}\nProvider requests made: ${review.execution.total_attempts} / 6 maximum\nAttempts per model: at most ${review.execution.max_attempts_per_model}\nModel deadline: ${review.execution.model_timeout_ms} ms across all attempts\nOverall deadline: ${review.execution.overall_timeout_ms} ms\nSkipped reason: ${review.plan.skipped_reason ?? "none"}`,
    "This round only reassesses selected first-round claims. It does not search for new findings, recover failed first-round models or establish that omitted vulnerabilities do not exist. The baseline hash binds these results to the exact first-round report; it is not a provider signature or an authenticity attestation.",
    "## Peer-informed outcomes",
    ...review.findings.map((finding) => {
      const original = baseline.findings.find(
        (item) => item.id === finding.finding_id,
      )!;
      return [
        `### ${finding.finding_id} · ${literal(original.title)}`,
        `First-round agreement: ${original.agreement}/3 (${original.confidence}) — unchanged\nSecond-round outcome: ${finding.status}\nDeferred: ${finding.deferred ? "yes" : "no"}\nHighest second-round supported severity: ${finding.proposed_severity ?? "none"}\nSeverity disagreement: ${finding.severity_disagreement ? "yes" : "no"}`,
        `Supported: ${labels(finding.supporting_models)}\nNot supported: ${labels(finding.not_supported_models)}\nUncertain: ${labels(finding.uncertain_models)}\nMissing assessment: ${labels(finding.missing_models)}`,
        ...review.models.flatMap((model) => {
          const assessment = model.review?.assessments.find(
            (item) => item.finding_id === finding.finding_id,
          );
          return assessment
            ? [
                `**${literal(model.label)} · ${assessment.verdict} · ${assessment.proposed_severity ?? "no severity assigned"}**\n\n${literal(assessment.rationale)}\n\nLines ${assessment.evidence.line_start}–${assessment.evidence.line_end}\n\n${fence(assessment.evidence.excerpt, "solidity")}`,
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
    staticReport
      ? councilMarkdown(staticReport, baseline)
      : fence(JSON.stringify(baseline, null, 2), "json"),
  ].join("\n\n");
}

export function downloadSecondReviewReport(
  baseline: CouncilReport,
  review: SecondReviewReport,
  format: "json" | "md",
  staticReport?: AuditReport,
) {
  verifySource(baseline, review, staticReport);
  const content =
    format === "md"
      ? secondReviewMarkdown(baseline, review, staticReport)
      : JSON.stringify(
          {
            schema_version: "1.0.0",
            kind: "dtcc-second-review",
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
  anchor.download = `dtcc-second-review-${review.baseline_sha256.slice(0, 12)}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
