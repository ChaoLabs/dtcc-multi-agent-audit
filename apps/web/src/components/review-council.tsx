import { useEffect, useRef } from "react";
import type { ConsensusFinding, CouncilReport } from "@/lib/orchestration";
import { BEDROCK_MODELS } from "@/lib/bedrock-config";
import { Icon } from "./icons";

type Evidence = ConsensusFinding["evidence"];

export function CouncilStatus({
  report,
  busy,
  hasKey,
  onConnect,
}: {
  report: CouncilReport | null;
  busy: boolean;
  hasKey: boolean;
  onConnect: () => void;
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
                        ? "Unavailable"
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
