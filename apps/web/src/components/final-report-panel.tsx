import { useEffect, useRef, useState } from "react";
import {
  firstReviewEvidenceMethod,
  type CouncilReport,
} from "@/lib/orchestration";
import {
  secondReviewEvidenceMethod,
  type SecondReviewReport,
} from "@/lib/second-review";
import {
  buildFinalReviewReport,
  currentModelSeverities,
  type FinalModelJudgment,
  type FinalFinding,
} from "@/lib/final-report";
import { explainReviewFailure } from "@/lib/review-failure";
import { Icon } from "./icons";

const secondLabels: Record<FinalModelJudgment["second_round"], string> = {
  supported: "Supports",
  not_supported: "Does not support",
  uncertain: "Uncertain",
  failed: "No valid response",
  not_assigned: "Not assigned",
  deferred: "Deferred",
  not_run: "Not run",
};
const stateLabels = {
  first_round: "First-round consensus",
  reviewed: "Second Review attempted",
  deferred: "Not reassessed",
  not_reviewed: "Second Review not run",
} as const;

function findingExplanation(finding: FinalFinding): string {
  if (finding.review_state === "deferred")
    return "Not selected for Second Review. Review the original finding and its evidence.";
  if (finding.outcome === "not_supported")
    return "The models no longer support this finding. Its original explanation and proposed action are retained for comparison.";
  const reasons: string[] = [];
  if (finding.pending_reassessment_models.length) {
    const names = finding.judgments
      .filter((judgment) =>
        finding.pending_reassessment_models.includes(judgment.model_id),
      )
      .map((judgment) => judgment.label)
      .join(", ");
    reasons.push(`Second Review remains incomplete for ${names}.`);
    if (finding.retained_after_failed_review_models.length)
      reasons.push("Valid first-round support is retained.");
  } else if (finding.missing_models.length) {
    reasons.push("Some models have no accepted judgment on this finding.");
  }
  if (finding.uncertain_models.length)
    reasons.push("Additional context is needed to assess the risk.");
  if (finding.not_supported_models.length)
    reasons.push("Model opinions differ on whether the risk is present.");
  if (finding.severity_disagreement)
    reasons.push("The proposed severity ratings differ.");
  return reasons.join(" ");
}

export function FinalReportPanel({
  baseline,
  secondRound,
  onExport,
  onEvidence,
  autoOpen = false,
}: {
  baseline: CouncilReport;
  secondRound: SecondReviewReport | null;
  onExport: (format: "json" | "md") => void;
  onEvidence: (
    id: string,
    evidence: { line_start: number; line_end: number; excerpt: string },
  ) => void;
  autoOpen?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (autoOpen && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [autoOpen]);
  const [filter, setFilter] = useState<"all" | "review">("all");
  const report = buildFinalReviewReport(baseline, secondRound);
  const needsReview = report.findings.filter(
    (finding) => finding.requires_review,
  );
  const shown = filter === "review" ? needsReview : report.findings;
  const initialCompleted = baseline.models.filter(
    (model) => model.status === "succeeded",
  ).length;
  const initialFailures = baseline.models.filter(
    (model) => model.status === "failed",
  );
  const followUpCompleted =
    secondRound?.models.filter((model) => model.status === "succeeded")
      .length ?? 0;
  const followUpFailures =
    secondRound?.models.filter((model) => model.status === "failed") ?? [];
  const incompleteCoverage =
    initialCompleted < 3 ||
    (!!secondRound && followUpCompleted < secondRound.plan.model_ids.length);
  return (
    <section
      className="final-report-section"
      aria-label="Final Report controls"
    >
      <div>
        <span className="mini-label">FINAL REPORT</span>
        <p>
          {report.findings.length} findings · {needsReview.length} require
          further review
        </p>
      </div>
      <button
        className="quiet-button"
        onClick={() => dialog.current?.showModal()}
      >
        Open Final Report <Icon name="arrow" size={14} />
      </button>
      <dialog
        ref={dialog}
        className="modal final-report-modal"
        aria-labelledby="final-report-title"
      >
        <header>
          <div>
            <span className="eyebrow">CONSOLIDATED FINDINGS</span>
            <h2 id="final-report-title">Final Report</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close Final Report"
            onClick={() => dialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body final-report-body">
          <p className="final-report-intro">
            {secondRound
              ? "Consolidated first-round findings and second-round judgments."
              : "Consolidated first-round findings."}{" "}
            Model agreement is not an accuracy score; findings require human
            validation.
          </p>
          <section className="risk-summary" aria-label="Risk summary">
            <h3>Risk summary</h3>
            <div className="risk-summary-counts">
              <span>
                <strong>{report.summary.high}</strong> High
              </span>
              <span>
                <strong>{report.summary.medium}</strong> Medium
              </span>
              <span>
                <strong>{report.summary.low}</strong> Low
              </span>
              {report.summary.unrated > 0 && (
                <span>
                  <strong>{report.summary.unrated}</strong> Unrated
                </span>
              )}
            </div>
            <p>
              {report.summary.high > 0
                ? "Review high-severity findings first, then confirm the proposed actions against the evidence."
                : report.findings.length > 0
                  ? "Review the reported risks and proposed actions before making changes."
                  : "No findings were reported. This does not establish that the contract is safe."}
            </p>
          </section>
          <section
            className={`report-coverage-summary ${incompleteCoverage ? "partial" : ""}`}
            aria-label="Review coverage"
          >
            <strong>
              {incompleteCoverage
                ? "Review coverage is incomplete"
                : "Review coverage complete"}
            </strong>
            <p>First round: {initialCompleted} of 3 completed.</p>
            {secondRound && (
              <p>
                Second round: {followUpCompleted} of{" "}
                {secondRound.plan.model_ids.length} assigned reviews completed.
              </p>
            )}
            {incompleteCoverage && (
              <p>
                Available findings are retained. Missing reviews remain open for
                assessment.
              </p>
            )}
            {(initialFailures.length > 0 || followUpFailures.length > 0) && (
              <details className="review-technical-details">
                <summary>
                  Execution details <Icon name="chevron" size={13} />
                </summary>
                {initialFailures.map((model) => {
                  const failure = explainReviewFailure(model.error);
                  return (
                    <p key={model.model_id} className="report-coverage-failure">
                      <strong>
                        {model.label}: {failure.label}.
                      </strong>{" "}
                      {failure.explanation} {failure.nextStep}
                    </p>
                  );
                })}
                {followUpFailures.map((model) => {
                  const failure = explainReviewFailure(model.error);
                  return (
                    <p key={model.model_id} className="report-coverage-failure">
                      <strong>
                        {model.label} second round: {failure.label}.
                      </strong>{" "}
                      {failure.explanation} {failure.nextStep}
                    </p>
                  );
                })}
              </details>
            )}
          </section>
          <div className="final-report-toolbar">
            <div role="group" aria-label="Consolidated finding filter">
              <button
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All findings <span>{report.findings.length}</span>
              </button>
              <button
                aria-pressed={filter === "review"}
                onClick={() => setFilter("review")}
              >
                Unresolved or disputed <span>{needsReview.length}</span>
              </button>
            </div>
            <div className="final-report-exports">
              <button className="quiet-button" onClick={() => onExport("json")}>
                Export JSON <Icon name="download" size={14} />
              </button>
              <button className="quiet-button" onClick={() => onExport("md")}>
                Export Markdown <Icon name="download" size={14} />
              </button>
            </div>
          </div>
          {shown.length === 0 && (
            <p className="final-report-empty">
              {report.findings.length
                ? "No findings match this filter. Human validation is still required."
                : "No candidates were reported. This is not evidence that the contract is free of vulnerabilities."}
            </p>
          )}
          {shown.map((finding) => (
            <article className="final-finding" key={finding.id}>
              <div className="final-finding-heading">
                <div>
                  <span
                    className={`severity-pill ${(finding.proposed_severity ?? "unrated").toLowerCase()}`}
                  >
                    {finding.proposed_severity ?? "Unrated"}
                    {finding.severity_disagreement
                      ? " · severity disputed"
                      : ""}
                  </span>
                  <h3>{finding.title}</h3>
                </div>
                <span
                  className={`second-verdict ${finding.pending_reassessment_models.length ? "unresolved" : finding.outcome}`}
                >
                  {finding.pending_reassessment_models.length
                    ? "Reassessment incomplete"
                    : finding.outcome === "supported"
                      ? "Models support"
                      : finding.outcome === "not_supported"
                        ? "All three do not support"
                        : "Unresolved or disputed"}
                </span>
              </div>
              <div className="final-risk-content">
                <section>
                  <h4>
                    {finding.outcome === "not_supported"
                      ? "Original risk explanation"
                      : "Risk explanation"}
                  </h4>
                  <p>{finding.rationale}</p>
                </section>
                <section className="final-recommended-action">
                  <h4>
                    {finding.outcome === "not_supported"
                      ? "Original recommended action"
                      : "Recommended action"}
                  </h4>
                  <p>{finding.recommendation}</p>
                </section>
                <p className="risk-support-caption">
                  {finding.supporting_models.length} of 3 models support this
                  finding.
                  {finding.retained_after_failed_review_models.length > 0 &&
                    " Includes retained first-round support."}
                </p>
              </div>
              {findingExplanation(finding) && (
                <p className="finding-next-step">
                  {findingExplanation(finding)}
                </p>
              )}
              <details className="final-model-details">
                <summary>
                  Model judgments <Icon name="chevron" size={13} />
                </summary>
                <div className="final-finding-metrics">
                  <span>
                    Independent discovery{" "}
                    <strong>{finding.first_round_agreement} / 3</strong>
                  </span>
                  <span>
                    Latest valid support{" "}
                    <strong>{finding.supporting_models.length} / 3</strong>
                  </span>
                  <span>
                    Review status{" "}
                    <strong>{stateLabels[finding.review_state]}</strong>
                  </span>
                </div>
                <p className="final-report-caption">Finding ID: {finding.id}</p>
                <div
                  className="final-judgment-table"
                  role="region"
                  aria-label={`${finding.title} model judgments`}
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Model</th>
                        <th scope="col">First round</th>
                        <th scope="col">Second round</th>
                        <th scope="col">Latest valid opinion</th>
                        <th scope="col">Proposed severity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finding.judgments.map((judgment) => {
                        const severities = currentModelSeverities(
                          baseline,
                          finding.id,
                          judgment,
                        );
                        return (
                          <tr key={judgment.model_id}>
                            <th scope="row">{judgment.label}</th>
                            <td>
                              {judgment.first_round === "reported"
                                ? "Reported"
                                : judgment.first_round === "not_reported"
                                  ? "Not reported"
                                  : "Unavailable"}
                            </td>
                            <td>{secondLabels[judgment.second_round]}</td>
                            <td>
                              {judgment.effective_verdict === "supported"
                                ? "Supports"
                                : judgment.effective_verdict === "not_supported"
                                  ? "Does not support"
                                  : judgment.effective_verdict === "uncertain"
                                    ? "Uncertain"
                                    : "Unknown"}
                              <small>
                                {judgment.opinion_source === "first_round"
                                  ? "Original finding retained"
                                  : judgment.opinion_source === "second_round"
                                    ? "Peer-informed judgment"
                                    : "No accepted judgment"}
                              </small>
                            </td>
                            <td>
                              {severities.length
                                ? severities.join(" / ")
                                : "Not rated"}
                              {severities.length > 1 && (
                                <small>Original ratings differ</small>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
              <details className="final-finding-evidence">
                <summary>
                  Source evidence and reasoning{" "}
                  <Icon name="chevron" size={13} />
                </summary>
                <div>
                  <button
                    className="evidence-link"
                    onClick={() => {
                      dialog.current?.close();
                      onEvidence(finding.id, finding.evidence);
                    }}
                  >
                    Lines {finding.evidence.line_start}–
                    {finding.evidence.line_end} <Icon name="up" size={12} />
                  </button>
                  <pre className="evidence">
                    <code>{finding.evidence.excerpt}</code>
                  </pre>
                  {finding.judgments
                    .filter((judgment) => judgment.rationale)
                    .map((judgment) => (
                      <div className="final-rationale" key={judgment.model_id}>
                        <strong>{judgment.label}</strong>
                        <span>
                          {judgment.opinion_source === "second_round"
                            ? "Second-round reasoning"
                            : "First-round reasoning"}
                        </span>
                        <p>{judgment.rationale}</p>
                        {secondRound &&
                          judgment.opinion_source === "second_round" && (
                            <p className="second-review-caption">
                              {secondReviewEvidenceMethod(
                                secondRound,
                                judgment.model_id,
                              )}
                            </p>
                          )}
                        {judgment.opinion_source === "first_round" && (
                          <p className="second-review-caption">
                            {firstReviewEvidenceMethod(baseline)}
                          </p>
                        )}
                        {judgment.evidence && (
                          <button
                            className="evidence-link"
                            onClick={() => {
                              dialog.current?.close();
                              onEvidence(finding.id, judgment.evidence!);
                            }}
                          >
                            Inspect lines {judgment.evidence.line_start}–
                            {judgment.evidence.line_end}{" "}
                            <Icon name="up" size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  <p>
                    <strong>Review action</strong> {finding.next_action}
                  </p>
                </div>
              </details>
            </article>
          ))}
          <p className="final-report-caption">
            Not reported means the model did not identify the claim; it does not
            mean the model rejected it. Unavailable models and missing responses
            never count as agreement. Claims missed by all first-round models
            are outside this report.
          </p>
        </div>
      </dialog>
    </section>
  );
}
