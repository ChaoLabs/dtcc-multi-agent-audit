import { useRef, useState } from "react";
import type { EvaluationReport } from "@/lib/evaluation";
import {
  compareAdjudicatedRun,
  createAdjudicationTemplate,
  downloadReviewJSON,
  validateAdjudication,
  type HumanAdjudication,
} from "@/lib/evaluation-adjudication";

const percentage = (value: number | null) =>
  value === null ? "Not established" : `${(value * 100).toFixed(1)}%`;

export function EvaluationAdjudication({
  report,
  disabled,
}: {
  report: EvaluationReport | null;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reviews, setReviews] = useState<
    Map<EvaluationReport, HumanAdjudication>
  >(new Map());
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const labels = report ? reviews.get(report) : undefined;
  const comparison =
    labels && report ? compareAdjudicatedRun(report, labels) : null;
  const hasReports = report?.cases.some((entry) => entry.report) ?? false;
  async function template() {
    if (!report) return;
    setWorking(true);
    setError("");
    try {
      downloadReviewJSON(
        await createAdjudicationTemplate(report),
        "dtcc-human-review-template.json",
      );
    } catch {
      setError("A review template could not be prepared for this run.");
    } finally {
      setWorking(false);
    }
  }
  async function importLabels(file: File) {
    if (!report) return;
    setWorking(true);
    setError("");
    try {
      if (file.size > 1024 * 1024) throw new Error("file size");
      const checked = await validateAdjudication(
        JSON.parse(await file.text()),
        report,
      );
      setReviews(
        (previous) =>
          new Map(
            [...previous.entries()]
              .filter(([item]) => item !== report)
              .concat([[report, checked]])
              .slice(-10),
          ),
      );
    } catch {
      setError(
        "Human review could not be imported. Check the reviewer, labels, reference issue IDs and unchanged source / baseline hashes. Maximum file size: 1 MB.",
      );
    } finally {
      setWorking(false);
    }
  }
  if (!report) return null;
  return (
    <section
      className="adjudication-panel"
      aria-label="Human-reviewed accuracy"
    >
      <div className="adjudication-heading">
        <span className="eyebrow">EVIDENCE & VALIDATION</span>
        <h3>Human-reviewed accuracy</h3>
      </div>
      <p>
        Model agreement is not ground truth. Download this run’s template,
        assess the findings against the source, then import your review. No
        labels or vulnerabilities are pre-approved.
      </p>
      <details className="adjudication-guide">
        <summary>How to prepare a human review</summary>
        <ol>
          <li>
            Use the downloaded validation JSON to inspect each finding’s source
            evidence and rationale. Enter a reviewer name. Keep each{" "}
            <code>case_id</code>, <code>source_sha256</code>,{" "}
            <code>baseline_sha256</code> and <code>finding_id</code> unchanged.
          </li>
          <li>
            Add independently verified vulnerabilities to{" "}
            <code>reference_issues</code>, including issues missed by every
            model. Each issue needs <code>id</code>, <code>title</code>,{" "}
            <code>category</code>, <code>line_start</code>,{" "}
            <code>line_end</code> and an evidence-based <code>rationale</code>.
          </li>
          <li>
            Mark each model candidate <code>confirmed</code>,{" "}
            <code>refuted</code>, <code>uncertain</code> or{" "}
            <code>unreviewed</code>. Confirmed findings must link to a reference
            issue through <code>reference_id</code>; other labels use{" "}
            <code>null</code>. Explain every reviewed judgment.
          </li>
          <li>
            Set <code>inventory_complete</code> to true only after independently
            reviewing the entire contract and recording the scope in{" "}
            <code>inventory_rationale</code>. Without a complete inventory,
            recall and false negatives remain unknown.
          </li>
        </ol>
        <p>
          Use the same reference issue ID for duplicate findings about one
          vulnerability. Include compiler version, missing dependencies and
          assumptions in your rationale. The five familiar contracts support
          regression testing; they cannot establish general production accuracy.
        </p>
      </details>
      <div className="adjudication-actions">
        <button
          className="quiet-button"
          disabled={disabled || working || !hasReports}
          onClick={() => void template()}
        >
          Download review template
        </button>
        <button
          className="quiet-button"
          disabled={disabled || working || !hasReports}
          onClick={() => input.current?.click()}
        >
          Import human review
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          aria-label="Import human review JSON"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importLabels(file);
          }}
        />
        {labels && comparison && (
          <button
            className="quiet-button"
            disabled={disabled || working}
            onClick={() =>
              downloadReviewJSON(
                {
                  schema_version: "1.0.0",
                  evaluation: report,
                  adjudication: labels,
                  comparison,
                },
                "dtcc-adjudicated-comparison.json",
              )
            }
          >
            Export reviewed comparison
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {comparison && labels ? (
        <>
          <p className="adjudication-status" role="status">
            Reviewer: {labels.reviewer || "Not assigned"} · {comparison.cases}{" "}
            cases · {comparison.model_slots} comparable model / contract pairs ·{" "}
            {comparison.excluded_model_slots} excluded pairs
          </p>
          {comparison.second_round_judgments && (
            <p className="adjudication-status">
              Second-round decisions in this cohort:{" "}
              {comparison.second_round_judgments.supported} supported ·{" "}
              {comparison.second_round_judgments.not_supported} not supported ·{" "}
              {comparison.second_round_judgments.uncertain} uncertain
              (abstained).{" "}
              {comparison.second_round_judgments.retained_first_round_supports}{" "}
              first-round supports retained without reassessment.
            </p>
          )}
          <div className="adjudication-table-wrap">
            <table className="adjudication-table">
              <thead>
                <tr>
                  <th scope="col">Human-reviewed measure</th>
                  <th scope="col">First round</th>
                  <th scope="col">After second review</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">True positives</th>
                  <td>{comparison.first_round.true_positives}</td>
                  <td>
                    {comparison.after_review?.true_positives ?? "Not paired"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">False positives</th>
                  <td>{comparison.first_round.false_positives}</td>
                  <td>
                    {comparison.after_review?.false_positives ?? "Not paired"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">False negatives</th>
                  <td>
                    {comparison.first_round.false_negatives ??
                      "Not established"}
                  </td>
                  <td>
                    {comparison.after_review
                      ? (comparison.after_review.false_negatives ??
                        "Not established")
                      : "Not paired"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Unreviewed / uncertain predictions</th>
                  <td>{comparison.first_round.unreviewed_predictions}</td>
                  <td>
                    {comparison.after_review?.unreviewed_predictions ??
                      "Not paired"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Precision</th>
                  <td>{percentage(comparison.first_round.precision)}</td>
                  <td>
                    {comparison.after_review
                      ? percentage(comparison.after_review.precision)
                      : "Not paired"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Recall</th>
                  <td>{percentage(comparison.first_round.recall)}</td>
                  <td>
                    {comparison.after_review
                      ? percentage(comparison.after_review.recall)
                      : "Not paired"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">F1</th>
                  <td>{percentage(comparison.first_round.f1)}</td>
                  <td>
                    {comparison.after_review
                      ? percentage(comparison.after_review.f1)
                      : "Not paired"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="validation-explanation">
            {comparison.interpretation} Counts include reviewed predictions
            only; unreviewed predictions are shown separately. A complete
            reference inventory is{" "}
            {comparison.reference_inventory_complete
              ? "declared by the reviewer"
              : "not established"}
            .
          </p>
        </>
      ) : (
        <p className="adjudication-status">
          Accuracy not established · no human review imported for this run.
        </p>
      )}
    </section>
  );
}
