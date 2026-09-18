import type { AuditReport } from "@/generated/report";
import type { EnhancedReport, ModelReview } from "@/generated/review";
import reviewSchema from "@/generated/review.schema.json";
import { sha256, sourceLines } from "@/lib/static-analysis";
import Ajv from "ajv";
import schema from "@/generated/report.schema.json";

const validateReviewSchema = new Ajv({ strict: false }).compile<EnhancedReport>(
  reviewSchema,
);
const validateModelSchema = new Ajv({ strict: false }).compile<ModelReview>({
  $defs: reviewSchema.$defs,
  $ref: "#/$defs/ModelReview",
});
const literal = (value: string) =>
  value.replace(/[\\`*_{}[\]()#+.!<>|]/g, "\\$&");

const validateSchema = new Ajv({ strict: false }).compile<AuditReport>(schema);

function fenced(value: string, language = "") {
  const runs = value.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return `${fence}${language}\n${value}\n${fence}`;
}

export function markdownReport(
  report: AuditReport,
  review?: ModelReview | null,
): string {
  return [
    "# DTCC — Smart Contract Analysis",
    "Findings are candidates for review, not confirmed vulnerabilities.",
    `Run: ${report.run_id}\nCreated: ${report.created_at}\nExecution: ${report.execution}\nEngine: ${report.engine}@${report.engine_version}\nSchema: ${report.schema_version}\nSource SHA-256: ${report.source_sha256}`,
    `## Source: ${report.input.filename}\n\n${fenced(report.input.source, "solidity")}`,
    `## Candidates (${report.candidates.length})`,
    ...(report.candidates.length
      ? report.candidates.map((item) =>
          [
            `### ${item.rule_id} · ${item.title}`,
            `Proposed severity: ${item.proposed_severity} | Status: ${item.disposition}\nID: ${item.id}`,
            `Lines ${item.evidence.line_start}–${item.evidence.line_end} · ${item.evidence.validation}\n\n${fenced(item.evidence.excerpt, "solidity")}`,
            item.rationale,
            `Review guidance: ${item.recommendation}`,
          ].join("\n\n"),
        )
      : ["No candidates flagged. This does not mean the contract is safe."]),
    "## Execution stages",
    ...report.stages.map((stage) => `- ${stage.name}: ${stage.status}`),
    ...(review
      ? [
          "## Bedrock review",
          `Model: ${literal(review.model_id)} | Region: ${review.region} | Protocol: ${review.protocol}`,
          `Created: ${review.created_at} | Elapsed: ${review.elapsed_ms} ms`,
          `Tokens: ${review.input_tokens ?? "unavailable"} input / ${review.output_tokens ?? "unavailable"} output`,
          literal(review.summary),
          ...review.findings.map((item, index) =>
            [
              `### AI-${index + 1} · ${literal(item.title)}`,
              `Proposed severity: ${item.proposed_severity}`,
              `Lines ${item.evidence.line_start}–${item.evidence.line_end}\n\n${fenced(item.evidence.excerpt, "solidity")}`,
              literal(item.rationale),
              `Review guidance: ${literal(item.recommendation)}`,
            ].join("\n\n"),
          ),
        ]
      : []),
    "## Static-stage limitations",
    ...report.limitations.map((limitation) => `- ${limitation}`),
  ].join("\n\n");
}

export function downloadReport(
  report: AuditReport,
  format: "json" | "md",
  review?: ModelReview | null,
) {
  const contents =
    format === "json"
      ? JSON.stringify(
          review
            ? {
                schema_version: "1.0.0",
                static_report: report,
                model_review: review,
              }
            : report,
          null,
          2,
        )
      : markdownReport(report, review);
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

export async function validateResponse(
  value: unknown,
  filename: string,
  source: string,
  execution: "local" | "browser" = "local",
): Promise<AuditReport> {
  // Generated schema validates shape; binding checks protect against stale or corrupt responses.
  if (!validateSchema(value)) throw new Error("Invalid report response.");
  const report = value;
  const hash = await sha256(source);
  if (
    report.schema_version !== "1.0.0" ||
    report.engine !==
      (execution === "browser"
        ? "browser-static-rules"
        : "legacy-static-rules") ||
    report.engine_version !== "0.1.0" ||
    report.mode !== "static" ||
    report.execution !== execution ||
    report.input?.source !== source ||
    report.input?.filename !== filename ||
    report.source_sha256 !== hash ||
    !Array.isArray(report.candidates) ||
    !Array.isArray(report.stages) ||
    !Array.isArray(report.limitations)
  ) {
    throw new Error(
      "Report does not match this source or application version.",
    );
  }
  if (
    !/^[a-f0-9-]{36}$/.test(report.run_id) ||
    !Number.isFinite(Date.parse(report.created_at))
  )
    throw new Error("Invalid report provenance.");
  const lines = sourceLines(source);
  const ids = new Set<string>();
  for (const item of report.candidates) {
    const span = item.evidence;
    const identity = `${report.engine}@${report.engine_version}|${hash}|${item.rule_id}|${span.line_start}`;
    const idDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(identity),
    );
    const expectedId = Array.from(new Uint8Array(idDigest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    )
      .join("")
      .slice(0, 24);
    if (
      item.origin !== report.engine ||
      span.line_start > span.line_end ||
      span.line_end > lines.length ||
      lines.slice(span.line_start - 1, span.line_end).join("\n") !==
        span.excerpt ||
      item.id !== expectedId ||
      ids.has(item.id)
    ) {
      throw new Error("Report evidence does not match the source snapshot.");
    }
    ids.add(item.id);
  }
  return report;
}

export async function validateEnhanced(
  value: unknown,
  filename: string,
  source: string,
  execution: "local" | "browser" = "local",
): Promise<EnhancedReport> {
  if (!validateReviewSchema(value))
    throw new Error("Invalid Bedrock report response.");
  await validateResponse(value.static_report, filename, source, execution);
  await validateModelReview(value.model_review, source);
  return value;
}

export async function validateModelReview(
  value: unknown,
  source: string,
): Promise<ModelReview> {
  if (!validateModelSchema(value))
    throw new Error("Invalid Bedrock report response.");
  const review = value;
  if (
    review.source_sha256 !== (await sha256(source)) ||
    !Number.isFinite(Date.parse(review.created_at))
  )
    throw new Error("Bedrock review does not match this source.");
  const lines = sourceLines(source),
    seen = new Set<string>();
  for (const item of review.findings) {
    const span = item.evidence,
      identity = `${item.title.toLowerCase()}|${span.line_start}|${span.line_end}`;
    if (
      span.line_start > span.line_end ||
      span.line_end > lines.length ||
      span.line_end - span.line_start >= 12 ||
      lines.slice(span.line_start - 1, span.line_end).join("\n") !==
        span.excerpt ||
      seen.has(identity)
    )
      throw new Error("Bedrock evidence does not match the source snapshot.");
    seen.add(identity);
  }
  return value;
}
