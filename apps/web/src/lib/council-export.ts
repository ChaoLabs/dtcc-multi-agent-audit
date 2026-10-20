import type { AuditReport } from "@/generated/report";
import type { CouncilReport } from "@/lib/orchestration";
import { markdownReport } from "@/lib/report";

const literal = (value: string) =>
  value.replace(/[\\`*_{}[\]()#+.!<>|]/g, "\\$&");
function fence(value: string) {
  const marks = "`".repeat(
    Math.max(3, ...(value.match(/`+/g) ?? []).map((s) => s.length + 1)),
  );
  return `${marks}solidity\n${value}\n${marks}`;
}
export function councilMarkdown(report: AuditReport, council: CouncilReport) {
  return [
    "# DTCC — Multi-model contract review",
    `Run: ${report.run_id}\nSource SHA-256: ${council.source_sha256}\nCreated: ${council.created_at}\nStatus: ${council.status}\nOrchestrator: ${council.engine} / ${council.schema_version}\nElapsed: ${council.elapsed_ms} ms`,
    "Confidence describes model agreement, not the probability that a vulnerability is real. One, two and three supporting models mean LOW, MEDIUM and HIGH confidence. Static rules do not vote. Missing model results are failures, not negative findings.",
    "## Model coverage",
    ...council.models.map((model) =>
      [
        `### ${literal(model.label)}`,
        `Model: ${literal(model.model_id)} | Status: ${model.status} | Elapsed: ${model.elapsed_ms} ms`,
        model.review
          ? `Tokens: ${model.review.input_tokens ?? "unavailable"} input / ${model.review.output_tokens ?? "unavailable"} output\n\n${literal(model.review.summary)}`
          : literal(model.error?.detail ?? "No validated review available."),
      ].join("\n\n"),
    ),
    `## Consolidated findings (${council.findings.length})`,
    ...(council.findings.length
      ? council.findings.map((finding) =>
          [
            `### ${finding.id} · ${literal(finding.title)}`,
            `Severity: ${finding.proposed_severity} | Confidence: ${finding.confidence} | Agreement: ${finding.agreement}/3 | Severity disagreement: ${finding.severity_disagreement ? "yes" : "no"}`,
            `Category: ${literal(finding.category)}\nSupporting models: ${finding.supporting_models.map(literal).join(", ")}`,
            `Lines ${finding.evidence.line_start}–${finding.evidence.line_end}\n\n${fence(finding.evidence.excerpt)}`,
            literal(finding.rationale),
            `Recommended action: ${literal(finding.recommendation)}`,
            "#### Model contributions",
            ...finding.members.map((member) => {
              const model = council.models.find(
                (run) => run.model_id === member.model_id,
              )!;
              const item = model.review!.findings[member.finding_index];
              return `**${literal(model.label)} · finding ${member.finding_index + 1} · ${item.proposed_severity}**\n\n${literal(item.title)}\n\n${literal(item.rationale)}\n\nRecommendation: ${literal(item.recommendation)}\n\n${fence(item.evidence.excerpt)}`;
            }),
          ].join("\n\n"),
        )
      : [
          council.status === "failed"
            ? "No validated model reviews are available. Analysis failed."
            : "No model candidates were retained. This does not establish contract safety.",
        ]),
    "## Independent static baseline",
    markdownReport(report),
  ].join("\n\n");
}
export function downloadCouncilReport(
  report: AuditReport,
  format: "json" | "md",
  council: CouncilReport,
) {
  const contents =
    format === "json"
      ? JSON.stringify(
          { schema_version: "2.0.0", static_report: report, council },
          null,
          2,
        )
      : councilMarkdown(report, council);
  const url = URL.createObjectURL(
    new Blob([contents], {
      type:
        format === "json" ? "application/json" : "text/markdown;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `audit-${report.run_id}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
