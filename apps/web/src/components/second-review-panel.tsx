import { useRef } from "react";
import type { CouncilReport } from "@/lib/orchestration";
import {
  buildSecondReviewPlan,
  type SecondReviewReport,
} from "@/lib/second-review";
import { BEDROCK_MODELS } from "@/lib/bedrock-config";
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

function errorLabel(code: string | undefined) {
  if (code === "bedrock_access") return "Access denied";
  if (code === "timeout") return "Time limit";
  if (code === "bedrock_rate_limit") return "Rate limited";
  if (["invalid_report", "invalid_evidence", "incomplete"].includes(code ?? ""))
    return "Rejected response";
  return "Unavailable";
}

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
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  if (baseline.schema_version !== "2.1.0") return null;
  const plan = buildSecondReviewPlan(baseline);
  const eligible = !plan.skipped_reason && plan.candidate_ids.length > 0;
  const completed =
    report?.models.filter((model) => model.status === "succeeded").length ?? 0;
  const resolved =
    report?.findings.filter((finding) => finding.status !== "unresolved")
      .length ?? 0;
  const open = () => dialog.current?.showModal();
  const run = () => {
    open();
    onRun();
  };
  const unavailable =
    plan.skipped_reason === "insufficient_reviewers"
      ? "At least two completed independent reviews are needed."
      : "No eligible disagreements in this independent review.";

  return (
    <section
      className="second-review-section"
      aria-label="Second review controls"
    >
      <div className="second-review-strip">
        <div>
          <span className="mini-label">SECOND REVIEW</span>
          <strong>
            {busy
              ? "Reassessing disputed findings"
              : report
                ? "Peer-informed review"
                : "One bounded reassessment"}
          </strong>
          <p>
            {busy
              ? "Independent results stay available while the models reconsider the evidence."
              : report
                ? `${completed} / ${plan.model_ids.length} reviewers completed · ${resolved} of ${plan.candidate_ids.length} selected candidates have matching dispositions`
                : eligible
                  ? `${plan.candidate_ids.length} candidates · up to ${plan.model_ids.length * 2} additional calls · 210-second round limit`
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
            ? "View second review"
            : report
              ? "View second review"
              : attempted
                ? "Round already attempted"
                : "Run second review"}
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
        onClose={() => {
          if (busy) onCancel();
        }}
      >
        <header>
          <div>
            <span className="eyebrow">PEER-INFORMED REASSESSMENT</span>
            <h2 id="second-review-title">Second review</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close second review"
            onClick={() => dialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body second-review-body">
          <p className="second-review-intro">
            Models reconsider the selected candidates using peer evidence. Their
            original findings and independent agreement remain unchanged.
          </p>
          <div className="second-review-budget">
            <span>
              <strong>1</strong> additional round
            </span>
            <span>
              <strong>{plan.model_ids.length * 2}</strong> calls maximum
            </span>
            <span>
              <strong>180s</strong> per model
            </span>
            <span>
              <strong>210s</strong> round deadline
            </span>
          </div>
          <p className="second-review-caption">
            Up to two attempts per reviewer, including retries. Only selected
            temporary service errors are retried. Agreement after discussion is
            not an independent vote or proof of correctness.
          </p>
          <div className="second-review-status" role="status">
            {busy ? (
              <>
                <span className="spinner" /> Reviewing{" "}
                {plan.candidate_ids.length} candidates
              </>
            ) : report ? (
              `${report.status === "completed" ? "Second review complete" : report.status === "partial" ? "Partial second review" : report.status === "skipped" ? "Second review skipped" : "Second review unavailable"} · ${report.execution.total_attempts} attempts · ${(report.elapsed_ms / 1000).toFixed(1)}s`
            ) : (
              "Second review stopped. Independent results are retained."
            )}
          </div>
          {error && <div className="error">{error}</div>}
          <div
            className="second-review-models"
            aria-label="Second-review model outcomes"
          >
            {BEDROCK_MODELS.map((model) => {
              const result = report?.models.find(
                (entry) => entry.model_id === model.id,
              );
              const assigned = plan.model_ids.includes(model.id);
              return (
                <details className="second-review-model" key={model.id}>
                  <summary>
                    <strong>{model.label}</strong>
                    <span>
                      {!assigned
                        ? "No first-round review"
                        : busy
                          ? "Reviewing"
                          : result?.status === "succeeded"
                            ? "Reassessed"
                            : result
                              ? errorLabel(result.error?.code)
                              : "No response"}
                    </span>
                    <Icon name="chevron" size={13} />
                  </summary>
                  <div>
                    <p>
                      {result?.review?.summary ??
                        result?.error?.detail ??
                        (!assigned
                          ? "This model had no valid independent review and was not assigned a second-round task."
                          : busy
                            ? "The completed response and its attempt history will appear here."
                            : "No second-round assessment was received. This does not count as agreement or rejection.")}
                    </p>
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
              {plan.deferred_ids.length} additional candidates are deferred by
              the 12-candidate limit. They remain in the independent review
              queue.
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
                return (
                  <article
                    className="second-review-finding"
                    key={finding.finding_id}
                  >
                    <div className="second-review-finding-heading">
                      <h3>{original?.title ?? finding.finding_id}</h3>
                      <span className={`second-verdict ${finding.status}`}>
                        {finding.deferred ? "Deferred" : labels[finding.status]}
                      </span>
                    </div>
                    <div className="second-review-comparison">
                      <span>
                        Independent agreement{" "}
                        <strong>{original?.agreement ?? 0} / 3</strong>
                      </span>
                      <span>
                        Support after discussion{" "}
                        <strong>{finding.supporting_models.length} / 3</strong>
                      </span>
                    </div>
                    {finding.severity_disagreement && (
                      <p className="disagreement-note">
                        Proposed severities still differ.
                      </p>
                    )}
                    {finding.status === "not_supported" && (
                      <p className="second-review-caption">
                        All three reviewers do not support this candidate after
                        discussion. The original finding remains available for
                        human review.
                      </p>
                    )}
                    {!finding.deferred &&
                      BEDROCK_MODELS.map((model) => {
                        const run = report.models.find(
                          (item) => item.model_id === model.id,
                        );
                        const assessment = run?.review?.assessments.find(
                          (item) => item.finding_id === finding.finding_id,
                        );
                        const initiallyReported =
                          original?.supporting_models.includes(model.id);
                        return (
                          <details key={model.id} className="second-assessment">
                            <summary>
                              <strong>{model.label}</strong>
                              <span>
                                {assessment
                                  ? labels[assessment.verdict]
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
                                  No accepted second-round assessment. The
                                  original review is unchanged.
                                </p>
                              )}
                            </div>
                          </details>
                        );
                      })}
                  </article>
                );
              })}
            </div>
          )}
          <div className="second-review-actions">
            {busy ? (
              <button className="primary-button" onClick={onCancel}>
                Cancel second review
              </button>
            ) : (
              <button
                className="primary-button"
                onClick={() => dialog.current?.close()}
              >
                Return to findings <Icon name="arrow" size={15} />
              </button>
            )}
            {report && (
              <>
                <button
                  className="quiet-button"
                  onClick={() => onExport("json")}
                >
                  Export both rounds · JSON <Icon name="download" size={14} />
                </button>
                <button className="quiet-button" onClick={() => onExport("md")}>
                  Markdown <Icon name="download" size={14} />
                </button>
              </>
            )}
          </div>
          <p className="second-review-caption">
            One second-round attempt is available per independent run. Start a
            new API analysis for another experiment.
          </p>
        </div>
      </dialog>
    </section>
  );
}
