import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import cases from "../src/generated/cases.json";
import { BEDROCK, BEDROCK_MODELS } from "../src/lib/bedrock-config";
import {
  buildCouncilReport,
  type CouncilReport,
  type ModelRun,
} from "../src/lib/orchestration";
import { POLICY_VERSION, PROMPT_VERSION } from "../src/lib/review-policy";
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
  options: { completeAgreement?: boolean; oneReviewer?: boolean } = {},
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
    const failed = !!options.oneReviewer && index > 0;
    return {
      model_id: model.id,
      label: model.label,
      status: failed ? "failed" : "succeeded",
      elapsed_ms: 10,
      error: failed
        ? { code: "bedrock_access", detail: "Synthetic access failure." }
        : null,
      attempts: [
        {
          attempt: 1,
          status: failed ? "failed" : "succeeded",
          elapsed_ms: 10,
          error_code: failed ? "bedrock_access" : null,
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
    max_attempts_per_model: 2,
    model_timeout_ms: 180_000,
    overall_timeout_ms: 210_000,
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

async function enterApi(page: Page) {
  await page.goto(production);
  await page.getByRole("button", { name: /^API analysis/ }).click();
  await page.getByLabel("Bedrock API key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Use API key", exact: true }).click();
  await page
    .getByRole("button", { name: "Run API analysis", exact: true })
    .click();
  await expect(
    page
      .getByText("Three-model review complete", { exact: true })
      .or(page.getByText("Partial model coverage", { exact: true })),
  ).toBeVisible();
}

async function download(page: Page, name = "Download JSON report") {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}

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
  await expect(page.getByText("LOW CONFIDENCE", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Run second review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Second review",
    exact: true,
  });
  await expect(dialog.getByText(/Second review complete/)).toBeVisible();
  await expect(dialog.getByText("Reassessed", { exact: true })).toHaveCount(3);
  await dialog.evaluate((node) => node.scrollTo({ top: 0 }));
  await page.screenshot({
    path: testInfo.outputPath("second-review-overview.png"),
  });
  await expect(
    dialog.getByText("Independent agreement").locator("strong"),
  ).toHaveText("1 / 3");
  await expect(
    dialog.getByText("Support after discussion").locator("strong"),
  ).toHaveText("3 / 3");
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
  const data = await download(page, "Export both rounds · JSON");
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
    .getByRole("button", { name: "Close second review", exact: true })
    .click();
  await expect(page.getByText("LOW CONFIDENCE", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "View second review", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  expect(requests).toBe(1);
  await expect(
    dialog.getByRole("button", { name: "Run second review", exact: true }),
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
  await page
    .getByRole("button", { name: "Run second review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Second review",
    exact: true,
  });
  await expect(dialog.getByText(/Partial second review/)).toBeVisible();
  await expect(dialog.getByText("Unresolved", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Uncertain", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Time limit", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Return to findings" }).click();
  const data = await download(page);
  expect(data.first_round.findings).toEqual(baseline.findings);
  expect(data.second_round.status).toBe("partial");
});

test("unanimous peer rejection remains separate from the original candidate", async ({
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
  await page
    .getByRole("button", { name: "Run second review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Second review",
    exact: true,
  });
  await expect(dialog.locator(".second-verdict")).toHaveText("Not supported");
  await expect(
    dialog.getByText("Support after discussion").locator("strong"),
  ).toHaveText("0 / 3");
  await dialog.getByRole("button", { name: "Return to findings" }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(baseline.findings[0].title) }),
  ).toBeVisible();
  await expect(page.getByText("LOW CONFIDENCE", { exact: true })).toBeVisible();
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
  await page
    .getByRole("button", { name: "Run second review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Second review",
    exact: true,
  });
  await expect(dialog.getByText("Reviewing 1 candidates")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Cancel second review", exact: true })
    .click();
  release();
  await dialog.getByRole("button", { name: "Return to findings" }).click();
  await expect(
    page.getByRole("button", { name: "Round already attempted" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Run API analysis", exact: true }),
  ).toBeEnabled();
  const data = await download(page);
  expect(data.council).toEqual(baseline);
  expect(JSON.stringify(data)).not.toContain("peer-informed-reassessment");
  expect(requests).toBe(1);
});

test("changing source or key removes the previous second round", async ({
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
  await page
    .getByRole("button", { name: "Run second review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Second review",
    exact: true,
  });
  await expect(dialog.getByText(/Second review complete/)).toBeVisible();
  await dialog.getByRole("button", { name: "Return to findings" }).click();
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await page
    .getByLabel("Bedrock API key", { exact: true })
    .fill("bedrock-api-key-REPLACEMENT_SYNTHETIC");
  await page
    .getByRole("button", { name: "Replace API key", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "View second review", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Run API analysis", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run second review", exact: true })
    .click();
  await expect(dialog.getByText(/Second review complete/)).toBeVisible();
  await dialog.getByRole("button", { name: "Return to findings" }).click();
  await page.getByRole("button", { name: "New contract", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "View second review", exact: true }),
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
  await page
    .getByRole("button", { name: "Run second review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Second review",
    exact: true,
  });
  await expect(
    dialog.getByText(
      "Second review stopped. Independent results are retained.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(dialog.locator(".second-review-findings")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Return to findings" }).click();
  await expect(page.getByText("LOW CONFIDENCE", { exact: true })).toBeVisible();
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
    await expect(
      page.getByRole("button", { name: "Run second review", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        variant === "oneReviewer"
          ? "At least two completed independent reviews are needed."
          : "No eligible disagreements in this independent review.",
        { exact: true },
      ),
    ).toBeVisible();
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
  await page.getByRole("button", { name: /^API analysis/ }).click();
  await page.getByLabel("Bedrock API key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Use API key", exact: true }).click();
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
