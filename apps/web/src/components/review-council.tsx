import { useEffect, useRef } from "react";
import type { ConsensusFinding, CouncilReport } from "@/lib/orchestration";
import { BEDROCK_MODELS } from "@/lib/bedrock-config";
import type { PromptVariant } from "@/lib/review-policy";
import { Icon } from "./icons";

type Evidence = ConsensusFinding["evidence"];

function failureLabel(code: string | undefined) {
  if (code === "bedrock_access") return "Access denied";
  if (code === "timeout") return "Time limit";
  if (
    code === "invalid_report" ||
    code === "invalid_evidence" ||
    code === "incomplete"
  )
    return "Rejected";
  if (code === "bedrock_rate_limit") return "Rate limited";
  return "Unavailable";
}

export function CouncilStatus({
  report,
  busy,
  hasKey,
  onConnect,
  promptVariant,
  onPromptChange,
  onEvaluate,
  evaluating,
}: {
  report: CouncilReport | null;
  busy: boolean;
  hasKey: boolean;
  onConnect: () => void;
  promptVariant: PromptVariant;
  onPromptChange: (variant: PromptVariant) => void;
  onEvaluate: () => void;
  evaluating: boolean;
}) {
  const council = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      council.current
        ?.querySelectorAll<HTMLDetailsElement>("details[open]")
        .forEach((details) => {
          if (!details.contains(event.target as Node)) details.open = false;
        });
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return (
    <div
      ref={council}
      className="council-strip"
      aria-label="Model review status"
    >
      <div className="council-strip-heading">
        <div>
          <span className="eyebrow">REVIEW COUNCIL</span>
          <span className="council-process">
            Independent analysis · evidence reconciliation
          </span>
        </div>
        <button className="quiet-button" onClick={onConnect}>
          <Icon name="settings" size={14} />
          {hasKey ? "Connection settings" : "Connect Bedrock"}
        </button>
      </div>
      <div className="council-controls">
        <label htmlFor="review-prompt">Review prompt</label>
        <select
          id="review-prompt"
          value={promptVariant}
          disabled={busy || evaluating}
          onChange={(event) =>
            onPromptChange(event.target.value as PromptVariant)
          }
        >
          <option value="baseline">Standard</option>
          <option value="few-shot">Guided examples</option>
        </select>
        <details className="execution-limits">
          <summary>
            Execution limits <Icon name="chevron" size={12} />
          </summary>
          <div>
            <strong>Bounded orchestration</strong>
            <p>
              Up to two attempts per model; only transient service responses are
              retried. A successful review is never repeated within the run.
            </p>
            <dl>
              <div>
                <dt>Model deadline</dt>
                <dd>180 seconds, including retries</dd>
              </div>
              <div>
                <dt>Run deadline</dt>
                <dd>210 seconds</dd>
              </div>
              <div>
                <dt>Request budget</dt>
                <dd>6 model calls maximum</dd>
              </div>
              <div>
                <dt>Output budget</dt>
                <dd>8,192 tokens per attempt</dd>
              </div>
            </dl>
            <p>
              Authentication, invalid evidence and malformed reports are not
              retried. Completed reviews remain available when another model
              fails.
            </p>
          </div>
        </details>
        <button
          className="quiet-button validation-trigger"
          disabled={busy}
          onClick={onEvaluate}
        >
          <Icon name="scan" size={14} />
          {evaluating ? "View validation" : "Validate 5 cases"}
        </button>
      </div>
      <div className="council-models">
        {BEDROCK_MODELS.map((model, index) => {
          const result = report?.models.find(
            (item) => item.model_id === model.id,
          );
          const state = busy ? "pending" : (result?.status ?? "idle");
          return (
            <details
              className={`council-model ${state}`}
              key={model.id}
              name="model-review-details"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary>
                <span className="council-model-number">0{index + 1}</span>
                <span className="council-model-name">
                  <strong>{model.label}</strong>
                  <span>{model.provider}</span>
                </span>
                <span className="council-model-state">
                  {busy ? (
                    <span className="spinner" />
                  ) : result?.status === "succeeded" ? (
                    <Icon name="check" size={13} />
                  ) : (
                    <span className="model-state-dot" />
                  )}
                  {busy
                    ? "Pending"
                    : result?.status === "succeeded"
                      ? "Reviewed"
                      : result?.status === "failed"
                        ? failureLabel(result.error?.code)
                        : hasKey
                          ? "Not verified"
                          : "No key"}
                </span>
                <Icon name="chevron" size={13} />
              </summary>
              <div className="council-model-detail">
                {busy ? (
                  <p>
                    Reviews are in progress. The final report will show
                    validated results from each model.
                  </p>
                ) : result?.review ? (
                  <>
                    <p>{result.review.summary}</p>
                    <span>
                      {result.review.findings.length} candidates ·{" "}
                      {(result.elapsed_ms / 1000).toFixed(1)}s
                    </span>
                  </>
                ) : result?.error ? (
                  <>
                    <strong>{result.error.code}</strong>
                    <p>{result.error.detail}</p>
                  </>
                ) : (
                  <p>
                    {hasKey
                      ? "The key is ready. Model access is checked when you run API analysis."
                      : "Connect a Bedrock key, then run API analysis to request this model."}
                  </p>
                )}
                {!!result?.attempts?.length && (
                  <ol
                    className="attempt-ledger"
                    aria-label={`${model.label} attempt history`}
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
                <code>{model.id}</code>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

export function ConsensusEvidence({
  finding,
  report,
  onEvidence,
}: {
  finding: ConsensusFinding;
  report: CouncilReport;
  onEvidence: (evidence: Evidence) => void;
}) {
  return (
    <section
      className="model-perspectives"
      aria-label="Independent model evidence"
    >
      <div className="perspectives-heading">
        <h4>Independent model evidence</h4>
        <span>
          {finding.agreement} / {BEDROCK_MODELS.length} support
        </span>
      </div>
      {report.models.map((model) => {
        const members = finding.members.filter(
          (item) => item.model_id === model.model_id,
        );
        const observations = members
          .map((item) => model.review?.findings[item.finding_index])
          .filter((item) => !!item);
        return (
          <details key={model.model_id} className="model-perspective">
            <summary>
              <strong>{model.label}</strong>
              <span>
                {model.status === "failed"
                  ? "Unavailable"
                  : observations.length
                    ? "Supporting evidence"
                    : "Not reported"}
              </span>
              <Icon name="chevron" size={13} />
            </summary>
            <div className="model-perspective-body">
              {observations.length ? (
                observations.map((item, index) => (
                  <div className="model-observation" key={index}>
                    <span
                      className={`severity-pill ${item.proposed_severity.toLowerCase()}`}
                    >
                      {item.proposed_severity} SEVERITY
                    </span>
                    <p>{item.rationale}</p>
                    <button
                      className="evidence-link"
                      onClick={() => onEvidence(item.evidence)}
                    >
                      Lines {item.evidence.line_start}–{item.evidence.line_end}
                      <Icon name="up" size={12} />
                    </button>
                    <pre className="evidence">
                      <code>{item.evidence.excerpt}</code>
                    </pre>
                    <h4>Model recommendation</h4>
                    <p>{item.recommendation}</p>
                  </div>
                ))
              ) : (
                <p>
                  {model.status === "failed"
                    ? "This model did not return a validated review and contributes no agreement."
                    : "This model did not report a matching finding. Absence of a finding does not establish safety."}
                </p>
              )}
            </div>
          </details>
        );
      })}
    </section>
  );
}
