import { useRef } from "react";
import type { CouncilReport } from "@/lib/orchestration";
import {
  buildSecondReviewPlan,
  secondReviewEvidenceMethod,
  SECOND_REVIEW_POLICY,
  type SecondReviewReport,
} from "@/lib/second-review";
import { BEDROCK_MODELS } from "@/lib/bedrock-config";
import { explainReviewFailure } from "@/lib/review-failure";
import { buildFinalReviewReport } from "@/lib/final-report";
import { Icon } from "./icons";

type Evidence = {
  line_start: number;
  line_end: number;
  excerpt: string;
};
const labels = {
  supported: "Supported",
  not_supported: "Not supported",
  uncertain: "Uncertain",
  unresolved: "Unresolved",
} as const;

export function SecondReviewPanel({
  baseline,
  report,
  busy,
  attempted,
  blocked,
  error,
  onRun,
  onCancel,
  onEvidence,
  onExport,
  onFinalReport,
  onFindings,
  onPrepareRun,
}: {
  baseline: CouncilReport;
  report: SecondReviewReport | null;
  busy: boolean;
  attempted: boolean;
  blocked: boolean;
  error: string;
  onRun: () => void;
  onCancel: () => void;
  onEvidence: (findingId: string, evidence: Evidence) => void;
  onExport: (format: "json" | "md") => void;
  onFinalReport?: () => void;
  onFindings?: () => void;
  onPrepareRun?: () => boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  if (baseline.schema_version !== "2.1.0") return null;
  const plan = report?.plan ?? buildSecondReviewPlan(baseline);
  const initialCompleted = baseline.models.filter(
    (model) => model.status === "succeeded",
  ).length;
  const eligible = !plan.skipped_reason && plan.candidate_ids.length > 0;
  const completed =
    report?.models.filter((model) => model.status === "succeeded").length ?? 0;
  const consolidated = report ? buildFinalReviewReport(baseline, report) : null;
  const resolved =
    consolidated?.findings.filter(
      (finding) =>
        plan.candidate_ids.includes(finding.id) &&
        finding.outcome !== "unresolved" &&
        !finding.severity_disagreement &&
        finding.pending_reassessment_models.length === 0,
    ).length ?? 0;
  const open = () => dialog.current?.showModal();
  const run = () => {
    if (onPrepareRun && !onPrepareRun()) return;
    open();
    onRun();
  };
  const unavailable =
    plan.skipped_reason === "insufficient_reviewers"
      ? "Second Review requires at least two completed independent reviews. First-round findings remain available."
      : "No eligible second-round assignments. Proceed to the Final Report.";

  return (
    <section
      className="second-review-section"
      aria-label="Second Review controls"
    >
      <div className="second-review-strip">
        <div>
          <span className="mini-label">SECOND REVIEW</span>
          <strong>
            {busy
              ? "Evidence reassessment in progress"
              : report
                ? "Second-round judgments"
                : "Reassess disputed findings"}
          </strong>
          <p>
            {busy
              ? "First-round findings remain unchanged while models reassess the evidence."
              : report
                ? `${completed} of ${plan.model_ids.length} assigned models finished · ${resolved} of ${plan.candidate_ids.length} findings have aligned judgments`
                : eligible
                  ? `${plan.candidate_ids.length} findings assigned for reassessment · additional API usage`
                  : unavailable}
          </p>
        </div>
        <button
          className="second-review-button"
          disabled={
            blocked || (!eligible && !report) || (attempted && !busy && !report)
          }
          onClick={report || busy ? open : run}
        >
          {busy && <span className="spinner" />}
          {busy
            ? "View Second Review"
            : report
              ? "View Second Review"
              : attempted
                ? "Second Review attempted"
                : "Run Second Review"}
          <Icon name="arrow" size={14} />
        </button>
      </div>
      {error && (
        <p className="second-review-error" role="alert">
          {error}
        </p>
      )}
      <dialog
        ref={dialog}
        className="modal second-review-modal"
        aria-labelledby="second-review-title"
      >
        <header>
          <div>
            <span className="eyebrow">PEER-INFORMED REASSESSMENT</span>
            <h2 id="second-review-title">Second Review</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close Second Review"
            onClick={() => dialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body second-review-body">
          <p className="second-review-intro">
            Models reassess findings they missed or rated differently. Original
            results remain available.
            {busy && " Closing this window keeps the review running."}
          </p>
          {initialCompleted < 3 && (
            <div className="report-coverage-summary partial" role="status">
              <strong>
                {initialCompleted} of 3 independent reviews completed
              </strong>
              <p>
                Only models with a valid independent result can join this round.
                Second-round completion does not replace missing first-round
                coverage.
              </p>
            </div>
          )}
          <details className="follow-up-limits">
            <summary>
              Execution limits <Icon name="chevron" size={13} />
            </summary>
            <div className="second-review-budget">
              <span>
                <strong>1</strong> additional round
              </span>
              <span>
                <strong>
                  {plan.model_ids.length *
                    (report?.execution.max_attempts_per_model ??
                      SECOND_REVIEW_POLICY.max_attempts_per_model)}
                </strong>{" "}
                calls maximum
              </span>
              <span>
                <strong>
                  {(report?.execution.model_timeout_ms ??
                    SECOND_REVIEW_POLICY.model_timeout_ms) / 1000}
                  s
                </strong>{" "}
                per model
              </span>
              <span>
                <strong>
                  {(report?.execution.overall_timeout_ms ??
                    SECOND_REVIEW_POLICY.overall_timeout_ms) / 1000}
                  s
                </strong>{" "}
                round deadline
              </span>
            </div>
            <p className="second-review-caption">
              Up to{" "}
              {report?.execution.max_attempts_per_model ??
                SECOND_REVIEW_POLICY.max_attempts_per_model}{" "}
              attempts per reviewer, shared by temporary-error recovery and
              format or evidence correction. Time limits never restart.
              Agreement after discussion is not an independent vote or proof of
              correctness.
            </p>
          </details>
          <div className="second-review-status" role="status">
            {busy ? (
              <>
                <span className="spinner" /> Reviewing{" "}
                {plan.candidate_ids.length} findings
              </>
            ) : report ? (
              `${report.status === "completed" ? "Second Review complete" : report.status === "partial" ? "Partial Second Review" : report.status === "skipped" ? "Second Review not required or unavailable" : "Second Review incomplete"} · ${completed} of ${plan.model_ids.length} assigned models completed · ${(report.elapsed_ms / 1000).toFixed(1)}s`
            ) : (
              "Second Review stopped. First-round findings are retained."
            )}
          </div>
          {error && <div className="error">{error}</div>}
          <div
            className="second-review-models"
            aria-label="Second-round model outcomes"
          >
            {BEDROCK_MODELS.map((model) => {
              const result = report?.models.find(
                (entry) => entry.model_id === model.id,
              );
              const assigned = plan.model_ids.includes(model.id);
              const initialRun = baseline.models.find(
                (entry) => entry.model_id === model.id,
              );
              const missingInitial = initialRun?.status === "failed";
              const failure = explainReviewFailure(
                result?.error ?? (missingInitial ? initialRun.error : null),
              );
              return (
                <details className="second-review-model" key={model.id}>
                  <summary>
                    <strong>{model.label}</strong>
                    <span>
                      {!assigned
                        ? missingInitial
                          ? "First-round review unavailable"
                          : "Not assigned"
                        : busy
                          ? "Reviewing"
                          : result?.status === "succeeded"
                            ? "Reassessed"
                            : result
                              ? failure.label
                              : "No response"}
                    </span>
                    <Icon name="chevron" size={13} />
                  </summary>
                  <div>
                    <p>
                      {result?.review?.summary ??
                        (result?.error || missingInitial
                          ? `${failure.explanation} ${failure.nextStep}`
                          : !assigned
                            ? "No findings were assigned to this model in this round. Its initial result is kept in the report."
                            : busy
                              ? "This model’s answer will appear when its review finishes."
                              : "No second-round assessment was received. This does not count as agreement or rejection.")}
                    </p>
                    {missingInitial && (
                      <p className="second-review-caption">
                        No second-round request was sent to this model because
                        its independent review did not return a valid result.
                      </p>
                    )}
                    {(result?.error ||
                      (missingInitial && initialRun.error)) && (
                      <details className="review-technical-details">
                        <summary>Technical details</summary>
                        <p>
                          {result?.error?.detail ?? initialRun?.error?.detail}
                        </p>
                      </details>
                    )}
                    {!!result?.attempts.length && (
                      <ol
                        className="attempt-ledger"
                        aria-label={`${model.label} second-review attempts`}
                      >
                        {result.attempts.map((attempt) => (
                          <li key={attempt.attempt}>
                            <span>
                              Attempt {attempt.attempt} · {attempt.status}
                            </span>
                            <span>
                              {(attempt.elapsed_ms / 1000).toFixed(1)}s
                              {attempt.retry_delay_ms > 0
                                ? ` · ${(attempt.retry_delay_ms / 1000).toFixed(1)}s backoff`
                                : ""}
                            </span>
                            {attempt.error_code && (
                              <span className="attempt-error">
                                {attempt.error_code}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
          {!!plan.deferred_ids.length && (
            <p className="second-review-deferred">
              {plan.deferred_ids.length} queued findings are not selected for
              this round. They have no eligible peer assignment or fall beyond
              the 12-candidate limit, and remain available for human review.
            </p>
          )}
          {report && (
            <div
              className="second-review-findings"
              aria-label="Peer-informed finding assessments"
            >
              {report.findings.map((finding) => {
                const original = baseline.findings.find(
                  (item) => item.id === finding.finding_id,
                );
                const current = consolidated!.findings.find(
                  (item) => item.id === finding.finding_id,
                )!;
                return (
                  <article
                    className="second-review-finding"
                    key={finding.finding_id}
                  >
                    <div className="second-review-finding-heading">
                      <h3>{original?.title ?? finding.finding_id}</h3>
                      <span
                        className={`second-verdict ${current.pending_reassessment_models.length || current.severity_disagreement ? "unresolved" : current.outcome}`}
                      >
                        {finding.deferred
                          ? "Not reassessed"
                          : current.pending_reassessment_models.length
                            ? "Reassessment incomplete"
                            : current.severity_disagreement
                              ? "Severity disputed"
                              : labels[current.outcome]}
                      </span>
                    </div>
                    <div className="second-review-outcome-summary">
                      <strong>
                        {current.supporting_models.length} of 3 models support
                        this finding
                      </strong>
                      {current.retained_after_failed_review_models.length >
                        0 && (
                        <span>Includes retained first-round support.</span>
                      )}
                    </div>
                    {!!current.pending_reassessment_models.length && (
                      <p className="finding-next-step">
                        No accepted Second Review response from{" "}
                        {BEDROCK_MODELS.filter((model) =>
                          current.pending_reassessment_models.includes(
                            model.id,
                          ),
                        )
                          .map((model) => model.label)
                          .join(", ")}
                        . This review remains incomplete.
                      </p>
                    )}
                    {!!current.uncertain_models.length && (
                      <p className="finding-next-step">
                        At least one model needs more information before
                        deciding.
                      </p>
                    )}
                    {!!current.not_supported_models.length &&
                      current.outcome !== "not_supported" && (
                        <p className="finding-next-step">
                          At least one model does not support this finding.
                          Compare the reasoning below.
                        </p>
                      )}
                    {current.severity_disagreement && (
                      <p className="disagreement-note">
                        Proposed severities still differ.
                      </p>
                    )}
                    {current.outcome === "not_supported" && (
                      <p className="second-review-caption">
                        All three reviewers do not support this candidate after
                        discussion. The original finding remains available for
                        human review.
                      </p>
                    )}
                    {!finding.deferred && (
                      <details className="final-model-details">
                        <summary>
                          Model judgments and evidence{" "}
                          <Icon name="chevron" size={13} />
                        </summary>
                        <div className="second-review-comparison">
                          <span>
                            Independent discovery{" "}
                            <strong>{original?.agreement ?? 0} / 3</strong>
                          </span>
                          <span>
                            Latest valid support{" "}
                            <strong>
                              {current.supporting_models.length} / 3
                            </strong>
                          </span>
                        </div>
                        {BEDROCK_MODELS.map((model) => {
                          const run = report.models.find(
                            (item) => item.model_id === model.id,
                          );
                          const assessment = run?.review?.assessments.find(
                            (item) => item.finding_id === finding.finding_id,
                          );
                          const initiallyReported =
                            original?.supporting_models.includes(model.id);
                          const retainedOriginal =
                            current.judgments.find(
                              (judgment) => judgment.model_id === model.id,
                            )?.opinion_source === "first_round";
                          return (
                            <details
                              key={model.id}
                              className="second-assessment"
                            >
                              <summary>
                                <strong>{model.label}</strong>
                                <span>
                                  {assessment
                                    ? labels[assessment.verdict]
                                    : retainedOriginal
                                      ? "Original finding retained"
                                      : "No assessment"}
                                </span>
                                <Icon name="chevron" size={13} />
                              </summary>
                              <div>
                                <span className="second-review-prior">
                                  First round:{" "}
                                  {initiallyReported
                                    ? "reported"
                                    : baseline.models.find(
                                          (item) => item.model_id === model.id,
                                        )?.status === "failed"
                                      ? "unavailable"
                                      : "not reported"}
                                </span>
                                {assessment ? (
                                  <>
                                    {assessment.proposed_severity && (
                                      <span
                                        className={`severity-pill ${assessment.proposed_severity.toLowerCase()}`}
                                      >
                                        {assessment.proposed_severity} SEVERITY
                                      </span>
                                    )}
                                    <p>{assessment.rationale}</p>
                                    <p className="second-review-caption">
                                      {secondReviewEvidenceMethod(
                                        report,
                                        model.id,
                                      )}
                                    </p>
                                    <button
                                      className="evidence-link"
                                      onClick={() => {
                                        dialog.current?.close();
                                        onEvidence(
                                          finding.finding_id,
                                          assessment.evidence,
                                        );
                                      }}
                                    >
                                      Lines {assessment.evidence.line_start}–
                                      {assessment.evidence.line_end}
                                      <Icon name="up" size={12} />
                                    </button>
                                    <pre className="evidence">
                                      <code>{assessment.evidence.excerpt}</code>
                                    </pre>
                                  </>
                                ) : (
                                  <p>
                                    {retainedOriginal
                                      ? "This model’s valid first-round finding is retained. It is not a new second-round judgment."
                                      : "No accepted second-round assessment. The original review is unchanged."}
                                  </p>
                                )}
                              </div>
                            </details>
                          );
                        })}
                      </details>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          <div className="second-review-actions">
            {busy ? (
              <>
                <button
                  className="primary-button"
                  onClick={() => dialog.current?.close()}
                >
                  Keep reviewing in background <Icon name="arrow" size={15} />
                </button>
                <button className="quiet-button" onClick={onCancel}>
                  Cancel Second Review
                </button>
              </>
            ) : (
              <button
                className="primary-button"
                onClick={() => {
                  dialog.current?.close();
                  if (report && onFinalReport) onFinalReport();
                  else onFindings?.();
                }}
              >
                {report && onFinalReport
                  ? "View Final Report"
                  : "Return to Findings"}{" "}
                <Icon name="arrow" size={15} />
              </button>
            )}
            {report && (
              <>
                <button
                  className="quiet-button"
                  onClick={() => onExport("json")}
                >
                  Export JSON <Icon name="download" size={14} />
                </button>
                <button className="quiet-button" onClick={() => onExport("md")}>
                  Export Markdown <Icon name="download" size={14} />
                </button>
              </>
            )}
          </div>
          <p className="second-review-caption">
            One Second Review is available per independent analysis. Model
            support does not establish that a finding is correct.
          </p>
        </div>
      </dialog>
    </section>
  );
}
