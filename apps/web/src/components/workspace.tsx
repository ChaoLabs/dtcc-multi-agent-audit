"use client";

import { readCouncilJson, reviewHeaders } from "@/lib/review-http";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { AuditReport } from "@/generated/report";
import { downloadReport, validateResponse } from "@/lib/report";
import {
  validateCouncil,
  type CouncilReport,
  type ConsensusFinding,
} from "@/lib/orchestration";
import { downloadFinalReviewReport } from "@/lib/second-review-export";
import { downloadCouncilReport } from "@/lib/council-export";
import { reviewStageAvailability, type ReviewStage } from "@/lib/review-stages";
import {
  buildSecondReviewPlan,
  type SecondReviewReport,
} from "@/lib/second-review";
import {
  requestSecondReview,
  SecondReviewRequestError,
} from "@/lib/second-review-client";
import {
  REVIEW_CLIENT_TIMEOUT_MS,
  REVIEW_POLICY,
  type PromptVariant,
} from "@/lib/review-policy";
import { createReviewRunGate } from "@/lib/review-workflow";
import { EvaluationPanel } from "./evaluation-panel";
import { SecondReviewPanel } from "./second-review-panel";
import { FinalReportPanel } from "./final-report-panel";
import { analyzeStatic, validateInput } from "@/lib/static-analysis";
import {
  BEDROCK_MODELS,
  recordedCouncil,
  validateApiKey,
} from "@/lib/bedrock-config";
import { Icon } from "./icons";
import { CodeView } from "./code-view";
import { CouncilStatus, ConsensusEvidence } from "./review-council";

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
  consensus?: ConsensusFinding;
};
const repository = "https://github.com/ChaoLabs/dtcc-multi-agent-audit";

export default function Workspace({ cases }: { cases: Case[] }) {
  const [source, setSource] = useState(cases[0].report.input.source);
  const [filename, setFilename] = useState(cases[0].report.input.filename);
  const [selected, setSelected] = useState(cases[0].id);
  const [report, setReport] = useState<AuditReport | null>(cases[0].report);
  const [council, setCouncil] = useState<CouncilReport | null>(null);
  const [secondReview, setSecondReview] = useState<SecondReviewReport | null>(
    null,
  );
  const [secondBusy, setSecondBusy] = useState(false);
  const [secondAttempted, setSecondAttempted] = useState(false);
  const [secondError, setSecondError] = useState("");
  const [reviewStage, setReviewStage] = useState<ReviewStage>("findings");
  const secondAttemptedRef = useRef(false);
  const secondRequest = useRef<AbortController | null>(null);
  const secondGeneration = useRef(0);
  const secondAdmissions = useRef(0);
  const [resultView, setResultView] = useState<"static" | "consensus">(
    "static",
  );
  const [confidence, setConfidence] = useState("ALL");
  const [promptVariant, setPromptVariant] = useState<PromptVariant>("baseline");
  const [reviewQueueOnly, setReviewQueueOnly] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const evaluationRequest = useRef<AbortController | null>(null);
  const evaluationDialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"static" | "api">("static");
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missingReview, setMissingReview] = useState(false);
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
    evidence?: Finding["evidence"];
  } | null>(null);
  const sourceView = useRef<HTMLDivElement>(null);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const findingsView = useRef<HTMLDivElement>(null);
  const reviewStages = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const caseDialog = useRef<HTMLDialogElement>(null);
  const apiDialog = useRef<HTMLDialogElement>(null);
  const reportDialog = useRef<HTMLDialogElement>(null);
  const methodDialog = useRef<HTMLDialogElement>(null);
  const version = useRef(0);
  const runGate = useRef(createReviewRunGate());
  const mounted = useRef(true);
  useEffect(() => {
    const gate = runGate.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      gate.cancel();
      secondRequest.current?.abort();
      apiKey.current = "";
    };
  }, []);
  useEffect(() => {
    findingsView.current?.scrollTo({ top: 0 });
  }, [resultView, reviewStage, filter, confidence, query, reviewQueueOnly]);
  const validReport =
    report?.input.source === source && report.input.filename === filename
      ? report
      : null;
  const validCouncil =
    validReport && council?.source_sha256 === validReport.source_sha256
      ? council
      : null;
  const stages = reviewStageAvailability(
    validCouncil,
    secondReview,
    busy || secondBusy,
  );
  const showFindings = mode === "static" || reviewStage === "findings";
  const showConsensus = mode === "api" && resultView === "consensus";
  const findings: Finding[] = showConsensus
    ? (validCouncil?.findings.map((item) => ({
        ...item,
        rule_id: item.id,
        kind: "model" as const,
        consensus: item,
      })) ?? [])
    : (validReport?.candidates.map((item) => ({
        ...item,
        kind: "static" as const,
      })) ?? []);
  const reviewQueue = validCouncil?.review_queue ?? [];
  const active = findings.find((item) => item.id === expanded);
  const shown = findings.filter(
    (item) =>
      (filter === "ALL" || item.proposed_severity === filter) &&
      (!showConsensus ||
        !reviewQueueOnly ||
        reviewQueue.some((entry) => entry.finding_id === item.id)) &&
      (!showConsensus ||
        confidence === "ALL" ||
        item.consensus?.confidence === confidence) &&
      (item.title + " " + item.category + " " + item.rule_id)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const completedModels =
    validCouncil?.models.filter((item) => item.status === "succeeded").length ??
    0;
  async function exportReport(format: "json" | "md") {
    if (!validReport || (showConsensus && !validCouncil)) return;
    try {
      if (validCouncil && stages.finalReportAvailable)
        await downloadFinalReviewReport(
          validCouncil,
          secondReview,
          format,
          validReport,
        );
      else if (validCouncil)
        downloadCouncilReport(validReport, format, validCouncil);
      else downloadReport(validReport, format);
    } catch {
      setError(
        "The report could not be exported because its source or review binding failed validation.",
      );
    }
  }
  function changeResultView(next: "static" | "consensus") {
    setResultView(next);
    setFilter("ALL");
    setConfidence("ALL");
    setReviewQueueOnly(false);
    setQuery("");
    setExpanded(
      next === "static"
        ? (validReport?.candidates[0]?.id ?? null)
        : (validCouncil?.findings[0]?.id ?? null),
    );
    setFocusTarget(null);
  }

  function selectReviewStage(stage: ReviewStage) {
    setReviewStage(stage);
    if (stage === "final") return;
    requestAnimationFrame(() => {
      reviewStages.current
        ?.querySelector<HTMLButtonElement>(`[data-review-stage="${stage}"]`)
        ?.focus();
    });
  }

  const resetSecondReview = useCallback(() => {
    secondGeneration.current++;
    secondRequest.current?.abort();
    secondRequest.current = null;
    setSecondBusy(false);
    setSecondReview(null);
    setSecondAttempted(false);
    secondAttemptedRef.current = false;
    secondAdmissions.current = 0;
    setSecondError("");
    setReviewStage("findings");
  }, []);

  const invalidate = useCallback(() => {
    version.current++;
    runGate.current.cancel();
    resetSecondReview();
    setBusy(false);
    setReport(null);
    setCouncil(null);
    setMissingReview(false);
    setError("");
    setElapsed(null);
    setCopied(false);
    setFocusTarget(null);
    findingsView.current?.scrollTo({ top: 0 });
  }, [resetSecondReview]);

  function loadCase(item: Case) {
    invalidate();
    setSelected(item.id);
    setSource(item.report.input.source);
    setFilename(item.report.input.filename);
    setReport(item.report);
    setExpanded(item.report.candidates[0]?.id ?? null);
    setEditing(false);
    setFilter("ALL");
    setConfidence("ALL");
    setResultView("static");
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
  function focusCandidate(
    id: string,
    line: number,
    toggle = true,
    evidence?: Finding["evidence"],
  ) {
    setExpanded(toggle && expanded === id ? null : id);
    setEditing(false);
    setFocusTarget({ line, reveal: !toggle, evidence });
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
    evaluationRequest.current?.abort();
    if (secondBusy) cancelSecondReview();
    if (busy) {
      version.current++;
      runGate.current.cancel();
      setBusy(false);
    }
    setMode(next);
    setReviewStage("findings");
    changeResultView(next === "api" ? "consensus" : "static");
    setError("");
    if (next === "api" && !apiKey.current) apiDialog.current?.showModal();
  }
  function changePrompt(next: PromptVariant) {
    if (busy || evaluating || secondBusy) return;
    resetSecondReview();
    setPromptVariant(next);
    setCouncil(null);
    setMissingReview(false);
    setReviewQueueOnly(false);
    setElapsed(null);
    setError("");
  }
  function useKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const key = validateApiKey(keyInput.current?.value ?? "");
      version.current++;
      runGate.current.cancel();
      if (secondRequest.current) cancelSecondReview();
      setBusy(false);
      // Replacing a credential does not invalidate already validated evidence.
      // Any active request is cancelled; completed reports remain exportable.
      setError("");
      evaluationRequest.current?.abort();
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
    evaluationRequest.current?.abort();
    if (secondRequest.current) cancelSecondReview();
    version.current++;
    runGate.current.cancel();
    setBusy(false);
    apiKey.current = "";
    if (keyInput.current) keyInput.current.value = "";
    setHasKey(false);
    setVerified(false);
    setError("");
    setConfigError("");
  }
  const performSecondReview = useCallback(
    async ({
      baseline,
      source,
      filename,
      key,
      parentSignal,
      isCurrent,
    }: {
      baseline: CouncilReport;
      source: string;
      filename: string;
      key: string;
      parentSignal?: AbortSignal;
      isCurrent: () => boolean;
    }) => {
      if (
        recordedCouncil(baseline.models) !== BEDROCK_MODELS ||
        secondAttemptedRef.current ||
        secondAdmissions.current >= 2 ||
        secondRequest.current ||
        !isCurrent()
      )
        return;
      const plan = buildSecondReviewPlan(baseline);
      if (plan.skipped_reason || !plan.candidate_ids.length) return;
      const stamp = ++secondGeneration.current;
      const abort = new AbortController();
      const stop = () => abort.abort();
      parentSignal?.addEventListener("abort", stop, { once: true });
      if (parentSignal?.aborted || !isCurrent()) {
        parentSignal?.removeEventListener("abort", stop);
        return;
      }
      secondRequest.current = abort;
      secondAdmissions.current++;
      setSecondBusy(true);
      setSecondAttempted(true);
      secondAttemptedRef.current = true;
      setSecondError("");
      try {
        const result = await requestSecondReview({
          apiKey: key,
          filename,
          source,
          baseline: baseline,
          signal: abort.signal,
        });
        if (
          !mounted.current ||
          !isCurrent() ||
          secondGeneration.current !== stamp ||
          abort.signal.aborted
        )
          return;
        setSecondReview(result);
      } catch (cause) {
        if (
          mounted.current &&
          isCurrent() &&
          secondGeneration.current === stamp
        ) {
          const safeRecovery =
            !abort.signal.aborted &&
            cause instanceof SecondReviewRequestError &&
            cause.safeToRetry &&
            secondAdmissions.current < 2;
          if (safeRecovery) {
            secondAttemptedRef.current = false;
            setSecondAttempted(false);
          }
          setSecondError(
            abort.signal.aborted
              ? "Second Review cancelled. First-round findings remain available."
              : safeRecovery
                ? "The service is busy; no model calls were started. Wait briefly, then select Run Second Review to try once more."
                : cause instanceof SecondReviewRequestError
                  ? `${cause.message}${cause.safeToRetry ? " The admission retry limit is reached; start a new first review when the service is ready." : ""}`
                  : "Second Review did not return a valid result. First-round findings remain available. Start a new Bedrock Review before another attempt.",
          );
        }
      } finally {
        parentSignal?.removeEventListener("abort", stop);
        if (secondRequest.current === abort) secondRequest.current = null;
        if (mounted.current && secondGeneration.current === stamp)
          setSecondBusy(false);
      }
    },
    [],
  );

  const runAudit = useCallback(async () => {
    if (
      evaluating ||
      busy ||
      secondBusy ||
      secondRequest.current ||
      runGate.current.isActive()
    )
      return;
    if (mode === "api" && !apiKey.current) {
      apiDialog.current?.showModal();
      return;
    }
    invalidate();
    const lease = runGate.current.begin();
    if (!lease) return;
    const stamp = version.current;
    const snapshot = { filename, source };
    const abort = lease.controller;
    const key = apiKey.current;
    const isCurrent = () =>
      lease.isCurrent() && stamp === version.current && mounted.current;
    setBusy(true);
    if (mode === "api") setVerified(false);
    setResultView(mode === "api" ? "consensus" : "static");
    setConfidence("ALL");
    setReviewQueueOnly(false);
    setFilter("ALL");
    setQuery("");
    const start = performance.now();
    const timer = setTimeout(() => abort.abort(), REVIEW_CLIENT_TIMEOUT_MS);
    let requestedCouncil = false;
    try {
      const baseline = await analyzeStatic(snapshot.filename, snapshot.source);
      if (!isCurrent()) return;
      setReport(baseline);
      setExpanded(baseline.candidates[0]?.id ?? null);
      setEditing(false);
      if (mode === "api") {
        requestedCouncil = true;
        const response = await fetch("/api/reviews", {
          method: "POST",
          headers: reviewHeaders,
          body: JSON.stringify({
            ...snapshot,
            api_key: key,
            prompt_variant: promptVariant,
          }),
          signal: abort.signal,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
        });
        if (!isCurrent()) return;
        const value = await readCouncilJson(response, abort.signal);
        if (!response.ok) {
          const failure = value && typeof value === "object" ? value : {};
          if ("code" in failure && failure.code === "bedrock_access")
            setVerified(false);
          throw new Error(
            "detail" in failure && typeof failure.detail === "string"
              ? failure.detail
              : `Bedrock Review failed (HTTP ${response.status}).`,
          );
        }
        const result = await validateCouncil(value, snapshot.source);
        if (
          (promptVariant === "few-shot" && !result.execution) ||
          (result.execution &&
            result.execution.prompt_variant !== promptVariant)
        )
          throw new Error(
            "The returned settings do not match this review. Please start a new Bedrock Review.",
          );
        if (!isCurrent()) return;
        setVerified(result.status === "completed");
        setCouncil(result);
        setExpanded(result.findings[0]?.id ?? null);
        setElapsed(Math.round(performance.now() - start));
        clearTimeout(timer);
        setBusy(false);
      } else {
        await validateResponse(
          baseline,
          snapshot.filename,
          snapshot.source,
          "browser",
        );
      }
      if (isCurrent() && mode === "static")
        setElapsed(Math.round(performance.now() - start));
    } catch (cause) {
      if (stamp === version.current && mounted.current) {
        setMissingReview(requestedCouncil);
        setError(
          cause instanceof TypeError
            ? "Cannot reach the analysis service. Check your connection and retry."
            : cause instanceof Error && cause.name === "AbortError"
              ? "Bedrock Review timed out. Static Analysis results remain available."
              : cause instanceof Error
                ? cause.message
                : "Analysis failed.",
        );
      }
    } finally {
      clearTimeout(timer);
      lease.finish();
      if (stamp === version.current && mounted.current) setBusy(false);
    }
  }, [
    filename,
    source,
    mode,
    invalidate,
    promptVariant,
    evaluating,
    busy,
    secondBusy,
  ]);

  async function runSecondReview() {
    if (
      busy ||
      evaluating ||
      secondBusy ||
      runGate.current.isActive() ||
      secondAttemptedRef.current ||
      !validCouncil ||
      validCouncil.schema_version !== "2.1.0"
    )
      return;
    if (!apiKey.current) {
      apiDialog.current?.showModal();
      return;
    }
    const stamp = version.current;
    await performSecondReview({
      baseline: validCouncil,
      source,
      filename,
      key: apiKey.current,
      isCurrent: () => mounted.current && version.current === stamp,
    });
  }

  function cancelSecondReview() {
    runGate.current.cancel();
    secondGeneration.current++;
    secondRequest.current?.abort();
    secondRequest.current = null;
    setSecondBusy(false);
    setSecondError(
      "Second Review cancelled. First-round findings remain available; no further second-round calls will start.",
    );
  }

  function cancel() {
    version.current++;
    runGate.current.cancel();
    setBusy(false);
    setError(
      "Review cancelled. Any completed Static Analysis results remain available.",
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
    <div
      className={`app-shell ${mode === "api" ? "council-mode" : ""} ${focused ? "workspace-focused" : ""}`}
    >
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
            <Link
              href="/documentation"
              target="_blank"
              rel="noopener noreferrer"
            >
              Documentation
            </Link>
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
            !busy &&
            !evaluating &&
            !secondBusy
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
                Static Analysis<span>On-device</span>
              </button>
              <button
                className={mode === "api" ? "selected" : ""}
                aria-pressed={mode === "api"}
                onClick={() => switchMode("api")}
              >
                <Icon name="layers" />
                Bedrock Review<span>3 models</span>
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

          {mode === "api" && (
            <CouncilStatus
              report={validCouncil}
              missingReport={missingReview}
              busy={busy}
              hasKey={hasKey}
              onConnect={() => apiDialog.current?.showModal()}
              promptVariant={promptVariant}
              onPromptChange={changePrompt}
              onEvaluate={() => evaluationDialog.current?.showModal()}
              evaluating={evaluating}
              blocked={secondBusy}
            />
          )}
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
                    className="upload-contract-button"
                    aria-label="Open Solidity file"
                    title="Open .sol file"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="upload" size={16} />
                    <span>Upload contract</span>
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
                  ref={sourceInput}
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
                  active={focusTarget?.evidence ?? active?.evidence}
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
                {busy || secondBusy ? (
                  <button
                    className="run-button running"
                    onClick={secondBusy ? cancelSecondReview : cancel}
                  >
                    <span className="spinner" />
                    Cancel Review
                  </button>
                ) : (
                  <button
                    className="run-button"
                    disabled={!source.trim() || evaluating || secondBusy}
                    onClick={() => void runAudit()}
                  >
                    <Icon
                      name={mode === "static" ? "scan" : "layers"}
                      size={17}
                    />
                    {mode === "static"
                      ? "Run Static Analysis"
                      : "Run Bedrock Review"}
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
                    Findings{" "}
                    <span>
                      {!showFindings && validCouncil
                        ? validCouncil.findings.length
                        : (showConsensus ? validCouncil : validReport)
                          ? findings.length
                          : "—"}
                    </span>
                  </h2>
                </div>
                <div className="report-buttons">
                  <button
                    className="icon-button"
                    aria-label="Download JSON report"
                    title="Download JSON"
                    disabled={!validReport || (showConsensus && !validCouncil)}
                    onClick={() => exportReport("json")}
                  >
                    <span>JSON</span>
                    <Icon name="download" size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Download Markdown report"
                    title="Download Markdown"
                    disabled={!validReport || (showConsensus && !validCouncil)}
                    onClick={() => exportReport("md")}
                  >
                    <span>MD</span>
                    <Icon name="download" size={14} />
                  </button>
                </div>
              </header>
              {mode === "api" && (
                <div
                  ref={reviewStages}
                  className="review-stages"
                  role="group"
                  aria-label="Review stages"
                >
                  {(
                    [
                      ["findings", "Findings"],
                      ["second", "Second Review"],
                      ["final", "Final Report"],
                    ] as const
                  ).map(([stage, label], index) => (
                    <button
                      key={stage}
                      aria-label={label}
                      data-review-stage={stage}
                      aria-controls="review-stage-content"
                      aria-current={reviewStage === stage ? "step" : undefined}
                      aria-pressed={reviewStage === stage}
                      disabled={
                        stage === "second"
                          ? !validCouncil ||
                            (!stages.secondReviewAvailable && !secondBusy)
                          : stage === "final"
                            ? !stages.finalReportAvailable
                            : false
                      }
                      onClick={() => selectReviewStage(stage)}
                    >
                      <span aria-hidden="true">{index + 1}</span>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {showFindings && (
                <>
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
                          {level !== "ALL" && (
                            <i className={level.toLowerCase()} />
                          )}
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
                  {mode === "api" && (
                    <details className="findings-options">
                      <summary>
                        Findings options <Icon name="chevron" size={12} />
                      </summary>
                      {mode === "api" && (
                        <div
                          className="result-view-switch"
                          role="group"
                          aria-label="Result source"
                        >
                          <button
                            aria-pressed={resultView === "consensus"}
                            onClick={() => changeResultView("consensus")}
                          >
                            Model findings{" "}
                            <span>{validCouncil?.findings.length ?? "—"}</span>
                          </button>
                          <button
                            aria-pressed={resultView === "static"}
                            onClick={() => changeResultView("static")}
                          >
                            Static baseline{" "}
                            <span>{validReport?.candidates.length ?? "—"}</span>
                          </button>
                        </div>
                      )}
                      {showConsensus && (
                        <div className="confidence-toolbar">
                          <label htmlFor="confidence-filter">
                            Model agreement
                          </label>
                          <select
                            id="confidence-filter"
                            value={confidence}
                            onChange={(event) =>
                              setConfidence(event.target.value)
                            }
                          >
                            <option value="ALL">All agreement levels</option>
                            <option value="HIGH">
                              High · 3-model agreement
                            </option>
                            <option value="MEDIUM">
                              Medium · 2-model agreement
                            </option>
                            <option value="LOW">Low · single model</option>
                          </select>
                          {!!validCouncil?.review_queue?.length && (
                            <button
                              className="review-queue-filter"
                              aria-pressed={reviewQueueOnly}
                              onClick={() =>
                                setReviewQueueOnly(!reviewQueueOnly)
                              }
                            >
                              Review queue <span>{reviewQueue.length}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </details>
                  )}
                </>
              )}
              <div
                ref={findingsView}
                id="review-stage-content"
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
                          ? "Three models are reviewing your contract"
                          : "Checking common code patterns"}
                      </strong>
                      <span>
                        {mode === "api"
                          ? "This may take a few minutes. You can stop the review at any time."
                          : "Static Analysis runs in this browser."}
                      </span>
                    </div>
                  </div>
                )}
                {mode === "api" && validCouncil && (
                  <div className={`consensus-summary ${validCouncil.status}`}>
                    <div className="summary-heading">
                      <span>
                        {completedModels} / {BEDROCK_MODELS.length} model
                        reviews completed
                      </span>
                      <details className="review-summary-details">
                        <summary>
                          Review details <Icon name="chevron" size={12} />
                        </summary>
                        <div>
                          <p>
                            First-round agreement counts independent model
                            findings; it is not an accuracy score. Missing
                            reviews do not count as agreement.
                          </p>
                          {validCouncil.execution && (
                            <p>
                              {validCouncil.execution.prompt_variant ===
                              "few-shot"
                                ? "Guided examples"
                                : "Standard prompt"}{" "}
                              · {validCouncil.execution.total_attempts} /{" "}
                              {validCouncil.models.length *
                                validCouncil.execution
                                  .max_attempts_per_model}{" "}
                              attempts used · {reviewQueue.length} findings in
                              the review queue.
                            </p>
                          )}
                          <p>
                            Expand a model above for its result, timing and
                            diagnostic details.
                          </p>
                        </div>
                      </details>
                    </div>
                    {validCouncil.status !== "completed" && (
                      <p className="coverage-caption">
                        {completedModels
                          ? "Partial model coverage. Available findings are retained."
                          : "No model review completed. Static Analysis remains available."}
                      </p>
                    )}
                  </div>
                )}
                {mode === "api" &&
                  reviewStage === "second" &&
                  validCouncil?.schema_version === "2.1.0" && (
                    <SecondReviewPanel
                      baseline={validCouncil}
                      report={secondReview}
                      busy={secondBusy}
                      attempted={secondAttempted}
                      blocked={busy || evaluating}
                      error={secondError}
                      onRun={() => void runSecondReview()}
                      onCancel={cancelSecondReview}
                      onExport={exportReport}
                      onFinalReport={() => selectReviewStage("final")}
                      onFindings={() => selectReviewStage("findings")}
                      onPrepareRun={() => {
                        if (apiKey.current) return true;
                        apiDialog.current?.showModal();
                        return false;
                      }}
                      onEvidence={(findingId, evidence) =>
                        focusCandidate(
                          findingId,
                          evidence.line_start,
                          false,
                          evidence,
                        )
                      }
                    />
                  )}
                {mode === "api" &&
                  reviewStage === "final" &&
                  stages.finalReportAvailable &&
                  validCouncil && (
                    <>
                      {!secondReview && (
                        <p className="stage-explanation">
                          {stages.finalReportReason}
                        </p>
                      )}
                      <FinalReportPanel
                        autoOpen
                        baseline={validCouncil}
                        secondRound={secondReview}
                        onExport={(format) => void exportReport(format)}
                        onEvidence={(findingId, evidence) =>
                          focusCandidate(
                            findingId,
                            evidence.line_start,
                            false,
                            evidence,
                          )
                        }
                      />
                    </>
                  )}
                {showFindings && (
                  <>
                    {showConsensus && !validCouncil && !busy ? (
                      <div className="empty-state">
                        {missingReview ? (
                          <>
                            <h3>No Bedrock report available</h3>
                            <p>
                              Select Run Bedrock Review to start a new review,
                              or view the static findings for this contract.
                            </p>
                            {validReport && (
                              <button
                                className="quiet-button"
                                onClick={() => changeResultView("static")}
                              >
                                View Static Analysis{" "}
                                <Icon name="arrow" size={14} />
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="mini-label">
                              THREE INDEPENDENT PERSPECTIVES
                            </span>
                            <h3>Ready for Bedrock Review</h3>
                            <p>
                              Select Run Bedrock Review to analyze this contract
                              with three models. Review the findings before
                              starting Second Review.
                            </p>
                          </>
                        )}
                      </div>
                    ) : showConsensus && validCouncil?.status === "failed" ? (
                      <div className="empty-state">
                        <h3>Model review unavailable</h3>
                        <p>
                          Check the errors for each model above.
                          <br />
                          Static Analysis results remain available.
                        </p>
                        <button
                          className="quiet-button"
                          onClick={() => changeResultView("static")}
                        >
                          View Static Analysis <Icon name="arrow" size={14} />
                        </button>
                      </div>
                    ) : !validReport && !busy ? (
                      <div className="empty-state">
                        <div className="empty-symbol">
                          <Icon name="scan" size={28} />
                        </div>
                        <h3>Ready for analysis</h3>
                        <p>Run an analysis to inspect this contract.</p>
                      </div>
                    ) : !busy && validReport && findings.length === 0 ? (
                      <div className="empty-state">
                        <div className="empty-symbol">
                          <Icon name="check" size={28} />
                        </div>
                        <h3>No candidates flagged</h3>
                        <p>
                          {showConsensus
                            ? "The completed models did not flag a source-bound candidate."
                            : "No matching patterns were found."}
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
                            setConfidence("ALL");
                            setReviewQueueOnly(false);
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
                                focusCandidate(
                                  item.id,
                                  item.evidence.line_start,
                                )
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
                                  {item.consensus
                                    ? `${item.consensus.agreement} / ${BEDROCK_MODELS.length} models`
                                    : "Static"}
                                </span>
                                <span className="finding-line">
                                  L{item.evidence.line_start}
                                </span>
                                <Icon name="chevron" size={15} />
                              </span>
                              <span className="finding-title">
                                <span>
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                {item.title}
                              </span>
                            </button>
                          </h3>
                          <div
                            className="finding-detail"
                            id={`detail-${item.id}`}
                            hidden={expanded !== item.id}
                          >
                            {item.consensus?.severity_disagreement && (
                              <div className="consensus-confidence">
                                <span className="disagreement-note">
                                  Severity differs across models
                                </span>
                              </div>
                            )}
                            <h4>Risk explanation</h4>
                            <p>{item.rationale}</p>
                            <h4>Recommended action</h4>
                            <p>{item.recommendation}</p>
                            <details className="finding-evidence-details">
                              <summary>
                                Source evidence{" "}
                                <Icon name="chevron" size={13} />
                              </summary>
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
                              <div className="finding-tags">
                                <span>{item.rule_id}</span>
                                <span>{item.category}</span>
                              </div>
                            </details>
                            {item.consensus && validCouncil && (
                              <ConsensusEvidence
                                finding={item.consensus}
                                report={validCouncil}
                                onEvidence={(evidence) =>
                                  focusCandidate(
                                    item.id,
                                    evidence.line_start,
                                    false,
                                    evidence,
                                  )
                                }
                              />
                            )}
                          </div>
                        </article>
                      ))
                    )}
                  </>
                )}
              </div>
              {mode === "api" &&
                validCouncil &&
                !busy &&
                !secondBusy &&
                reviewStage !== "final" && (
                  <div className="findings-next-action">
                    {reviewStage === "findings" &&
                    !stages.finalReportAvailable ? (
                      <button
                        className="second-review-button"
                        disabled={!stages.secondReviewAvailable}
                        onClick={() => selectReviewStage("second")}
                      >
                        Continue to Second Review{" "}
                        <Icon name="arrow" size={14} />
                      </button>
                    ) : stages.finalReportAvailable ? (
                      <button
                        className="second-review-button"
                        onClick={() => selectReviewStage("final")}
                      >
                        Continue to Final Report <Icon name="arrow" size={14} />
                      </button>
                    ) : null}
                  </div>
                )}
              <footer className="results-footer">
                <span>
                  <span
                    className={`result-dot ${busy ? "pulsing" : showConsensus && validCouncil && validCouncil.status !== "completed" ? "incomplete" : ""}`}
                  />
                  {secondBusy
                    ? "Second Review in progress"
                    : busy
                      ? "Review in progress"
                      : showConsensus
                        ? validCouncil
                          ? validCouncil.status === "completed"
                            ? secondReview
                              ? "Final Report available"
                              : "First-round findings ready"
                            : validCouncil.status === "partial"
                              ? "Results available · incomplete model coverage"
                              : "Model review failed"
                          : missingReview
                            ? "No validated model report"
                            : "Awaiting model review"
                        : validReport
                          ? validReport.execution === "recorded"
                            ? "Reference findings"
                            : "Static Analysis complete"
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
      <EvaluationPanel
        dialogRef={evaluationDialog}
        requestRef={evaluationRequest}
        promptVariant={promptVariant}
        onPromptChange={changePrompt}
        getApiKey={() => apiKey.current}
        hasKey={hasKey}
        analysisBusy={busy || secondBusy}
        onBusyChange={setEvaluating}
        onConnect={() => {
          evaluationDialog.current?.close();
          apiDialog.current?.showModal();
        }}
      />
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
              {validCouncil
                ? `${completedModels} of ${BEDROCK_MODELS.length} model reviews completed, with an independent static baseline. Findings remain candidates for human review.`
                : missingReview
                  ? "Only the static baseline is available. No validated model results were received."
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
                {validCouncil && (
                  <>
                    <div>
                      <dt>Orchestrator</dt>
                      <dd>{validCouncil.engine}</dd>
                    </div>
                    <div>
                      <dt>Coverage</dt>
                      <dd>
                        {completedModels} / {BEDROCK_MODELS.length} models ·{" "}
                        {validCouncil.status}
                      </dd>
                    </div>
                    {validCouncil.execution && (
                      <>
                        <div>
                          <dt>Prompt</dt>
                          <dd>
                            {validCouncil.execution.prompt_variant} ·{" "}
                            {validCouncil.execution.prompt_version}
                          </dd>
                        </div>
                        <div>
                          <dt>Execution policy</dt>
                          <dd>
                            {validCouncil.execution.policy_version} ·{" "}
                            {validCouncil.execution.total_attempts} /{" "}
                            {validCouncil.execution.max_attempts_per_model *
                              BEDROCK_MODELS.length}{" "}
                            attempts
                          </dd>
                        </div>
                        <div>
                          <dt>Time limits</dt>
                          <dd>
                            {validCouncil.execution.model_timeout_ms / 1000}{" "}
                            seconds per model ·{" "}
                            {validCouncil.execution.overall_timeout_ms / 1000}{" "}
                            seconds per run
                          </dd>
                        </div>
                      </>
                    )}
                    {validCouncil.models.map((model) => (
                      <div key={model.model_id}>
                        <dt>{model.label}</dt>
                        <dd>
                          {model.model_id}
                          <br />
                          {model.status} ·{" "}
                          {model.review
                            ? `${model.review.input_tokens ?? "—"} input / ${model.review.output_tokens ?? "—"} output tokens`
                            : "No validated review"}
                        </dd>
                      </div>
                    ))}
                    {secondReview && (
                      <>
                        <div>
                          <dt>Second review</dt>
                          <dd>
                            {secondReview.status} ·{" "}
                            {secondReview.execution.total_attempts} /{" "}
                            {secondReview.plan.model_ids.length *
                              secondReview.execution
                                .max_attempts_per_model}{" "}
                            additional attempts
                          </dd>
                        </div>
                        <div>
                          <dt>Peer-review prompt</dt>
                          <dd>{secondReview.prompt_version}</dd>
                        </div>
                        <div>
                          <dt>First-round record</dt>
                          <dd>{secondReview.baseline_sha256}</dd>
                        </div>
                      </>
                    )}
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
                  {BEDROCK_MODELS[0].label}, {BEDROCK_MODELS[1].label} and{" "}
                  {BEDROCK_MODELS[2].label} review the same source independently
                  through AWS Bedrock. Static findings remain a separate
                  baseline.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Validate and reconcile</h3>
                <p>
                  The orchestrator validates each response and its cited source,
                  groups related findings, and preserves each model&apos;s
                  reasoning. Agreement counts distinct models, not confidence in
                  correctness. Missing models and severity disagreements remain
                  visible in a review queue. Only the affected model retries a
                  recoverable failure, within the request and time limits.
                </p>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <h3>Reassess disputed findings</h3>
                <p>
                  An optional second round gives completed reviewers the source
                  evidence behind disputed candidates. Models can support a
                  claim, decline to support it, or remain uncertain. Their
                  original independent findings stay unchanged; peer-informed
                  opinions are recorded separately for human review.
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
          <div className="connection-council">
            <div className="connection-council-heading">
              <span className="eyebrow">REVIEW COUNCIL</span>
              <span className="connection-region">US · N. Virginia</span>
            </div>
            {BEDROCK_MODELS.map((model) => (
              <div className="connection-model-row" key={model.id}>
                <strong>{model.label}</strong>
                <span>{model.provider}</span>
              </div>
            ))}
          </div>
          <p>
            One Bedrock key authorizes all three model requests. Your AWS
            account must have access to each model. API analysis sends your key
            and source through this site&apos;s server to AWS.
          </p>
          <p>
            Use Static Analysis to keep source on this device.{" "}
            <a
              href="https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html"
              target="_blank"
              rel="noreferrer"
            >
              AWS data retention policy
            </a>
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
              ? "All three model reviews succeeded with this key"
              : hasKey
                ? validCouncil
                  ? `${completedModels} of ${BEDROCK_MODELS.length} models returned a valid review`
                  : "Key ready · AWS access not yet verified"
                : "No API key connected"}
            {hasKey && (
              <button className="quiet-button" onClick={clearKey}>
                Clear key
              </button>
            )}
          </div>
          <p className="connection-note">
            A run starts three model calls and allows up to{" "}
            {REVIEW_POLICY.max_attempts_per_model} attempts per model for
            recoverable service or response-validation errors, up to{" "}
            {REVIEW_POLICY.max_provider_requests} calls. Usage is billed to the
            AWS account associated with your key.
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
