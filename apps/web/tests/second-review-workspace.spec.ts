import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import cases from "../src/generated/cases.json";
import { BEDROCK, BEDROCK_MODELS } from "../src/lib/bedrock-config";
import {
  buildCouncilReport,
  type CouncilReport,
  type ModelRun,
} from "../src/lib/orchestration";
import {
  POLICY_VERSION,
  PROMPT_VERSION,
  REVIEW_POLICY,
} from "../src/lib/review-policy";
import {
  buildSecondReviewPlan,
  buildSecondReviewReport,
  type SecondReviewAssessment,
  type SecondReviewModelRun,
} from "../src/lib/second-review";
import { analyzeStatic } from "../src/lib/static-analysis";
import {
  syntheticBaseline,
  syntheticSecondReview,
} from "./second-review-fixtures";

const production = "http://127.0.0.1:3100";
const key = "bedrock-api-key-SYNTHETIC_SECOND_REVIEW_BROWSER";
const { filename, source } = cases[0].report.input;

async function baselineFixture(
  options: {
    completeAgreement?: boolean;
    oneReviewer?: boolean;
    filteredReviewer?: boolean;
  } = {},
) {
  const staticReport = await analyzeStatic(filename, source);
  const candidate = staticReport.candidates[0];
  const finding = {
    title: candidate.title,
    category: "reentrancy",
    proposed_severity: candidate.proposed_severity,
    rationale: candidate.rationale,
    recommendation: candidate.recommendation,
    evidence: candidate.evidence,
  };
  const models: ModelRun[] = BEDROCK_MODELS.map((model, index) => {
    const filtered = !!options.filteredReviewer && index === 1;
    const failed = (!!options.oneReviewer && index > 0) || filtered;
    const errorCode = filtered ? "content_filtered" : "bedrock_access";
    return {
      model_id: model.id,
      label: model.label,
      status: failed ? "failed" : "succeeded",
      elapsed_ms: 10,
      error: failed
        ? {
            code: errorCode,
            detail: filtered
              ? "AWS stop reason: content_filtered. Synthetic provider filtering."
              : "Synthetic access failure.",
          }
        : null,
      attempts: [
        {
          attempt: 1,
          status: failed ? "failed" : "succeeded",
          elapsed_ms: 10,
          error_code: failed ? errorCode : null,
          retry_delay_ms: 0,
        },
      ],
      review: failed
        ? null
        : {
            provider: "aws-bedrock",
            model_id: model.id,
            region: BEDROCK.region,
            protocol: BEDROCK.protocol,
            source_sha256: staticReport.source_sha256,
            created_at: new Date().toISOString(),
            elapsed_ms: 10,
            input_tokens: 200,
            output_tokens: 80,
            summary:
              "Synthetic independent review for browser regression tests.",
            findings: index === 0 || options.completeAgreement ? [finding] : [],
          },
    };
  });
  return buildCouncilReport(models, source, 12, {
    policy_version: POLICY_VERSION,
    prompt_variant: "baseline",
    prompt_version: PROMPT_VERSION,
    max_attempts_per_model: REVIEW_POLICY.max_attempts_per_model,
    model_timeout_ms: REVIEW_POLICY.model_timeout_ms,
    overall_timeout_ms: REVIEW_POLICY.overall_timeout_ms,
    total_attempts: 3,
  });
}

async function secondFixture(
  baseline: CouncilReport,
  dispositions: (SecondReviewAssessment["verdict"] | null)[] = [
    "supported",
    "supported",
    "supported",
  ],
) {
  const plan = buildSecondReviewPlan(baseline);
  const models: SecondReviewModelRun[] = plan.model_ids.map((id) => {
    const index = BEDROCK_MODELS.findIndex((model) => model.id === id);
    const model = BEDROCK_MODELS[index];
    const verdict = dispositions[index];
    return {
      model_id: id,
      label: model.label,
      status: verdict ? "succeeded" : "failed",
      elapsed_ms: 14,
      attempts: [
        {
          attempt: 1,
          status: verdict ? "succeeded" : "failed",
          elapsed_ms: 14,
          error_code: verdict ? null : "timeout",
          retry_delay_ms: 0,
        },
      ],
      error: verdict
        ? null
        : {
            code: "timeout",
            detail: "Synthetic bounded second-review timeout.",
          },
      review: !verdict
        ? null
        : {
            provider: "aws-bedrock",
            model_id: id,
            region: BEDROCK.region,
            protocol: BEDROCK.protocol,
            source_sha256: baseline.source_sha256,
            created_at: new Date().toISOString(),
            elapsed_ms: 14,
            input_tokens: 350,
            output_tokens: 120,
            summary:
              "Synthetic peer-informed reassessment; no live provider call.",
            assessments: plan.candidate_ids.map((findingId) => ({
              finding_id: findingId,
              verdict,
              proposed_severity: verdict === "supported" ? "HIGH" : null,
              rationale: `Evidence was reconsidered; this reviewer marked the candidate ${verdict}.`,
              evidence: baseline.findings.find(
                (finding) => finding.id === findingId,
              )!.evidence,
            })),
          },
    };
  });
  return buildSecondReviewReport(models, source, baseline, 18);
}

async function connectApi(page: Page) {
  await page.goto(production);
  await page.getByRole("button", { name: /^Bedrock Review/ }).click();
  await page.getByLabel("Bedrock API key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Use API key", exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "Include follow-up review",
      exact: true,
    }),
  ).toHaveCount(0);
}

async function enterApi(page: Page) {
  await connectApi(page);
  await page
    .getByRole("button", { name: "Run Bedrock Review", exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Review stages", exact: true })
      .getByRole("button", { name: "Findings", exact: true }),
  ).toHaveAttribute("aria-current", "step");
  await expect(page.locator(".council-model.succeeded")).not.toHaveCount(0);
}

async function beginSecondReview(page: Page) {
  await page
    .getByRole("group", { name: "Review stages", exact: true })
    .getByRole("button", { name: "Second Review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run Second Review", exact: true })
    .click();
}

async function selectFinalReport(page: Page) {
  await page
    .getByRole("group", { name: "Review stages", exact: true })
    .getByRole("button", { name: "Final Report", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Final Report", exact: true }),
  ).toBeVisible();
}

async function returnToFindings(page: Page) {
  await page
    .getByRole("dialog", { name: "Second Review", exact: true })
    .getByRole("button", { name: "Close Second Review", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Review stages", exact: true })
    .getByRole("button", { name: "Findings", exact: true })
    .click();
}

async function selectSecondStage(page: Page) {
  await page
    .getByRole("group", { name: "Review stages", exact: true })
    .getByRole("button", { name: "Second Review", exact: true })
    .click();
}

async function download(page: Page, name = "Download JSON report") {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}

test("Findings precede manual Second Review and only then unlock the Final Report", async ({
  page,
}) => {
  const baseline = await baselineFixture();
  const second = await secondFixture(baseline);
  const calls: string[] = [];
  await page.route("**/api/reviews", async (route) => {
    calls.push("first");
    await route.fulfill({ json: baseline });
  });
  await page.route("**/api/reviews/second-round", async (route) => {
    calls.push("second");
    expect(route.request().postDataJSON()).toEqual({
      api_key: key,
      filename,
      source,
      baseline,
    });
    await route.fulfill({ json: second });
  });
  await enterApi(page);
  const stages = page.getByRole("group", {
    name: "Review stages",
    exact: true,
  });
  await expect(
    stages.getByRole("button", { name: "Findings", exact: true }),
  ).toHaveAttribute("aria-current", "step");
  await expect(
    stages.getByRole("button", { name: "Final Report", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".finding")).toHaveCount(1);
  expect(calls).toEqual(["first"]);
  await expect(page.locator(".findings-options")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator(".review-summary-details")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(
    page.getByRole("button", { name: "Open Final Report", exact: true }),
  ).toHaveCount(0);
  const firstExport = await download(page);
  expect(firstExport.council).toEqual(baseline);
  expect(firstExport.final_report).toBeUndefined();
  await stages
    .getByRole("button", { name: "Second Review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Run Second Review", exact: true }),
  ).toBeEnabled();
  expect(calls).toEqual(["first"]); // Navigation never dispatches a paid request.
  await page
    .getByRole("button", { name: "Run Second Review", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Second Review",
    exact: true,
  });
  await expect(review.locator(".second-review-status")).toContainText(
    "2 of 2 assigned models completed",
  );
  await review
    .getByRole("button", { name: "View Final Report", exact: true })
    .click();
  await expect(
    stages.getByRole("button", { name: "Final Report", exact: true }),
  ).toHaveAttribute("aria-current", "step");
  await expect(
    page.getByRole("dialog", { name: "Final Report", exact: true }),
  ).toBeVisible();
  const report = page.getByRole("dialog", {
    name: "Final Report",
    exact: true,
  });
  await expect(
    report.getByRole("region", { name: "Review coverage" }),
  ).toContainText("2 of 2 assigned reviews completed");
  await report
    .getByRole("button", { name: "Close Final Report", exact: true })
    .click();
  const data = await download(page);
  expect(data.first_round).toEqual(baseline);
  expect(data.second_round).toEqual(second);
  expect(JSON.stringify(data)).not.toContain(key);
  expect(calls).toEqual(["first", "second"]);
});

test("browsing findings and second-review settings never starts an additional request", async ({
  page,
}) => {
  const baseline = await baselineFixture();
  const calls: string[] = [];
  await page.route("**/api/reviews", async (route) => {
    calls.push("first");
    await route.fulfill({ json: baseline });
  });
  await page.route("**/api/reviews/second-round", async (route) => {
    calls.push("second");
    await route.abort();
  });
  await enterApi(page);
  const stages = page.getByRole("group", {
    name: "Review stages",
    exact: true,
  });
  await stages
    .getByRole("button", { name: "Second Review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Run Second Review", exact: true }),
  ).toBeEnabled();
  await stages.getByRole("button", { name: "Findings", exact: true }).click();
  await expect(page.locator(".finding")).toHaveCount(1);
  const data = await download(page);
  expect(data.council).toEqual(baseline);
  expect(data.second_round).toBeUndefined();
  expect(data.final_report).toBeUndefined();
  expect(calls).toEqual(["first"]);
});

test("rapid starts dispatch once and cancelling Bedrock Review never starts Second Review", async ({
  page,
}) => {
  const baseline = await baselineFixture();
  const calls: string[] = [];
  let release: () => void = () => {};
  let started: () => void = () => {};
  let finished: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const settled = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route("**/api/reviews", async (route) => {
    calls.push("first");
    started();
    await held;
    await route.fulfill({ json: baseline }).catch(() => {});
    finished();
  });
  await page.route("**/api/reviews/second-round", async (route) => {
    calls.push("follow-up");
    await route.abort();
  });
  await connectApi(page);
  // Dispatch twice in one browser task to exercise the synchronous run guard.
  await page
    .getByRole("button", { name: "Run Bedrock Review", exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await entered;
  await page
    .getByRole("button", { name: "Cancel Review", exact: true })
    .click();
  release();
  await settled;
  await expect(
    page.getByRole("button", { name: "Run Bedrock Review", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".consensus-summary")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View Second Review", exact: true }),
  ).toHaveCount(0);
  expect(calls).toEqual(["first"]);
});

test("provider filtering remains explicit when available models complete manual Second Review", async ({
  page,
}) => {
  const baseline = await baselineFixture({ filteredReviewer: true });
  const second = await secondFixture(baseline);
  const calls: string[] = [];
  await page.route("**/api/reviews", async (route) => {
    calls.push("first");
    await route.fulfill({ json: baseline });
  });
  await page.route("**/api/reviews/second-round", async (route) => {
    calls.push("follow-up");
    await route.fulfill({ json: second });
  });
  await enterApi(page);
  expect(calls).toEqual(["first"]);
  await expect(page.locator(".consensus-summary")).toContainText(
    "2 / 3 model reviews completed",
  );
  const filtered = page.locator(".council-model.failed");
  await filtered.locator(":scope > summary").click();
  await expect(filtered).toContainText("Content filtered");
  await expect(filtered).toContainText("does not indicate an expired API key");
  await beginSecondReview(page);
  const followUp = page.getByRole("dialog", {
    name: "Second Review",
    exact: true,
  });
  await expect(followUp.locator(".second-review-status")).toContainText(
    "1 of 1 assigned models completed",
  );
  await expect(
    followUp.getByText("2 of 3 independent reviews completed", { exact: true }),
  ).toBeVisible();
  await expect(
    followUp.getByText("First-round review unavailable", { exact: true }),
  ).toBeVisible();
  await returnToFindings(page);
  await selectFinalReport(page);
  const report = page.getByRole("dialog", {
    name: "Final Report",
    exact: true,
  });
  await expect(
    report.getByRole("region", { name: "Review coverage" }),
  ).toContainText("First round: 2 of 3 completed.");
  await expect(
    report.getByRole("region", { name: "Review coverage" }),
  ).toContainText(
    "Second-round completion does not replace a missing first-round review.",
  );
  await expect(report.locator(".second-verdict")).toHaveText(
    "Unresolved or disputed",
  );
  expect(calls).toEqual(["first", "follow-up"]);
});

test("second review preserves independent support, exposes evidence, and exports both rounds without keys", async ({
  page,
}, testInfo) => {
  const baseline = await baselineFixture();
  const second = await secondFixture(baseline);
  let requests = 0;
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: baseline }),
  );
  await page.route("**/api/reviews/second-round", async (route) => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({
      api_key: key,
      filename,
      source,
      baseline,
    });
    await route.fulfill({ json: second });
  });
  await enterApi(page);
  await expect(page.locator(".finding-origin")).toHaveText("1 / 3 models");
  await beginSecondReview(page);
  const dialog = page.getByRole("dialog", {
    name: "Second Review",
    exact: true,
  });
  await expect(dialog.getByText(/Second Review complete/)).toBeVisible();
  await expect(dialog.getByText("Reassessed", { exact: true })).toHaveCount(2);
  await dialog.evaluate((node) => node.scrollTo({ top: 0 }));
  await page.screenshot({
    path: testInfo.outputPath("second-review-overview.png"),
  });
  await expect(
    dialog.getByText("Independent discovery").locator("strong"),
  ).toHaveText("1 / 3");
  await expect(
    dialog.getByText("Latest valid support").locator("strong"),
  ).toHaveText("3 / 3");
  await dialog.locator(".final-model-details > summary").click();
  await dialog.locator(".second-assessment").nth(1).locator("summary").click();
  await expect(
    dialog
      .locator(".second-assessment")
      .nth(1)
      .getByText("First round: not reported", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("second-review.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  const data = await download(page, "Export JSON");
  expect(data.first_round).toEqual(baseline);
  expect(data.second_round).toEqual(second);
  expect(data.static_report.input.source).toBe(source);
  expect(JSON.stringify(data)).not.toContain(key);
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain(key);
  await dialog
    .getByRole("button", { name: "Close Second Review", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Review stages", exact: true })
    .getByRole("button", { name: "Findings", exact: true })
    .click();
  await expect(page.locator(".finding-origin")).toHaveText("1 / 3 models");
  await selectSecondStage(page);
  await page
    .getByRole("button", { name: "View Second Review", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  expect(requests).toBe(1);
  await expect(
    dialog.getByRole("button", { name: "Run Second Review", exact: true }),
  ).toHaveCount(0);
});

test("partial second review stays unresolved and never erases the independent finding", async ({
  page,
}) => {
  const baseline = await baselineFixture();
  const second = await secondFixture(baseline, [
    "supported",
    "uncertain",
    null,
  ]);
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: baseline }),
  );
  await page.route("**/api/reviews/second-round", (route) =>
    route.fulfill({ json: second }),
  );
  await enterApi(page);
  await beginSecondReview(page);
  const dialog = page.getByRole("dialog", {
    name: "Second Review",
    exact: true,
  });
  await expect(dialog.getByText(/Partial Second Review/)).toBeVisible();
  await expect(
    dialog.getByText("Reassessment incomplete", { exact: true }),
  ).toBeVisible();
  await dialog.locator(".final-model-details > summary").click();
  await expect(dialog.getByText("Uncertain", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("Time limit reached", { exact: true }),
  ).toBeVisible();
  await returnToFindings(page);
  const data = await download(page);
  expect(data.first_round.findings).toEqual(baseline.findings);
  expect(data.second_round.status).toBe("partial");
});

test("peer rejection remains separate from the original discoverer and stays unresolved", async ({
  page,
}) => {
  const baseline = await baselineFixture();
  const second = await secondFixture(baseline, [
    "not_supported",
    "not_supported",
    "not_supported",
  ]);
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: baseline }),
  );
  await page.route("**/api/reviews/second-round", (route) =>
    route.fulfill({ json: second }),
  );
  await enterApi(page);
  await beginSecondReview(page);
  const dialog = page.getByRole("dialog", {
    name: "Second Review",
    exact: true,
  });
  await expect(dialog.locator(".second-verdict")).toHaveText("Unresolved");
  await expect(
    dialog.getByText("Latest valid support").locator("strong"),
  ).toHaveText("1 / 3");
  await returnToFindings(page);
  await expect(
    page.getByRole("button", { name: new RegExp(baseline.findings[0].title) }),
  ).toBeVisible();
  await expect(page.locator(".finding-origin")).toHaveText("1 / 3 models");
});

test("cancelling second review discards late output, retains round one, and prevents another second-round call", async ({
  page,
}) => {
  const baseline = await baselineFixture();
  const second = await secondFixture(baseline);
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: baseline }),
  );
  await page.route("**/api/reviews/second-round", async (route) => {
    requests++;
    await pending;
    await route.fulfill({ json: second }).catch(() => {});
  });
  await enterApi(page);
  await beginSecondReview(page);
  const dialog = page.getByRole("dialog", {
    name: "Second Review",
    exact: true,
  });
  await expect(dialog.getByText("Reviewing 1 findings")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Cancel Second Review", exact: true })
    .click();
  release();
  await dialog
    .getByRole("button", { name: "Return to Findings", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const stages = page.getByRole("group", {
    name: "Review stages",
    exact: true,
  });
  const findingsStage = stages.getByRole("button", {
    name: "Findings",
    exact: true,
  });
  await expect(findingsStage).toHaveAttribute("aria-current", "step");
  await expect(findingsStage).toBeFocused();
  await expect(
    page.getByRole("button", { name: new RegExp(baseline.findings[0].title) }),
  ).toBeVisible();
  await expect(
    stages.getByRole("button", { name: "Final Report", exact: true }),
  ).toBeDisabled();
  await selectSecondStage(page);
  await expect(
    page.getByRole("button", { name: "Second Review attempted" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Run Bedrock Review", exact: true }),
  ).toBeEnabled();
  const data = await download(page);
  expect(data.council).toEqual(baseline);
  expect(data.final_report).toBeUndefined();
  await expect(
    page
      .getByRole("group", { name: "Review stages", exact: true })
      .getByRole("button", { name: "Final Report", exact: true }),
  ).toBeDisabled();
  expect(JSON.stringify(data)).not.toContain("peer-informed-reassessment");
  expect(requests).toBe(1);
});

test("replacing a key preserves reports while changing source removes them", async ({
  page,
}) => {
  const baseline = await baselineFixture();
  const second = await secondFixture(baseline);
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: baseline }),
  );
  await page.route("**/api/reviews/second-round", (route) =>
    route.fulfill({ json: second }),
  );
  await enterApi(page);
  await beginSecondReview(page);
  const dialog = page.getByRole("dialog", {
    name: "Second Review",
    exact: true,
  });
  await expect(dialog.getByText(/Second Review complete/)).toBeVisible();
  await returnToFindings(page);
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await page
    .getByLabel("Bedrock API key", { exact: true })
    .fill("bedrock-api-key-REPLACEMENT_SYNTHETIC");
  await page
    .getByRole("button", { name: "Replace API key", exact: true })
    .click();
  await selectSecondStage(page);
  await expect(
    page.getByRole("button", { name: "View Second Review", exact: true }),
  ).toBeVisible();
  const retained = await download(page);
  expect(retained.first_round).toEqual(baseline);
  expect(retained.second_round).toEqual(second);
  await page
    .getByRole("button", { name: "Run Bedrock Review", exact: true })
    .click();
  await beginSecondReview(page);
  await expect(dialog.getByText(/Second Review complete/)).toBeVisible();
  await returnToFindings(page);
  await page.getByRole("button", { name: "New contract", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "View Second Review", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download JSON report", exact: true }),
  ).toBeDisabled();
});

test("a tampered second-round summary is rejected and never replaces the independent report", async ({
  page,
}) => {
  const baseline = await baselineFixture();
  const second = await secondFixture(baseline);
  const tampered = { ...second, baseline_sha256: "0".repeat(64) };
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: baseline }),
  );
  await page.route("**/api/reviews/second-round", (route) =>
    route.fulfill({ json: tampered }),
  );
  await enterApi(page);
  await beginSecondReview(page);
  const dialog = page.getByRole("dialog", {
    name: "Second Review",
    exact: true,
  });
  await expect(
    dialog.getByText(
      "Second Review stopped. First-round findings are retained.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(dialog.locator(".second-review-findings")).toHaveCount(0);
  await returnToFindings(page);
  await expect(page.locator(".finding-origin")).toHaveText("1 / 3 models");
  expect(JSON.stringify(await download(page))).not.toContain(
    "peer-informed-reassessment",
  );
});

for (const variant of ["completeAgreement", "oneReviewer"] as const) {
  test(`second round is unavailable with ${variant}`, async ({ page }) => {
    const baseline = await baselineFixture({ [variant]: true });
    let requests = 0;
    await page.route("**/api/reviews", (route) =>
      route.fulfill({ json: baseline }),
    );
    await page.route("**/api/reviews/second-round", (route) => {
      requests++;
      return route.abort();
    });
    await enterApi(page);
    await selectSecondStage(page);
    await expect(
      page.getByRole("button", { name: "Run Second Review", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        variant === "oneReviewer"
          ? "Second Review requires at least two completed independent reviews. First-round findings remain available."
          : "No eligible second-round assignments. Proceed to the Final Report.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "Review stages", exact: true })
        .getByRole("button", { name: "Final Report", exact: true }),
    ).toBeEnabled();
    expect(requests).toBe(0);
  });
}

test("paired five-case validation exports exact before-and-after records with a separate opinion-change summary", async ({
  page,
}, testInfo) => {
  const originals = new Map<string, CouncilReport>();
  const calls: string[] = [];
  await page.route("**/api/reviews", async (route) => {
    const body = route.request().postDataJSON();
    calls.push("first");
    const report = await syntheticBaseline(body.source, body.prompt_variant);
    originals.set(body.source, report);
    await route.fulfill({ json: report });
  });
  await page.route("**/api/reviews/second-round", async (route) => {
    const body = route.request().postDataJSON();
    calls.push("second");
    expect(body.baseline).toEqual(originals.get(body.source));
    await route.fulfill({
      json: await syntheticSecondReview(body.source, body.baseline),
    });
  });
  await page.goto(production);
  await page.getByRole("button", { name: /^Bedrock Review/ }).click();
  await page.getByLabel("Bedrock API key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Use API key", exact: true }).click();
  await page.locator(".review-advanced-options > summary").click();
  await page
    .getByRole("button", { name: "Validate 5 cases", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Five-contract validation",
    exact: true,
  });
  await dialog.getByRole("checkbox", { name: /Include second review/ }).check();
  await expect(dialog.locator(".validation-budget")).toContainText("60 max");
  await expect(dialog.locator(".validation-budget")).toContainText("40 min");
  await dialog.evaluate((node) => node.scrollTo({ top: 0 }));
  await page.screenshot({
    path: testInfo.outputPath("paired-validation-setup.png"),
  });
  await dialog
    .getByRole("button", { name: "Run five-case validation", exact: true })
    .click();
  await expect(dialog.locator(".validation-status")).toContainText(
    "5 / 5 cases with results · completed",
  );
  const paired = dialog.getByRole("region", {
    name: "Paired review comparison",
  });
  await expect(
    paired
      .getByText("Peer-informed model reviews")
      .locator("..")
      .locator("strong"),
  ).toHaveText("15 / 15");
  await expect(
    paired
      .getByText("New supporting assessments")
      .locator("..")
      .locator("strong"),
  ).toHaveText("10");
  await paired.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("paired-validation-results.png"),
  });
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  const data = await download(page, "Download validation JSON");
  expect(calls).toEqual(
    Array.from({ length: 5 }, () => ["first", "second"]).flat(),
  );
  expect(data.review_mode).toBe("paired-second-review");
  expect(data.metrics.successful_model_reviews).toBe(15);
  expect(data.metrics.second_review.successful_model_reviews).toBe(15);
  expect(data.cases).toHaveLength(5);
  for (const entry of data.cases) {
    const fixture = cases.find((item) => item.id === entry.id)!;
    expect(entry.report).toEqual(originals.get(fixture.report.input.source));
    expect(entry.report.findings[0].agreement).toBe(1);
    expect(entry.second_review.findings[0].supporting_models).toHaveLength(3);
  }
  expect(JSON.stringify(data)).not.toContain(key);
});

test("closing the second-review window minimizes work and retains the eventual report", async ({
  page,
}) => {
  const baseline = await baselineFixture();
  const second = await secondFixture(baseline);
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: baseline }),
  );
  await page.route("**/api/reviews/second-round", async (route) => {
    requests++;
    await pending;
    await route.fulfill({ json: second });
  });
  await enterApi(page);
  await beginSecondReview(page);
  const dialog = page.getByRole("dialog", {
    name: "Second Review",
    exact: true,
  });
  await expect(dialog.getByText("Reviewing 1 findings")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close Second Review", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "View Second Review", exact: true }),
  ).toBeEnabled();
  release();
  await page
    .getByRole("button", { name: "View Second Review", exact: true })
    .click();
  await expect(dialog.getByText(/Second Review complete/)).toBeVisible();
  expect(requests).toBe(1);
  await returnToFindings(page);
  await selectFinalReport(page);
  const finalDialog = page.getByRole("dialog", {
    name: "Final Report",
    exact: true,
  });
  await expect(
    finalDialog.getByText("Models support", { exact: true }),
  ).toBeVisible();
  await finalDialog.locator(".final-model-details > summary").click();
  await expect(
    finalDialog.getByText("Original finding retained", { exact: true }),
  ).toHaveCount(1);
  await expect(
    finalDialog.getByText("Peer-informed judgment", { exact: true }),
  ).toHaveCount(2);
});

test("an explicit zero-dispatch admission rejection allows one manual recovery and never loops", async ({
  page,
}) => {
  const baseline = await baselineFixture();
  let requests = 0;
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: baseline }),
  );
  await page.route("**/api/reviews/second-round", (route) => {
    requests++;
    return route.fulfill({
      status: 429,
      json: { code: "busy", provider_calls_started: 0, retry_safe: true },
    });
  });
  await enterApi(page);
  const dialog = page.getByRole("dialog", {
    name: "Second Review",
    exact: true,
  });
  await beginSecondReview(page);
  await expect(dialog.getByText(/no model calls were started/)).toBeVisible();
  await returnToFindings(page);
  expect(requests).toBe(1);
  await beginSecondReview(page);
  await expect(
    dialog.getByText(/admission retry limit is reached/),
  ).toBeVisible();
  await returnToFindings(page);
  await selectSecondStage(page);
  await expect(
    page.getByRole("button", {
      name: "Second Review attempted",
      exact: true,
    }),
  ).toBeDisabled();
  expect(requests).toBe(2);
  const data = await download(page);
  expect(data.council).toEqual(baseline);
  expect(data.second_round).toBeUndefined();
  expect(data.final_report).toBeUndefined();
  await expect(
    page
      .getByRole("group", { name: "Review stages", exact: true })
      .getByRole("button", { name: "Final Report", exact: true }),
  ).toBeDisabled();
});

test("a cleared key opens only connection settings and never starts Second Review until explicitly retried", async ({
  page,
}) => {
  const baseline = await baselineFixture();
  const second = await secondFixture(baseline);
  const replacementKey = "bedrock-api-key-SYNTHETIC_RECONNECTED_SECOND_REVIEW";
  let firstRequests = 0;
  let secondRequests = 0;
  await page.route("**/api/reviews", async (route) => {
    firstRequests++;
    await route.fulfill({ json: baseline });
  });
  await page.route("**/api/reviews/second-round", async (route) => {
    secondRequests++;
    expect(route.request().postDataJSON()).toEqual({
      api_key: replacementKey,
      filename,
      source,
      baseline,
    });
    await route.fulfill({ json: second });
  });
  await enterApi(page);
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", {
    name: "AWS Bedrock",
    exact: true,
  });
  await settings
    .getByRole("button", { name: "Clear key", exact: true })
    .click();
  await settings
    .getByRole("button", { name: "Return to workspace", exact: true })
    .click();
  await beginSecondReview(page);
  const review = page.getByRole("dialog", {
    name: "Second Review",
    exact: true,
  });
  await expect(settings).toBeVisible();
  await expect(review).not.toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  expect(secondRequests).toBe(0);
  await settings
    .getByLabel("Bedrock API key", { exact: true })
    .fill(replacementKey);
  await settings
    .getByRole("button", { name: "Use API key", exact: true })
    .click();
  await expect(settings).not.toBeVisible();
  await expect(review).not.toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Run Second Review", exact: true }),
  ).toBeEnabled();
  expect(secondRequests).toBe(0);
  const preserved = await download(page);
  expect(preserved.council).toEqual(baseline);
  expect(preserved.second_round).toBeUndefined();
  await page
    .getByRole("button", { name: "Run Second Review", exact: true })
    .click();
  await expect(review.locator(".second-review-status")).toContainText(
    "2 of 2 assigned models completed",
  );
  expect(firstRequests).toBe(1);
  expect(secondRequests).toBe(1);
});
