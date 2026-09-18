"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { AuditReport } from "@/generated/report";
import type { ModelReview } from "@/generated/review";
import {
  downloadReport,
  validateEnhanced,
  validateResponse,
} from "@/lib/report";
import { analyzeStatic, validateInput } from "@/lib/static-analysis";
import { BEDROCK, validateApiKey } from "@/lib/bedrock-config";
import { Icon } from "./icons";
import { CodeView } from "./code-view";

type Case = {
  id: string;
  title: string;
  summary: string;
  caveat: string;
  report: AuditReport;
};
type Finding = {
  id: string;
  rule_id: string;
  title: string;
  category: string;
  proposed_severity: "HIGH" | "MEDIUM" | "LOW";
  rationale: string;
  recommendation: string;
  evidence: { line_start: number; line_end: number; excerpt: string };
  kind: "static" | "model";
};
const repository = "https://github.com/ChaoLabs/dtcc-multi-agent-audit";

export default function Workspace({ cases }: { cases: Case[] }) {
  const [source, setSource] = useState(cases[0].report.input.source);
  const [filename, setFilename] = useState(cases[0].report.input.filename);
  const [selected, setSelected] = useState(cases[0].id);
  const [report, setReport] = useState<AuditReport | null>(cases[0].report);
  const [review, setReview] = useState<ModelReview | null>(null);
  const [mode, setMode] = useState<"static" | "api">("static");
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(
    cases[0].report.candidates[0]?.id ?? null,
  );
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [verified, setVerified] = useState(false);
  const [configError, setConfigError] = useState("");
  const apiKey = useRef("");
  const keyInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [focusTarget, setFocusTarget] = useState<{
    line: number;
    reveal: boolean;
  } | null>(null);
  const sourceView = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const caseDialog = useRef<HTMLDialogElement>(null);
  const apiDialog = useRef<HTMLDialogElement>(null);
  const reportDialog = useRef<HTMLDialogElement>(null);
  const methodDialog = useRef<HTMLDialogElement>(null);
  const version = useRef(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      apiKey.current = "";
    };
  }, []);
  const validReport =
    report?.input.source === source && report.input.filename === filename
      ? report
      : null;
  const validReview =
    validReport && review?.source_sha256 === validReport.source_sha256
      ? review
      : null;
  const findings: Finding[] = [
    ...(validReport?.candidates.map((item) => ({
      ...item,
      kind: "static" as const,
    })) ?? []),
    ...(validReview?.findings.map((item, index) => ({
      ...item,
      id: `AI-${index + 1}`,
      rule_id: `AI-${String(index + 1).padStart(3, "0")}`,
      kind: "model" as const,
    })) ?? []),
  ];
  const active = findings.find((item) => item.id === expanded);
  const shown = findings.filter(
    (item) =>
      (filter === "ALL" || item.proposed_severity === filter) &&
      (item.title + " " + item.category + " " + item.rule_id)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  const invalidate = useCallback(() => {
    version.current++;
    request.current?.abort();
    setBusy(false);
    setReport(null);
    setReview(null);
    setError("");
    setElapsed(null);
    setCopied(false);
    setFocusTarget(null);
  }, []);

  function loadCase(item: Case) {
    invalidate();
    setSelected(item.id);
    setSource(item.report.input.source);
    setFilename(item.report.input.filename);
    setReport(item.report);
    setExpanded(item.report.candidates[0]?.id ?? null);
    setEditing(false);
    setFilter("ALL");
    setQuery("");
    sourceView.current?.scrollTo({ top: 0 });
    caseDialog.current?.close();
  }
  function fresh() {
    invalidate();
    setSelected("");
    setFilename("Contract.sol");
    setSource("pragma solidity ^0.8.20;\n\ncontract Contract {\n\n}\n");
    setEditing(true);
    setExpanded(null);
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    invalidate();
    const stamp = version.current;
    try {
      if (file.size > 48_000)
        throw new Error("Source exceeds 48,000 UTF-8 bytes.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      validateInput(file.name, text);
      if (stamp !== version.current) return;
      setSource(text);
      setFilename(file.name);
      setSelected("");
      setEditing(true);
    } catch (cause) {
      if (stamp === version.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Cannot read this Solidity file.",
        );
    }
  }
  function focusCandidate(id: string, line: number, toggle = true) {
    setExpanded(toggle && expanded === id ? null : id);
    setEditing(false);
    setFocusTarget({ line, reveal: !toggle });
  }
  useEffect(() => {
    if (!focusTarget || editing) return;
    const container = sourceView.current;
    const node = container?.querySelector<HTMLElement>(
      `[data-line="${focusTarget.line}"]`,
    );
    if (container && node) {
      if (focusTarget.reveal && window.matchMedia("(max-width: 850px)").matches)
        container.scrollIntoView({ block: "center", behavior: "instant" });
      container.scrollTo({
        top: node.offsetTop - 90,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    }
  }, [focusTarget, editing]);

  function switchMode(next: "static" | "api") {
    if (busy) {
      version.current++;
      request.current?.abort();
      setBusy(false);
    }
    setMode(next);
    setError("");
    if (next === "api") apiDialog.current?.showModal();
  }
  function useKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const key = validateApiKey(keyInput.current?.value ?? "");
      version.current++;
      request.current?.abort();
      setBusy(false);
      setReview(null);
      setError("");
      apiKey.current = key;
      setHasKey(true);
      setVerified(false);
      setConfigError("");
      if (keyInput.current) keyInput.current.value = "";
      apiDialog.current?.close();
    } catch (cause) {
      setConfigError(
        cause instanceof Error ? cause.message : "Invalid API key.",
      );
    }
  }
  function clearKey() {
    version.current++;
    request.current?.abort();
    setBusy(false);
    apiKey.current = "";
    if (keyInput.current) keyInput.current.value = "";
    setHasKey(false);
    setVerified(false);
    setReview(null);
    setError("");
    setConfigError("");
  }
  const runAudit = useCallback(async () => {
    if (mode === "api" && !apiKey.current) {
      apiDialog.current?.showModal();
      return;
    }
    invalidate();
    const stamp = version.current;
    const snapshot = { filename, source };
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setFilter("ALL");
    setQuery("");
    const start = performance.now();
    const timer = setTimeout(() => abort.abort(), 125_000);
    try {
      const baseline = await analyzeStatic(snapshot.filename, snapshot.source);
      if (stamp !== version.current || !mounted.current) return;
      setReport(baseline);
      setExpanded(baseline.candidates[0]?.id ?? null);
      setEditing(false);
      if (mode === "api") {
        const response = await fetch("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...snapshot, api_key: apiKey.current }),
          signal: abort.signal,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
        });
        if (stamp !== version.current || !mounted.current) return;
        const value = await response.json().catch(() => null);
        if (!response.ok) {
          if (value?.code === "bedrock_access") setVerified(false);
          throw new Error(
            typeof value?.detail === "string"
              ? value.detail
              : `API analysis failed (HTTP ${response.status}).`,
          );
        }
        const result = await validateEnhanced(
          {
            schema_version: "1.0.0",
            static_report: baseline,
            model_review: value?.model_review,
          },
          snapshot.filename,
          snapshot.source,
          "browser",
        );
        if (
          result.model_review.model_id !== BEDROCK.model ||
          result.model_review.region !== BEDROCK.region ||
          result.model_review.protocol !== BEDROCK.protocol
        )
          throw new Error(
            "Bedrock returned an unexpected model configuration.",
          );
        if (stamp !== version.current || !mounted.current) return;
        setVerified(true);
        setReport(result.static_report);
        setReview(result.model_review);
        setExpanded(
          result.model_review.findings.length
            ? "AI-1"
            : (result.static_report.candidates[0]?.id ?? null),
        );
      } else {
        await validateResponse(
          baseline,
          snapshot.filename,
          snapshot.source,
          "browser",
        );
      }
      if (stamp === version.current && mounted.current)
        setElapsed(Math.round(performance.now() - start));
    } catch (cause) {
      if (stamp === version.current && mounted.current)
        setError(
          cause instanceof TypeError
            ? "Cannot reach the analysis service. Check your connection and retry."
            : cause instanceof Error && cause.name === "AbortError"
              ? "API analysis timed out. Static results remain available."
              : cause instanceof Error
                ? cause.message
                : "Analysis failed.",
        );
    } finally {
      clearTimeout(timer);
      if (stamp === version.current && mounted.current) setBusy(false);
    }
  }, [filename, source, mode, invalidate]);

  function cancel() {
    version.current++;
    request.current?.abort();
    setBusy(false);
    setError(
      "API analysis cancelled. Any completed static results remain available.",
    );
  }
  async function copySource() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => {
        if (mounted.current) setCopied(false);
      }, 2000);
    } catch {
      setError(
        "Copy is unavailable. Select and copy the source in the editor.",
      );
    }
  }

  return (
    <div className={`app-shell ${focused ? "workspace-focused" : ""}`}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="masthead">
        <div className="page-width masthead-inner">
          <Link href="/" className="brand" aria-label="DTCC home">
            <Image
              src="/dtcc-logo.png"
              alt="DTCC"
              width={116}
              height={28}
              priority
              unoptimized
            />
          </Link>
          <nav aria-label="Workspace navigation">
            <a className="nav-active" href="#workspace">
              Workspace
            </a>
            <button onClick={() => caseDialog.current?.showModal()}>
              Reference cases
            </button>
            <a
              href="/docs/DTCC_Platform_Overview.pdf"
              target="_blank"
              rel="noreferrer"
            >
              Documentation <span className="nav-format">PDF</span>
            </a>
          </nav>
          <a
            className="repository-link"
            href={repository}
            target="_blank"
            rel="noreferrer"
          >
            GitHub <Icon name="up" size={15} />
          </a>
        </div>
      </header>
      <main
        className="page-width main-content"
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === "Enter" &&
            !busy
          ) {
            event.preventDefault();
            void runAudit();
          }
        }}
      >
        <section className="project-heading" aria-labelledby="project-title">
          <div>
            <p className="eyebrow">
              <span />
              DIGITAL ASSET SECURITY
            </p>
            <h1 id="project-title">
              Multi-Agent AI for Smart Contract Audit{" "}
              <span>and Cybersecurity Risk Assessment</span>
            </h1>
          </div>
        </section>
        <section
          id="workspace"
          className="workbench"
          tabIndex={-1}
          aria-label="Audit workspace"
        >
          <div className="workspace-toolbar">
            <div
              className="mode-switch"
              role="group"
              aria-label="Analysis mode"
            >
              <button
                className={mode === "static" ? "selected" : ""}
                aria-pressed={mode === "static"}
                onClick={() => switchMode("static")}
              >
                <Icon name="scan" />
                Static analysis<span>On-device</span>
              </button>
              <button
                className={mode === "api" ? "selected" : ""}
                aria-pressed={mode === "api"}
                onClick={() => switchMode("api")}
              >
                <Icon name="layers" />
                API analysis<span>Bedrock</span>
              </button>
            </div>
            <div className="workspace-actions">
              <button
                className="focus-button"
                aria-label={focused ? "Restore overview" : "Expand workspace"}
                aria-pressed={focused}
                title={focused ? "Restore overview" : "Expand workspace"}
                onClick={() => setFocused(!focused)}
              >
                <Icon name={focused ? "restore" : "expand"} size={16} />
                <span>{focused ? "Restore" : "Focus"}</span>
              </button>
              <button
                className="quiet-button case-trigger"
                onClick={() => caseDialog.current?.showModal()}
              >
                <Icon name="book" size={16} />
                {cases.find((item) => item.id === selected)?.title ??
                  "Custom contract"}
                <Icon name="chevron" size={14} />
              </button>
            </div>
          </div>
          <div className="workspace-grid">
            <section className="source-panel" aria-labelledby="source-title">
              <header className="panel-header source-header">
                <div className="file-tab">
                  <Icon name="file" size={16} />
                  <input
                    aria-label="Contract filename"
                    value={filename}
                    maxLength={84}
                    onChange={(event) => {
                      invalidate();
                      setFilename(event.target.value);
                    }}
                  />
                </div>
                <div className="source-tools">
                  <button
                    aria-label="New contract"
                    title="New contract"
                    onClick={fresh}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                  <button
                    aria-label="Open Solidity file"
                    title="Open .sol file"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="upload" size={16} />
                  </button>
                  <button
                    aria-label={copied ? "Source copied" : "Copy source"}
                    title="Copy source"
                    onClick={() => void copySource()}
                  >
                    <Icon name={copied ? "check" : "copy"} size={16} />
                  </button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".sol"
                  hidden
                  aria-label="Solidity file upload"
                  onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </header>
              <div className="editor-bar">
                <h2 id="source-title">SOURCE CODE</h2>
                <div className="editor-tabs">
                  <button
                    aria-pressed={!editing}
                    onClick={() => setEditing(false)}
                  >
                    Inspect
                  </button>
                  <button
                    aria-pressed={editing}
                    onClick={() => setEditing(true)}
                  >
                    Edit source
                  </button>
                </div>
              </div>
              {editing ? (
                <textarea
                  aria-label="Solidity source"
                  className="source-edit"
                  value={source}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  onChange={(event) => {
                    invalidate();
                    setSource(event.target.value);
                    setSelected("");
                  }}
                />
              ) : (
                <CodeView
                  source={source}
                  active={active?.evidence}
                  viewRef={sourceView}
                />
              )}
              <div className="editor-status">
                <span>
                  <i />
                  Solidity
                </span>
                <span>
                  {source.split(/\r\n|\r|\n/).length} lines
                  <span className="status-separator">/</span>UTF-8
                </span>
              </div>
              <footer className="source-footer">
                <span className="shortcut">⌘ / Ctrl + Enter</span>
                {busy ? (
                  <button className="run-button running" onClick={cancel}>
                    <span className="spinner" />
                    Cancel analysis
                  </button>
                ) : (
                  <button
                    className="run-button"
                    disabled={!source.trim()}
                    onClick={() => void runAudit()}
                  >
                    <Icon
                      name={mode === "static" ? "scan" : "layers"}
                      size={17}
                    />
                    {mode === "static"
                      ? "Run static analysis"
                      : "Run API analysis"}
                    <Icon name="arrow" size={18} />
                  </button>
                )}
              </footer>
            </section>
            <section
              className="findings-panel"
              aria-labelledby="findings-title"
            >
              <header className="panel-header findings-header">
                <div>
                  <Icon name="shield" size={19} />
                  <h2 id="findings-title">
                    Findings <span>{validReport ? findings.length : "—"}</span>
                  </h2>
                </div>
                <div className="report-buttons">
                  <button
                    className="icon-button"
                    aria-label="Download JSON report"
                    title="Download JSON"
                    disabled={!validReport}
                    onClick={() =>
                      validReport &&
                      downloadReport(validReport, "json", validReview)
                    }
                  >
                    <span>JSON</span>
                    <Icon name="download" size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Download Markdown report"
                    title="Download Markdown"
                    disabled={!validReport}
                    onClick={() =>
                      validReport &&
                      downloadReport(validReport, "md", validReview)
                    }
                  >
                    <span>MD</span>
                    <Icon name="download" size={14} />
                  </button>
                </div>
              </header>
              <div className="findings-toolbar">
                <div
                  className="severity-filters"
                  role="group"
                  aria-label="Severity filter"
                >
                  {["ALL", "HIGH", "MEDIUM", "LOW"].map((level) => (
                    <button
                      key={level}
                      aria-pressed={filter === level}
                      onClick={() => setFilter(level)}
                    >
                      {level !== "ALL" && <i className={level.toLowerCase()} />}
                      {
                        {
                          ALL: "All",
                          HIGH: "High",
                          MEDIUM: "Medium",
                          LOW: "Low",
                        }[level]
                      }
                      <span>
                        {level === "ALL"
                          ? findings.length
                          : findings.filter(
                              (item) => item.proposed_severity === level,
                            ).length}
                      </span>
                    </button>
                  ))}
                </div>
                <label className="findings-search">
                  <Icon name="search" size={14} />
                  <input
                    aria-label="Search findings"
                    placeholder="Search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
              <div
                className="findings-content"
                aria-live="polite"
                aria-busy={busy}
              >
                {error && (
                  <div className="error" role="alert">
                    {error}
                  </div>
                )}
                {busy && (
                  <div className="analysis-progress">
                    <span className="spinner" />
                    <div>
                      <strong>
                        {mode === "api"
                          ? "Reviewing with Bedrock"
                          : "Running static rules"}
                      </strong>
                      <span>
                        {mode === "api"
                          ? "Source and static evidence sent for model review."
                          : "Checking the current source snapshot."}
                      </span>
                    </div>
                  </div>
                )}
                {validReview && (
                  <div className="model-summary">
                    <span className="mini-label">
                      <Icon name="layers" size={13} />
                      BEDROCK REVIEW
                    </span>
                    <p>{validReview.summary}</p>
                  </div>
                )}
                {!validReport && !busy ? (
                  <div className="empty-state">
                    <div className="empty-symbol">
                      <Icon name="scan" size={28} />
                    </div>
                    <h3>Ready for analysis</h3>
                    <p>Run an analysis to inspect this contract.</p>
                  </div>
                ) : validReport && findings.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-symbol">
                      <Icon name="check" size={28} />
                    </div>
                    <h3>No candidates flagged</h3>
                    <p>
                      No matching patterns were found.
                      <br />
                      Manual review is still required.
                    </p>
                  </div>
                ) : shown.length === 0 && !busy ? (
                  <div className="empty-state">
                    <Icon name="search" size={24} />
                    <h3>No matching findings</h3>
                    <button
                      className="quiet-button"
                      onClick={() => {
                        setFilter("ALL");
                        setQuery("");
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  shown.map((item, index) => (
                    <article
                      key={item.id}
                      className={`finding ${expanded === item.id ? "is-expanded" : ""}`}
                    >
                      <h3>
                        <button
                          className="finding-toggle"
                          aria-expanded={expanded === item.id}
                          aria-controls={`detail-${item.id}`}
                          onClick={() =>
                            focusCandidate(item.id, item.evidence.line_start)
                          }
                        >
                          <span className="finding-kicker">
                            <span
                              className={`severity-pill ${item.proposed_severity.toLowerCase()}`}
                            >
                              <i />
                              {item.proposed_severity}
                            </span>
                            <span className="finding-origin">
                              {item.kind === "model" ? "Bedrock" : "Static"}
                            </span>
                            <span className="finding-line">
                              L{item.evidence.line_start}
                            </span>
                            <Icon name="chevron" size={15} />
                          </span>
                          <span className="finding-title">
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            {item.title}
                          </span>
                        </button>
                      </h3>
                      <div
                        className="finding-detail"
                        id={`detail-${item.id}`}
                        hidden={expanded !== item.id}
                      >
                        <p>{item.rationale}</p>
                        <div className="evidence-heading">
                          <span>SOURCE EVIDENCE</span>
                          <button
                            onClick={() =>
                              focusCandidate(
                                item.id,
                                item.evidence.line_start,
                                false,
                              )
                            }
                          >
                            Line {item.evidence.line_start}
                            <Icon name="up" size={12} />
                          </button>
                        </div>
                        <pre className="evidence">
                          <code>{item.evidence.excerpt.trimStart()}</code>
                        </pre>
                        <h4>Recommended action</h4>
                        <p>{item.recommendation}</p>
                        <div className="finding-tags">
                          <span>{item.rule_id}</span>
                          <span>{item.category}</span>
                          <span>Needs review</span>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
              <footer className="results-footer">
                <span>
                  <span className={`result-dot ${busy ? "pulsing" : ""}`} />
                  {busy
                    ? "Analysis in progress"
                    : validReview
                      ? "Static + Bedrock review"
                      : validReport
                        ? validReport.execution === "recorded"
                          ? "Reference result"
                          : "Static analysis complete"
                        : "Awaiting analysis"}
                </span>
                <span>
                  {elapsed !== null ? `${(elapsed / 1000).toFixed(2)}s` : ""}
                </span>
              </footer>
            </section>
          </div>
          <div className="report-bar">
            <button
              className="report-trigger"
              onClick={() => reportDialog.current?.showModal()}
            >
              <Icon name="file" size={15} />
              Report details<span>Method &amp; provenance</span>
              <Icon name="arrow" size={14} />
            </button>
            <span className="report-format">SOLIDITY / EVM</span>
          </div>
        </section>
        <footer className="page-footer">
          <span>Source. Evidence. Review.</span>
          <div>
            <button onClick={() => methodDialog.current?.showModal()}>
              Analysis method
            </button>
            <Link href="/guide" target="_blank" rel="noreferrer">
              Local setup <Icon name="up" size={12} />
            </Link>
          </div>
        </footer>
      </main>
      <dialog
        ref={reportDialog}
        className="modal report-modal"
        aria-labelledby="report-title"
      >
        <header>
          <div>
            <span className="eyebrow">AUDIT RECORD</span>
            <h2 id="report-title">Report details</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close report details"
            onClick={() => reportDialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="details-body">
          <div>
            <h3>Analysis scope</h3>
            <p>
              {validReview
                ? "Static rules and one Bedrock model reviewed this source. Findings remain unreviewed hypotheses."
                : "15 static pattern rules. No compilation or model analysis has run for this report."}
            </p>
            <p>
              Matching a source location does not prove exploitability. No
              findings does not mean safe.
            </p>
            {cases.find((item) => item.id === selected) && (
              <p>{cases.find((item) => item.id === selected)?.caveat}</p>
            )}
          </div>
          <div>
            <h3>Source provenance</h3>
            {validReport ? (
              <dl>
                <div>
                  <dt>Engine</dt>
                  <dd>
                    {validReport.engine} {validReport.engine_version}
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{validReport.created_at}</dd>
                </div>
                <div>
                  <dt>Run ID</dt>
                  <dd>{validReport.run_id}</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd>{validReport.source_sha256}</dd>
                </div>
                {validReview && (
                  <>
                    <div>
                      <dt>Model</dt>
                      <dd>{validReview.model_id}</dd>
                    </div>
                    <div>
                      <dt>Tokens</dt>
                      <dd>
                        {validReview.input_tokens ?? "—"} input /{" "}
                        {validReview.output_tokens ?? "—"} output
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            ) : (
              <p>Available after analysis.</p>
            )}
          </div>
        </div>
      </dialog>
      <dialog
        ref={methodDialog}
        className="modal method-modal"
        aria-labelledby="method-title"
      >
        <header>
          <div>
            <span className="eyebrow">ANALYSIS METHOD</span>
            <h2 id="method-title">Evidence before conclusions</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close analysis method"
            onClick={() => methodDialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body method-body">
          <ol className="method-list">
            <li>
              <span>01</span>
              <div>
                <h3>Establish a baseline</h3>
                <p>
                  Run 15 pattern rules against a single Solidity source file.
                  Each candidate retains its rule, severity and source lines.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Add model reasoning</h3>
                <p>
                  API analysis sends the source and baseline to one configured
                  AWS Bedrock model. Static and model findings remain distinct.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Validate and review</h3>
                <p>
                  Check the response structure and match cited excerpts to the
                  source. Review exploitability and remediation before making a
                  decision.
                </p>
              </div>
            </li>
          </ol>
          <p className="method-note">
            Evidence checks confirm the cited source, not the correctness of a
            model&apos;s conclusion. No findings does not mean safe.
          </p>
          <a
            className="primary-button"
            href="/docs/DTCC_Platform_Overview.pdf"
            target="_blank"
            rel="noreferrer"
          >
            Read the platform overview <Icon name="up" size={16} />
          </a>
        </div>
      </dialog>
      <dialog
        ref={caseDialog}
        className="modal cases-modal"
        aria-labelledby="cases-title"
      >
        <header>
          <div>
            <span className="eyebrow">CONTRACT LIBRARY</span>
            <h2 id="cases-title">Reference cases</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close reference cases"
            onClick={() => caseDialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="case-list">
          {cases.map((item, index) => (
            <button key={item.id} onClick={() => loadCase(item)}>
              <span className="case-index">0{index + 1}</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
              </div>
              <Icon name="arrow" />
            </button>
          ))}
        </div>
      </dialog>
      <dialog
        ref={apiDialog}
        className="modal api-modal"
        onClose={() => {
          if (keyInput.current) keyInput.current.value = "";
          setConfigError("");
        }}
        aria-labelledby="api-title"
      >
        <header>
          <div>
            <span className="eyebrow">ANALYSIS CONNECTION</span>
            <h2 id="api-title">AWS Bedrock</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close API settings"
            onClick={() => apiDialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">
          <div className="connection-model">
            <div>
              <span className="eyebrow">MODEL</span>
              <strong>{BEDROCK.label}</strong>
            </div>
            <span className="connection-region">US · N. Virginia</span>
          </div>
          <p>
            Add your Bedrock key to review contracts in this workspace. API
            analysis sends your key and source through this site&apos;s server
            to AWS.
          </p>
          <form
            className="connection-form"
            onSubmit={useKey}
            autoComplete="off"
          >
            <label htmlFor="bedrock-key">Bedrock API key</label>
            <input
              ref={keyInput}
              id="bedrock-key"
              type="password"
              placeholder={
                hasKey ? "Paste a replacement key" : "bedrock-api-key-…"
              }
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              aria-describedby="key-help"
              aria-invalid={!!configError}
            />
            <p id="key-help">
              Kept in this tab&apos;s memory. Refresh or clear to remove it.
            </p>
            {configError && (
              <div role="alert" className="error">
                {configError}
              </div>
            )}
            <button className="primary-button" type="submit">
              {hasKey ? "Replace API key" : "Use API key"}
              <Icon name="arrow" size={17} />
            </button>
          </form>
          <div className="connection-status" role="status">
            <span className={`result-dot ${hasKey ? "" : "inactive"}`} />
            {verified
              ? "AWS access verified by the last analysis"
              : hasKey
                ? "Key ready · AWS access not yet verified"
                : "No API key connected"}
            {hasKey && (
              <button className="quiet-button" onClick={clearKey}>
                Clear key
              </button>
            )}
          </div>
          <p className="connection-note">
            Access is verified when you run analysis. Usage is billed to the AWS
            account associated with your key.
          </p>
          <div className="connection-footer">
            <a
              className="setup-link"
              href="/guide#bedrock"
              target="_blank"
              rel="noreferrer"
            >
              Connection guide
              <Icon name="up" size={14} />
            </a>
            <button
              className="quiet-button"
              onClick={() => apiDialog.current?.close()}
            >
              Return to workspace
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
