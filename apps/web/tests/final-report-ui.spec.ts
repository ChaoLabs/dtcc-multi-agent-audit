import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import cases from "../src/generated/cases.json";
import { buildCouncilReport } from "../src/lib/orchestration";
import { buildSecondReviewReport } from "../src/lib/second-review";
import {
  syntheticBaseline,
  syntheticSecondReview,
} from "./second-review-fixtures";

// Playwright's TSX transform produces component-test descriptors, not React
// elements. Render the real component in an isolated Node process using the
// project's TypeScript React JSX transform; this does not launch a browser.
function renderReport(
  props: unknown,
  panel: "report" | "follow-up" | "council" = "report",
): string {
  return execFileSync(
    process.execPath,
    [
      "-e",
      `
    const fs = require("node:fs");
    const path = require("node:path");
    const Module = require("node:module");
    const ts = require("typescript");
    const resolve = Module._resolveFilename;
    Module._resolveFilename = function(name, parent, ...rest) {
      if (name.startsWith("@/")) name = path.join(process.cwd(), "src", name.slice(2));
      return resolve.call(this, name, parent, ...rest);
    };
    const compile = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, filename);
    require.extensions[".ts"] = compile;
    require.extensions[".tsx"] = compile;
    const { createElement } = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const Component = process.argv[1] === "follow-up"
      ? require("./src/components/second-review-panel.tsx").SecondReviewPanel
      : process.argv[1] === "council"
        ? require("./src/components/review-council.tsx").CouncilStatus
        : require("./src/components/final-report-panel.tsx").FinalReportPanel;
    const props = JSON.parse(fs.readFileSync(0, "utf8"));
    process.stdout.write(renderToStaticMarkup(createElement(Component, { ...props, onExport() {}, onEvidence() {}, onRun() {}, onCancel() {}, onConnect() {}, onPromptChange() {}, onEvaluate() {} })));
  `,
      panel,
    ],
    {
      cwd: resolve(__dirname, ".."),
      input: JSON.stringify(props),
      encoding: "utf8",
      timeout: 10_000,
    },
  );
}

const source = cases[0].report.input.source;

test("consolidated UI distinguishes original discovery from targeted second-round support", async () => {
  const baseline = await syntheticBaseline(source);
  const second = await syntheticSecondReview(source, baseline);
  const markup = renderReport({ baseline, secondRound: second });
  expect(markup).toContain("Models support");
  expect(markup.match(/Original finding retained/g)).toHaveLength(1);
  expect(markup.match(/Peer-informed judgment/g)).toHaveLength(2);
  expect(markup).toContain("Not reported");
  expect(markup).toContain("Not assigned");
  expect(markup).toContain("not an accuracy score");
  expect(markup.match(/Model-selected lines; excerpt retrieved/g)).toHaveLength(
    3,
  );
  expect(markup).not.toContain("Model-provided excerpt; exact match");
  expect(markup).not.toContain("Verified vulnerability");
});

test("historical consolidated UI does not relabel model quotations as resolved citations", async () => {
  const baseline = await syntheticBaseline(source);
  const second = await syntheticSecondReview(source, baseline);
  baseline.execution!.prompt_version = "independent-review-v2";
  second.policy_version = "targeted-peer-review-v2";
  second.prompt_version = "targeted-peer-review-v2";
  const markup = renderReport({ baseline, secondRound: second });
  expect(markup).not.toContain("Model-selected lines");
  expect(markup.match(/Model-provided excerpt; exact match/g)).toHaveLength(3);
});

test("consolidated UI keeps missing opinions unknown before a peer round", async () => {
  const baseline = await syntheticBaseline(source);
  const markup = renderReport({ baseline, secondRound: null });
  expect(markup).toContain("Second Review not run");
  expect(markup.match(/No accepted judgment/g)).toHaveLength(2);
  expect(markup).toContain("Unresolved");
  expect(markup).not.toContain("Does not support</td>");
  expect(markup.match(/<td>Not rated<\/td>/g)).toHaveLength(2);
});

test("model severity details retain conflicting original ratings until an accepted reassessment supersedes them", async () => {
  const reviewSource =
    'pragma solidity ^0.8.20;\ncontract C { function payout(address target) external { target.call(""); } }\n';
  const initial = await syntheticBaseline(reviewSource);
  const original = initial.models[0].review!.findings[0];
  const models = structuredClone(initial.models);
  for (const [index, model] of models.entries()) {
    model.review!.findings = [
      {
        ...structuredClone(original),
        category: "unchecked-call",
        title: "Unchecked payout result",
        proposed_severity: index === 2 ? "HIGH" : "LOW",
        evidence: {
          line_start: 2,
          line_end: 2,
          excerpt: reviewSource.split("\n")[1],
          validation: "source-bound",
        },
      },
    ];
  }
  models[2].review!.findings.push({
    ...structuredClone(models[2].review!.findings[0]),
    title: "Alternate severity for the same unchecked payment",
    proposed_severity: "LOW",
  });
  const baseline = await buildCouncilReport(
    models,
    reviewSource,
    3,
    initial.execution,
  );
  expect(baseline.findings).toHaveLength(1);
  expect(baseline.findings[0].members).toHaveLength(4);
  const complete = await syntheticSecondReview(reviewSource, baseline);
  const failedModels = structuredClone(complete.models);
  const failed = failedModels.find((model) => model.label === "Grok 4.7")!;
  failed.status = "failed";
  failed.review = null;
  failed.error = { code: "timeout", detail: "Model time limit reached." };
  failed.attempts[0].status = "failed";
  failed.attempts[0].error_code = "timeout";
  const partial = await buildSecondReviewReport(
    failedModels,
    reviewSource,
    baseline,
    3,
  );
  const partialMarkup = renderReport({ baseline, secondRound: partial });
  const grokRow = (markup: string) =>
    markup.match(/<tr><th scope="row">Grok 4\.7<\/th>[\s\S]*?<\/tr>/)![0];
  expect(partialMarkup).toContain('<th scope="col">Proposed severity</th>');
  expect(grokRow(partialMarkup)).toContain("Original finding retained");
  expect(grokRow(partialMarkup)).toContain(
    "HIGH / LOW<small>Original ratings differ</small>",
  );
  expect(partialMarkup).toContain('<details class="final-model-details">');

  const reassessed = structuredClone(complete.models);
  reassessed.find(
    (model) => model.label === "Grok 4.7",
  )!.review!.assessments[0].proposed_severity = "MEDIUM";
  const second = await buildSecondReviewReport(
    reassessed,
    reviewSource,
    baseline,
    3,
  );
  const markup = renderReport({ baseline, secondRound: second });
  expect(grokRow(markup)).toContain("Peer-informed judgment");
  expect(grokRow(markup)).toContain("<td>MEDIUM</td>");
  expect(grokRow(markup)).not.toContain("Original ratings differ");
  expect(grokRow(markup)).not.toContain("HIGH");
});

test("model-controlled report text is escaped and never interpreted as HTML", async () => {
  const baseline = await syntheticBaseline(source);
  baseline.findings[0].title = '<img src=x onerror="alert(1)">';
  baseline.findings[0].evidence.excerpt = "<script>credentialLeak()</script>";
  baseline.findings[0].rationale = '<img src=x onerror="riskLeak()">';
  baseline.findings[0].recommendation = "<script>actionLeak()</script>";
  const markup = renderReport({ baseline, secondRound: null });
  expect(markup).toContain("&lt;img");
  expect(markup).toContain("&lt;script&gt;credentialLeak()");
  expect(markup).not.toContain("<img src=x");
  expect(markup).not.toContain("<script>credentialLeak()");
  expect(markup).toContain("&lt;img src=x onerror=&quot;riskLeak()&quot;&gt;");
  expect(markup).toContain("&lt;script&gt;actionLeak()&lt;/script&gt;");
});

async function filteredInitialReview(
  code = "content_filtered",
  detail = "The provider stopped this review because of its content filter.",
) {
  const original = await syntheticBaseline(source);
  const models = structuredClone(original.models);
  const claude = models[1];
  claude.status = "failed";
  claude.review = null;
  claude.error = { code, detail };
  claude.attempts![0].status = "failed";
  claude.attempts![0].error_code = code;
  // A real severity disagreement gives both successful initial reviewers an
  // assigned follow-up; the failed model is excluded by the real planner.
  models[2].review!.findings = [
    {
      ...structuredClone(models[0].review!.findings[0]),
      proposed_severity: "HIGH",
    },
  ];
  return buildCouncilReport(models, source, 3, original.execution!);
}

test("report separates two completed follow-ups from missing initial coverage and gives a primary next step", async () => {
  const baseline = await filteredInitialReview();
  const second = await syntheticSecondReview(source, baseline);
  expect(second.status).toBe("completed");
  expect(second.plan.model_ids).toHaveLength(2);
  const markup = renderReport({ baseline, secondRound: second });
  const text = markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain("First round: 2 of 3 completed.");
  expect(text).toContain("Second round: 2 of 2 assigned reviews completed.");
  expect(text).toContain("Review coverage is incomplete");
  expect(text).toContain("Claude Opus 5.5: Content filtered.");
  expect(text).toContain("does not indicate an expired API key");
  expect(text).toContain("ask your AWS administrator or provider support");
  expect(text).not.toContain("All three independent reviews completed");
  expect(text).not.toContain("Models support");
  expect(markup).toMatch(
    /<p class="finding-next-step">Some models have no accepted judgment on this finding\./,
  );
  expect(markup.indexOf('class="finding-next-step"')).toBeLessThan(
    markup.indexOf('class="final-model-details"'),
  );
});

test("report keeps the model comparison collapsed while preserving original and follow-up provenance", async () => {
  const baseline = await syntheticBaseline(source);
  const second = await syntheticSecondReview(source, baseline);
  const markup = renderReport({ baseline, secondRound: second });
  expect(markup).toContain('<details class="final-model-details">');
  expect(markup).not.toMatch(
    /<details[^>]*class="final-model-details"[^>]*\bopen(?:=|\s|>)/,
  );
  expect(markup).toContain("Model judgments");
  expect(markup).toContain(`Finding ID: ${baseline.findings[0].id}`);
  expect(markup).toContain("Original finding retained");
  expect(markup).toContain("Peer-informed judgment");
  expect(markup).toContain("Source evidence and reasoning");
});

test("follow-up UI explains why a filtered initial model was not called even when assigned work completes", async () => {
  const baseline = await filteredInitialReview(
    "incomplete",
    "Claude Opus 5.5 did not complete the review. AWS stop reason: content_filtered. No partial result was accepted.",
  );
  const second = await syntheticSecondReview(source, baseline);
  const markup = renderReport(
    {
      baseline,
      report: second,
      busy: false,
      attempted: true,
      blocked: false,
      error: "",
    },
    "follow-up",
  );
  const text = markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain("2 of 3 independent reviews completed");
  expect(text).toContain(
    "Second Review complete · 2 of 2 assigned models completed",
  );
  expect(text).toContain(
    "Second-round completion does not replace missing first-round coverage.",
  );
  expect(text).toContain("First-round review unavailable");
  expect(text).toContain(
    "No second-round request was sent to this model because its independent review did not return a valid result.",
  );
  expect(text).toContain(
    "The model provider stopped this review because of its content filter.",
  );
  expect(markup).toContain('<details class="follow-up-limits">');
  expect(text).not.toContain("3 of 3 assigned models completed");
});

test("failed model text cannot inject HTML or replace primary failure guidance", async () => {
  const marker = '<img src=x onerror="sendSecrets()">';
  const baseline = await filteredInitialReview("content_filtered", marker);
  const second = await syntheticSecondReview(source, baseline);
  const reportMarkup = renderReport({ baseline, secondRound: second });
  expect(reportMarkup).not.toContain(marker);
  expect(reportMarkup).not.toContain("sendSecrets");
  expect(reportMarkup).toContain("Content filtered");
  const followUpMarkup = renderReport(
    {
      baseline,
      report: second,
      busy: false,
      attempted: true,
      blocked: false,
      error: "",
    },
    "follow-up",
  );
  expect(followUpMarkup).not.toContain(marker);
  expect(followUpMarkup).toContain(
    "&lt;img src=x onerror=&quot;sendSecrets()&quot;&gt;",
  );
  expect(followUpMarkup).toContain(
    "The model provider stopped this review because of its content filter.",
  );
  expect(followUpMarkup.indexOf("sendSecrets")).toBeGreaterThan(
    followUpMarkup.indexOf('<details class="review-technical-details">'),
  );
});

test("reviewer overview keeps diagnostic guidance in closed model details and escapes raw errors", async () => {
  const marker = '<img src=x onerror="sendSecrets()">';
  const report = await filteredInitialReview("content_filtered", marker);
  const markup = renderReport(
    {
      report,
      busy: false,
      hasKey: true,
      promptVariant: "baseline",
      evaluating: false,
    },
    "council",
  );
  // Coverage is summarized in Findings; model-specific diagnostics stay in
  // the closed model disclosure instead of flooding the primary workflow.
  expect(markup).not.toContain('class="review-coverage-notice"');
  expect(markup).toContain('<details class="council-model failed"');
  expect(markup).not.toMatch(
    /<details[^>]*class="council-model failed"[^>]*\bopen(?:=|\s|>)/,
  );
  expect(markup).toContain("Content filtered");
  expect(markup).toContain("does not indicate an expired API key");
  expect(markup).toContain("ask your AWS administrator or provider support");
  expect(markup).not.toContain(marker);
  expect(markup).toContain(
    "&lt;img src=x onerror=&quot;sendSecrets()&quot;&gt;",
  );
  expect(markup.indexOf("sendSecrets")).toBeGreaterThan(
    markup.indexOf('<details class="model-technical">'),
  );
});

test("reviewer overview keeps advanced options collapsed and preserves their controls", () => {
  const markup = renderReport(
    {
      report: null,
      busy: false,
      hasKey: false,
      promptVariant: "baseline",
      evaluating: false,
    },
    "council",
  );
  expect(markup).toContain('<details class="review-advanced-options">');
  expect(markup).not.toMatch(
    /<details[^>]*class="review-advanced-options"[^>]*\bopen(?:=|\s|>)/,
  );
  expect(markup).toContain("Review settings");
  expect(markup).toContain('id="review-prompt"');
  expect(markup).toContain("Execution limits");
  expect(markup).toContain("Validate 5 cases");
  expect(markup).toContain("Connect Bedrock");
  expect(markup).not.toContain('class="review-coverage-notice"');
});

test("professional terminology and collapsed evidence preserve a concise Second Review", async () => {
  const baseline = await syntheticBaseline(source);
  const report = await syntheticSecondReview(source, baseline);
  const markup = renderReport(
    {
      baseline,
      report,
      busy: false,
      attempted: true,
      blocked: false,
      error: "",
    },
    "follow-up",
  );
  expect(markup).toContain("Second Review");
  expect(markup).toContain("Independent discovery");
  expect(markup).toContain("Latest valid support");
  expect(markup).toContain("Model judgments and evidence");
  expect(markup).toContain('<details class="final-model-details">');
  expect(markup).not.toMatch(
    /<details[^>]*class="final-model-details"[^>]*\bopen(?:=|\s|>)/,
  );
  expect(markup).not.toMatch(
    /Quick Check|Quick check|AI Review|AI review|Follow-up review/,
  );
});

test("risk explanation and proposed action are visible before collapsed audit details", async () => {
  const baseline = await syntheticBaseline(source);
  const second = await syntheticSecondReview(source, baseline);
  const markup = renderReport({ baseline, secondRound: second });
  expect(markup).toContain('aria-label="Risk summary"');
  const explanation = markup.indexOf("Risk explanation");
  const action = markup.indexOf("Recommended action");
  const audit = markup.indexOf('<details class="final-model-details">');
  expect(explanation).toBeGreaterThan(-1);
  expect(action).toBeGreaterThan(explanation);
  expect(action).toBeLessThan(audit);
  expect(markup).toContain(baseline.findings[0].rationale);
  expect(markup).toContain(baseline.findings[0].recommendation);
  expect(markup).toContain("Latest valid opinion");
});

test("a second-round timeout remains amber without erasing earlier support or severity", async () => {
  const original = await syntheticBaseline(source);
  const models = structuredClone(original.models);
  models[1].review!.findings = structuredClone(models[0].review!.findings);
  models[2].review!.findings = structuredClone(models[0].review!.findings);
  models[2].review!.findings[0].proposed_severity = "HIGH";
  const baseline = await buildCouncilReport(
    models,
    source,
    3,
    original.execution!,
  );
  const complete = await syntheticSecondReview(source, baseline);
  const secondModels = structuredClone(complete.models);
  const grok = secondModels.find((model) => model.label === "Grok 4.7")!;
  grok.status = "failed";
  grok.review = null;
  grok.error = { code: "timeout", detail: "Second Review time limit reached." };
  grok.elapsed_ms = 180000;
  grok.attempts = [
    {
      attempt: 1,
      status: "failed",
      elapsed_ms: 180000,
      error_code: "timeout",
      retry_delay_ms: 0,
    },
  ];
  const second = await buildSecondReviewReport(
    secondModels,
    source,
    baseline,
    180000,
  );
  const markup = renderReport({ baseline, secondRound: second });
  const text = markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(markup).toContain('class="report-coverage-summary partial"');
  expect(text).toContain("Review coverage is incomplete");
  expect(text).toContain("First round: 3 of 3 completed.");
  expect(text).toContain("Second round: 2 of 3 assigned reviews completed.");
  expect(text).toContain(
    "3 of 3 models support this finding. Includes retained first-round support.",
  );
  expect(text).toContain("Second Review remains incomplete for Grok 4.7.");
  expect(text).toContain("Valid first-round support is retained.");
  expect(text).toContain("HIGH · severity disputed");
  expect(markup).not.toContain("Review coverage complete</strong>");
  const secondMarkup = renderReport(
    {
      baseline,
      report: second,
      busy: false,
      attempted: true,
      blocked: false,
      error: "",
    },
    "follow-up",
  );
  const secondText = secondMarkup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(secondText).toContain(
    "Partial Second Review · 2 of 3 assigned models completed",
  );
  expect(secondText).toContain("3 of 3 models support this finding");
  expect(secondText).toContain(
    "No accepted Second Review response from Grok 4.7.",
  );
  expect(secondText).toContain("Original finding retained");
  expect(secondText).not.toContain("was not assigned a peer-miss reassessment");
});
