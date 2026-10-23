import cases from "@/generated/cases.json";
import { validateApiKey } from "@/lib/bedrock-config";
import { validateCouncil, type CouncilReport } from "@/lib/orchestration";
import { PROMPT_VERSION, type PromptVariant } from "@/lib/review-policy";

/** This fixed regression set is not an independent accuracy benchmark. */
export const EVALUATION_CASES = Object.freeze(
  cases.map((item) =>
    Object.freeze({
      id: item.id,
      title: item.title,
      filename: item.report.input.filename,
      source: item.report.input.source,
      source_sha256: item.report.source_sha256,
      caveat: item.caveat,
    }),
  ),
);

export type EvaluationCaseResult = {
  id: string;
  title: string;
  filename: string;
  source_sha256: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  report: CouncilReport | null;
  error: string | null;
  elapsed_ms: number;
};
export type EvaluationReport = {
  schema_version: "1.0.0";
  prompt_variant: PromptVariant;
  prompt_version: typeof PROMPT_VERSION;
  created_at: string;
  status: "completed" | "cancelled" | "stopped";
  elapsed_ms: number;
  cases: EvaluationCaseResult[];
  metrics: {
    completed_cases: number;
    fully_reviewed_cases: number;
    partial_cases: number;
    successful_model_reviews: number;
    total_model_slots: 15;
    observed_attempts: number;
    findings: number;
    review_required: number;
    input_tokens: number | null;
    output_tokens: number | null;
  };
};

function metrics(results: EvaluationCaseResult[]): EvaluationReport["metrics"] {
  const reports = results.flatMap((item) => (item.report ? [item.report] : []));
  const runs = reports.flatMap((report) => report.models);
  const reviewed = runs.flatMap((run) => (run.review ? [run.review] : []));
  const tokenTotal = (field: "input_tokens" | "output_tokens") =>
    reviewed.length && reviewed.every((review) => review[field] !== null)
      ? reviewed.reduce((sum, review) => sum + (review[field] ?? 0), 0)
      : null;
  return {
    completed_cases: results.filter((item) => item.status === "completed")
      .length,
    fully_reviewed_cases: reports.filter(
      (report) => report.status === "completed",
    ).length,
    partial_cases: reports.filter((report) => report.status === "partial")
      .length,
    successful_model_reviews: reviewed.length,
    total_model_slots: 15,
    observed_attempts: runs.reduce(
      (sum, run) => sum + (run.attempts?.length ?? 0),
      0,
    ),
    findings: reports.reduce((sum, report) => sum + report.findings.length, 0),
    review_required: reports.reduce(
      (sum, report) => sum + (report.review_queue?.length ?? 0),
      0,
    ),
    input_tokens: tokenTotal("input_tokens"),
    output_tokens: tokenTotal("output_tokens"),
  };
}

/** One explicit experiment = five sequential requests, never an outer retry.
 * Each request invokes at most six provider attempts under the server policy.
 * Credentials never enter progress snapshots or the returned export.
 */
export async function runEvaluation({
  apiKey,
  promptVariant,
  signal,
  onProgress,
  transport = fetch,
}: {
  apiKey: string;
  promptVariant: PromptVariant;
  signal: AbortSignal;
  onProgress?: (report: EvaluationReport) => void;
  transport?: typeof fetch;
}): Promise<EvaluationReport> {
  const key = validateApiKey(apiKey);
  if (promptVariant !== "baseline" && promptVariant !== "few-shot")
    throw new Error("Choose a supported prompt variant.");
  if (EVALUATION_CASES.length !== 5)
    throw new Error("The validation set must contain exactly five contracts.");
  const start = performance.now();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 20 * 60_000);
  const batchSignal = AbortSignal.any([signal, deadline.signal]);
  const result: EvaluationReport = {
    schema_version: "1.0.0",
    prompt_variant: promptVariant,
    prompt_version: PROMPT_VERSION,
    created_at: new Date().toISOString(),
    status: "completed",
    elapsed_ms: 0,
    cases: EVALUATION_CASES.map(({ id, title, filename, source_sha256 }) => ({
      id,
      title,
      filename,
      source_sha256,
      status: "pending",
      report: null,
      error: null,
      elapsed_ms: 0,
    })),
    metrics: metrics([]),
  };
  const snapshot = () => {
    result.elapsed_ms = Math.round(performance.now() - start);
    result.metrics = metrics(result.cases);
    return structuredClone(result);
  };
  try {
    for (const [index, fixture] of EVALUATION_CASES.entries()) {
      if (batchSignal.aborted) {
        result.status = signal.aborted ? "cancelled" : "stopped";
        break;
      }
      const entry = result.cases[index];
      const caseStart = performance.now();
      entry.status = "running";
      onProgress?.(snapshot());
      const controller = new AbortController();
      const caseTimer = setTimeout(() => controller.abort(), 235_000);
      const caseSignal = AbortSignal.any([batchSignal, controller.signal]);
      let stop = false;
      let stopMessage =
        "Access or rate limit stopped validation. Check the connection before another run.";
      try {
        caseSignal.throwIfAborted();
        const response = await transport("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: fixture.filename,
            source: fixture.source,
            api_key: key,
            prompt_variant: promptVariant,
          }),
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: caseSignal,
        });
        caseSignal.throwIfAborted();
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          stop = [401, 403, 429].includes(response.status);
          throw new Error(
            stop
              ? "Access or rate limit stopped validation. Check the connection before starting another run."
              : "This case did not return a valid review. Other cases can continue.",
          );
        }
        const value: unknown = await response.json();
        caseSignal.throwIfAborted();
        const report = await validateCouncil(value, fixture.source);
        caseSignal.throwIfAborted();
        if (
          report.schema_version !== "2.1.0" ||
          !report.execution ||
          report.execution.prompt_variant !== promptVariant
        ) {
          stop = true;
          stopMessage =
            "The deployed review protocol or prompt variant does not match this experiment. Refresh after deploying the updated API.";
          throw new Error(
            "The deployed review protocol does not match this experiment.",
          );
        }
        // A failed provider may reject a credential even though the route returned
        // a valid partial council. Retain that council and avoid four wasted runs.
        stop = report.models.some(
          (run) =>
            run.error &&
            ["bedrock_access", "bedrock_rate_limit"].includes(run.error.code),
        );
        entry.report = report;
        entry.status = report.status === "failed" ? "failed" : "completed";
        if (report.status === "failed")
          entry.error = "No model produced a valid review for this case.";
        if (stop)
          entry.error =
            "A model reported an access or rate limit error. Remaining cases were not started.";
      } catch {
        // Never copy arbitrary provider/network text into an export: it may
        // contain submitted data or credentials. Preserve fixed diagnostics.
        entry.status = batchSignal.aborted ? "cancelled" : "failed";
        entry.error = batchSignal.aborted
          ? "Validation cancelled; completed cases are retained."
          : controller.signal.aborted
            ? "Case time limit reached; no outer retry was made."
            : stop
              ? stopMessage
              : "No valid report was received for this case. Review the connection and retry manually.";
      } finally {
        clearTimeout(caseTimer);
        entry.elapsed_ms = Math.round(performance.now() - caseStart);
      }
      if (batchSignal.aborted)
        result.status = signal.aborted ? "cancelled" : "stopped";
      else if (stop) result.status = "stopped";
      onProgress?.(snapshot());
      if (batchSignal.aborted || stop) break;
    }
    return snapshot();
  } finally {
    clearTimeout(timer);
  }
}

export function downloadEvaluation(report: EvaluationReport) {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          ...report,
          interpretation:
            "Fixed five-contract regression set, not an accuracy benchmark. Tokens cover returned successful reviews only; failed attempts and cancelled requests may incur unreported usage. Observed attempts omit legacy reports without attempt metadata and requests for which no validated council returned. Agreement is not correctness. Compare prompt variants only with human-reviewed findings.",
          case_caveats: EVALUATION_CASES.map(({ id, caveat }) => ({
            id,
            caveat,
          })),
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dtcc-validation-${report.prompt_variant}-${report.created_at.replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
