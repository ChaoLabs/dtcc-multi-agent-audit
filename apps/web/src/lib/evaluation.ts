import cases from "@/generated/cases.json";
import { validateApiKey } from "@/lib/bedrock-config";
import { validateCouncil, type CouncilReport } from "@/lib/orchestration";
import { PROMPT_VERSION, type PromptVariant } from "@/lib/review-policy";
import {
  buildSecondReviewPlan,
  buildSecondReviewReport,
  type SecondReviewReport,
} from "@/lib/second-review";
import {
  requestSecondReview,
  SecondReviewRequestError,
} from "@/lib/second-review-client";

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
  second_review: SecondReviewReport | null;
  second_review_status:
    | "not_requested"
    | "pending"
    | "running"
    | "completed"
    | "partial"
    | "skipped"
    | "failed"
    | "cancelled";
  second_review_error: string | null;
};
export type EvaluationReport = {
  schema_version: "1.1.0";
  review_mode: "independent" | "paired-second-review";
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
    second_review: {
      completed_cases: number;
      partial_cases: number;
      failed_cases: number;
      skipped_cases: number;
      successful_model_reviews: number;
      planned_model_reviews: number;
      observed_attempts: number;
      new_supports: number;
      withdrawn_supports: number;
      uncertain_after_support: number;
      unresolved_candidates: number;
      deferred_candidates: number;
      input_tokens: number | null;
      output_tokens: number | null;
    };
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
  const second = results.flatMap((entry) =>
    entry.second_review ? [entry.second_review] : [],
  );
  const secondRuns = second.flatMap((entry) => entry.models);
  const secondReviews = secondRuns.flatMap((run) =>
    run.review ? [run.review] : [],
  );
  const secondTokens = (field: "input_tokens" | "output_tokens") =>
    secondReviews.length &&
    secondReviews.every((review) => review[field] !== null)
      ? secondReviews.reduce((sum, review) => sum + (review[field] ?? 0), 0)
      : null;
  let newSupports = 0,
    withdrawn = 0,
    uncertain = 0;
  for (const entry of results) {
    if (!entry.report || !entry.second_review) continue;
    for (const run of entry.second_review.models) {
      for (const assessment of run.review?.assessments ?? []) {
        const original = entry.report.findings.find(
          (finding) => finding.id === assessment.finding_id,
        );
        const supported =
          original?.supporting_models.includes(run.model_id) ?? false;
        if (!supported && assessment.verdict === "supported") newSupports++;
        if (supported && assessment.verdict === "not_supported") withdrawn++;
        if (supported && assessment.verdict === "uncertain") uncertain++;
      }
    }
  }
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
    second_review: {
      completed_cases: second.filter((report) => report.status === "completed")
        .length,
      partial_cases: second.filter((report) => report.status === "partial")
        .length,
      failed_cases: results.filter(
        (entry) => entry.second_review_status === "failed",
      ).length,
      skipped_cases: results.filter(
        (entry) => entry.second_review_status === "skipped",
      ).length,
      successful_model_reviews: secondReviews.length,
      planned_model_reviews: results.reduce(
        (sum, entry) =>
          sum +
          (entry.report &&
          entry.second_review_status !== "not_requested" &&
          entry.second_review_status !== "pending"
            ? buildSecondReviewPlan(entry.report).model_ids.length
            : 0),
        0,
      ),
      observed_attempts: secondRuns.reduce(
        (sum, run) => sum + run.attempts.length,
        0,
      ),
      new_supports: newSupports,
      withdrawn_supports: withdrawn,
      uncertain_after_support: uncertain,
      unresolved_candidates: results.reduce(
        (sum, entry) =>
          sum +
          (entry.second_review
            ? entry.second_review.findings.filter(
                (finding) => finding.status === "unresolved",
              ).length
            : entry.second_review_status !== "not_requested"
              ? (entry.report?.review_queue?.length ?? 0)
              : 0),
        0,
      ),
      deferred_candidates: second.reduce(
        (sum, report) => sum + report.plan.deferred_ids.length,
        0,
      ),
      input_tokens: secondTokens("input_tokens"),
      output_tokens: secondTokens("output_tokens"),
    },
  };
}

/** One explicit experiment = five sequential requests, never an outer retry.
 * Each request invokes at most six provider attempts under the server policy.
 * Credentials never enter progress snapshots or the returned export.
 */
export async function runEvaluation({
  apiKey,
  promptVariant,
  includeSecondReview = false,
  signal,
  onProgress,
  transport = fetch,
}: {
  apiKey: string;
  promptVariant: PromptVariant;
  includeSecondReview?: boolean;
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
  if (typeof includeSecondReview !== "boolean")
    throw new Error("Choose a supported review mode.");
  const timer = setTimeout(
    () => deadline.abort(),
    (includeSecondReview ? 40 : 20) * 60_000,
  );
  const batchSignal = AbortSignal.any([signal, deadline.signal]);
  const result: EvaluationReport = {
    schema_version: "1.1.0",
    review_mode: includeSecondReview ? "paired-second-review" : "independent",
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
      second_review: null,
      second_review_status: includeSecondReview ? "pending" : "not_requested",
      second_review_error: null,
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
      }
      // The second round uses this exact accepted first-pass snapshot. It never
      // repeats the first round to manufacture a comparison, nor rewrites it.
      if (
        includeSecondReview &&
        entry.report &&
        !stop &&
        !batchSignal.aborted
      ) {
        entry.second_review_status = "running";
        onProgress?.(snapshot());
        try {
          const plan = buildSecondReviewPlan(entry.report);
          const second = plan.skipped_reason
            ? await buildSecondReviewReport([], fixture.source, entry.report, 0)
            : await requestSecondReview({
                apiKey: key,
                filename: fixture.filename,
                source: fixture.source,
                baseline: entry.report,
                signal: batchSignal,
                transport,
              });
          batchSignal.throwIfAborted();
          entry.second_review = second;
          entry.second_review_status = second.status;
          stop = second.models.some(
            (run) =>
              run.error &&
              ["bedrock_access", "bedrock_rate_limit"].includes(run.error.code),
          );
          if (stop)
            entry.second_review_error =
              "A second-round model reported an access or rate limit error. Remaining cases were not started.";
          else if (second.status === "failed")
            entry.second_review_error =
              "No model completed the second review. The independent review is retained.";
        } catch (error) {
          entry.second_review_status = batchSignal.aborted
            ? "cancelled"
            : "failed";
          entry.second_review_error = batchSignal.aborted
            ? "Second review cancelled; the independent review is retained."
            : error instanceof SecondReviewRequestError
              ? error.message
              : "Second review could not be validated; the independent review is retained.";
          if (
            error instanceof SecondReviewRequestError &&
            [401, 403, 429].includes(error.status ?? 0)
          )
            stop = true;
        }
      }
      if (includeSecondReview && entry.second_review_status === "pending") {
        entry.second_review_status = batchSignal.aborted
          ? "cancelled"
          : "skipped";
        entry.second_review_error = batchSignal.aborted
          ? "Second review was not started because validation stopped."
          : entry.report
            ? "Second review was not started after an access or rate limit failure."
            : "Second review requires a validated independent report.";
      }
      entry.elapsed_ms = Math.round(performance.now() - caseStart);
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
            "Fixed five-contract regression set, not an accuracy benchmark. Paired mode preserves each exact independent review and adds at most one peer-informed second round. New or withdrawn support measures opinion changes, not accuracy. Independent agreement never changes. Tokens cover returned successful reviews only; failed attempts and cancelled requests may incur unreported usage. Observed attempts omit requests with no validated report. Compare modes and prompt variants using repeated runs and human-reviewed findings, including missed issues and false positives.",
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
  link.download = `dtcc-validation-${report.review_mode}-${report.prompt_variant}-${report.created_at.replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
