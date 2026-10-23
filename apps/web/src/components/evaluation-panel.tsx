import { useEffect, useRef, useState, type RefObject } from "react";
import {
  EVALUATION_CASES,
  runEvaluation,
  downloadEvaluation,
  type EvaluationReport,
} from "@/lib/evaluation";
import type { PromptVariant } from "@/lib/review-policy";
import { Icon } from "./icons";

const promptLabel = (variant: PromptVariant) =>
  variant === "few-shot" ? "Guided examples" : "Standard";

export function EvaluationPanel({
  dialogRef,
  requestRef,
  promptVariant,
  onPromptChange,
  getApiKey,
  hasKey,
  analysisBusy,
  onBusyChange,
  onConnect,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  requestRef: RefObject<AbortController | null>;
  promptVariant: PromptVariant;
  onPromptChange: (variant: PromptVariant) => void;
  getApiKey: () => string;
  hasKey: boolean;
  analysisBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  onConnect: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<
    Partial<Record<PromptVariant, EvaluationReport>>
  >({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestRef.current?.abort();
    };
  }, [requestRef]);

  async function run() {
    if (busy || analysisBusy || requestRef.current) return;
    if (!hasKey) {
      onConnect();
      return;
    }
    const abort = new AbortController();
    requestRef.current = abort;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setReport(null);
    try {
      const result = await runEvaluation({
        apiKey: getApiKey(),
        promptVariant,
        signal: abort.signal,
        onProgress: (snapshot) => {
          if (mounted.current && requestRef.current === abort)
            setReport(snapshot);
        },
      });
      if (mounted.current) {
        setReport(result);
        if (result.status === "completed") {
          setHistory((previous) => ({
            ...previous,
            [result.prompt_variant]: result,
          }));
        }
      }
    } catch {
      if (mounted.current)
        setError(
          "Validation could not finish. Any completed case reports remain available below.",
        );
    } finally {
      if (requestRef.current === abort) requestRef.current = null;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  const baseline = history.baseline;
  const guided = history["few-shot"];
  return (
    <dialog
      ref={dialogRef}
      className="modal evaluation-modal"
      aria-labelledby="evaluation-title"
      onClose={() => requestRef.current?.abort()}
    >
      <header>
        <div>
          <span className="eyebrow">CONTROLLED VALIDATION</span>
          <h2 id="evaluation-title">Five-contract validation</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close validation"
          onClick={() => dialogRef.current?.close()}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="modal-body evaluation-body">
        <p>
          Run the existing five reference contracts in sequence. Each case uses
          the same three models and evidence checks. Completed results remain
          available if you stop the run.
        </p>
        <div className="validation-controls">
          <label htmlFor="validation-prompt">Validation prompt</label>
          <select
            id="validation-prompt"
            value={promptVariant}
            disabled={busy || analysisBusy}
            onChange={(event) =>
              onPromptChange(event.target.value as PromptVariant)
            }
          >
            <option value="baseline">Standard</option>
            <option value="few-shot">Guided examples</option>
          </select>
        </div>
        <div className="validation-budget">
          <span>
            <strong>5</strong> fixed contracts
          </span>
          <span>
            <strong>15–30</strong> model calls for a full run
          </span>
          <span>
            <strong>20 min</strong> maximum batch time
          </span>
        </div>
        <p className="validation-explanation">
          Guided mode adds the same independent teaching examples to all three
          models. Run each setting separately to compare execution reliability
          and candidate findings. Accuracy still requires human assessment. AWS
          usage is billed to the connected account.
        </p>
        <ol className="validation-cases" aria-label="Validation cases">
          {EVALUATION_CASES.map((item, index) => {
            const outcome = report?.cases.find((entry) => entry.id === item.id);
            const state = outcome?.status ?? "pending";
            return (
              <li key={item.id} className={`validation-case ${state}`}>
                <span className="case-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {outcome?.report
                      ? `${outcome.report.models.filter((model) => model.status === "succeeded").length} / 3 reviews · ${outcome.report.findings.length} candidates · ${(outcome.elapsed_ms / 1000).toFixed(1)}s`
                      : (outcome?.error ?? item.filename)}
                  </span>
                </div>
                <span className="validation-case-state">
                  {state === "running" && <span className="spinner" />}
                  {!busy && report && state === "pending" ? "Not run" : state}
                </span>
              </li>
            );
          })}
        </ol>
        <div role="status" className="validation-status">
          {busy
            ? `${promptLabel(promptVariant)} · ${report?.metrics.completed_cases ?? 0} / 5 cases with results · validation in progress`
            : report
              ? `${promptLabel(report.prompt_variant)} · ${report.metrics.completed_cases} / 5 cases with results · ${report.status}`
              : "Ready · no AWS requests have been made by this validation run"}
        </div>
        {report && (
          <div className="validation-metrics">
            <div>
              <strong>{report.metrics.fully_reviewed_cases} / 5</strong>
              <span>
                Cases with all 3 reviews · {report.metrics.partial_cases}{" "}
                partial
              </span>
            </div>
            <div>
              <strong>{report.metrics.successful_model_reviews} / 15</strong>
              <span>Validated model reviews</span>
            </div>
            <div>
              <strong>{report.metrics.observed_attempts}</strong>
              <span>Reported attempts</span>
            </div>
            <div>
              <strong>{report.metrics.review_required}</strong>
              <span>Review queue entries</span>
            </div>
          </div>
        )}
        {baseline && guided && (
          <section
            className="validation-comparison"
            aria-label="Prompt comparison"
          >
            <h3>Prompt comparison</h3>
            <table>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Reviews</th>
                  <th>Attempts</th>
                  <th>Candidates</th>
                </tr>
              </thead>
              <tbody>
                {[baseline, guided].map((item) => (
                  <tr key={item.prompt_variant}>
                    <th>{promptLabel(item.prompt_variant)}</th>
                    <td>{item.metrics.successful_model_reviews} / 15</td>
                    <td>{item.metrics.observed_attempts}</td>
                    <td>{item.metrics.findings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Most recent completed run per setting, held in this tab. More
              candidates do not imply higher accuracy. Download each run for
              evidence-level review.
            </p>
          </section>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="validation-actions">
          {busy ? (
            <button
              className="primary-button"
              onClick={() => requestRef.current?.abort()}
            >
              <span className="spinner" />
              Cancel validation
            </button>
          ) : hasKey ? (
            <button
              className="primary-button"
              disabled={analysisBusy}
              onClick={() => void run()}
            >
              Run five-case validation
              <Icon name="arrow" size={16} />
            </button>
          ) : (
            <button className="primary-button" onClick={onConnect}>
              Connect Bedrock
              <Icon name="arrow" size={16} />
            </button>
          )}
          <button
            className="quiet-button"
            disabled={!report || busy}
            onClick={() => report && downloadEvaluation(report)}
          >
            <Icon name="download" size={15} />
            Download validation JSON
          </button>
        </div>
      </div>
    </dialog>
  );
}
