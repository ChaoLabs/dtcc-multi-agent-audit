import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import cases from "../src/generated/cases.json";
import type { ReviewFinding } from "../src/generated/review";
import { BEDROCK, BEDROCK_MODELS } from "../src/lib/bedrock-config";
import { buildCouncilReport, type ModelRun } from "../src/lib/orchestration";
import { analyzeStatic } from "../src/lib/static-analysis";
import {
  POLICY_VERSION,
  PROMPT_VERSION,
  type PromptVariant,
} from "../src/lib/review-policy";

async function councilFixture(
  contributions: (number[] | null)[] = [[0], [0], [0]],
  caseIndex = 0,
) {
  const { filename, source } = cases[caseIndex].report.input;
  const baseline = await analyzeStatic(filename, source);
  const findings: ReviewFinding[] = baseline.candidates.map((finding) => ({
    title: finding.title,
    category: (
      {
        "SC-001": "reentrancy",
        "SC-005": "tx-origin",
        "SC-002": "unchecked-call",
      } as Record<string, string>
    )[finding.rule_id],
    proposed_severity: finding.proposed_severity,
    rationale: finding.rationale,
    recommendation: finding.recommendation,
    evidence: finding.evidence,
  }));
  const models: ModelRun[] = BEDROCK_MODELS.map((model, index) => ({
    model_id: model.id,
    label: model.label,
    status: contributions[index] === null ? "failed" : "succeeded",
    elapsed_ms: 42,
    error:
      contributions[index] === null
        ? {
            code: "model_unavailable",
            detail: "This model is unavailable for the supplied account.",
          }
        : null,
    review:
      contributions[index] === null
        ? null
        : {
            provider: "aws-bedrock",
            model_id: model.id,
            region: BEDROCK.region,
            protocol: BEDROCK.protocol,
            source_sha256: baseline.source_sha256,
            created_at: new Date().toISOString(),
            elapsed_ms: 42,
            input_tokens: 100,
            output_tokens: 50,
            summary: `Synthetic independent review from ${model.label}.`,
            findings: contributions[index]!.map(
              (findingIndex, observationIndex) => ({
                ...findings[findingIndex],
                title:
                  contributions[index]!.indexOf(findingIndex) ===
                  observationIndex
                    ? findings[findingIndex].title
                    : `${findings[findingIndex].title} (alternate observation)`,
                // Retain a real severity disagreement without changing source evidence.
                proposed_severity:
                  index === 1 && findingIndex === 0
                    ? "MEDIUM"
                    : findings[findingIndex].proposed_severity,
              }),
            ),
          },
  }));
  return { baseline, council: await buildCouncilReport(models, source, 50) };
}

async function supervisedFixture(
  caseIndex = 0,
  variant: PromptVariant = "baseline",
  retry = false,
  contributions: (number[] | null)[] = [[0], [0], [0]],
) {
  const { council } = await councilFixture(contributions, caseIndex);
  const models: ModelRun[] = council.models.map((model, index) => ({
    ...model,
    elapsed_ms: retry && index === 0 ? 543 : 42,
    attempts:
      retry && index === 0
        ? [
            {
              attempt: 1,
              status: "failed",
              elapsed_ms: 1,
              error_code: "bedrock_rate_limit",
              retry_delay_ms: 0,
            },
            {
              attempt: 2,
              status: "succeeded",
              elapsed_ms: 42,
              error_code: null,
              retry_delay_ms: 500,
            },
          ]
        : [
            {
              attempt: 1,
              status: model.status,
              elapsed_ms: 42,
              error_code: model.error?.code ?? null,
              retry_delay_ms: 0,
            },
          ],
  }));
  return buildCouncilReport(
    models,
    cases[caseIndex].report.input.source,
    retry ? 550 : 50,
    {
      policy_version: POLICY_VERSION,
      prompt_variant: variant,
      prompt_version: PROMPT_VERSION,
      max_attempts_per_model: 2,
      model_timeout_ms: 180_000,
      overall_timeout_ms: 210_000,
      total_attempts: retry ? 4 : 3,
    },
  );
}

async function runApi(page: import("@playwright/test").Page) {
  await apiMode(page);
  await page
    .getByRole("button", { name: "Run API analysis", exact: true })
    .click();
}

async function exportedJson(page: import("@playwright/test").Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: jsonButton }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}

const production = "http://127.0.0.1:3100";
const jsonButton = "Download JSON report";
async function apiMode(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /^API analysis/ }).click();
  await page
    .getByLabel("Bedrock API key", { exact: true })
    .fill("bedrock-api-key-SYNTHETIC_BROWSER_TEST");
  await page.getByRole("button", { name: "Use API key", exact: true }).click();
}

test("desktop and mobile design, logo, keyboard details and reference cases", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(production);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Multi-Agent AI for Smart Contract Audit and Cybersecurity Risk Assessment",
  );
  await expect(
    page.getByRole("img", { name: "DTCC", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Academic prototype|Public showcase|Not an official DTCC product/,
    ),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Line 22", exact: true }).click();
    await expect(
      page.locator('.code-line.highlight[data-line="22"]'),
    ).toBeInViewport();
  }
  await page.screenshot({
    path: testInfo.outputPath("workspace.png"),
    fullPage: true,
  });
  if (testInfo.project.name === "desktop") {
    await page.getByRole("button", { name: "Expand workspace" }).click();
    await page.screenshot({
      path: testInfo.outputPath("focus.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Restore overview" }).click();
  }
  await page.locator(".case-trigger").click();
  await expect(
    page.getByRole("dialog", { name: "Reference cases" }),
  ).toBeVisible();
  await expect(page.locator(".case-list > button")).toHaveCount(5);
  await page.locator(".case-list > button").nth(2).click();
  await expect(
    page.getByRole("button", { name: /Delegatecall requires review/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Report details/ }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Source provenance" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("public static analysis runs on device with no API requests", async ({
  page,
}) => {
  const apiCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(":8000") || r.url().includes("amazonaws.com"))
      apiCalls.push(r.url());
  });
  await page.goto(production);
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Solidity source", exact: true })
    .fill(
      "pragma solidity ^0.8.20;\ncontract C {function f() public {require(tx.origin == msg.sender);}}",
    );
  await expect(page.getByRole("button", { name: jsonButton })).toBeDisabled();
  await page
    .getByRole("button", { name: "Run static analysis", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /tx.origin authorization/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Static analysis complete", { exact: true }),
  ).toBeVisible();
  expect(apiCalls).toEqual([]);
});

test("source selection scrolls, severity and text search filter", async ({
  page,
}) => {
  await page.goto(production);
  await page.getByRole("button", { name: /tx.origin authorization/ }).click();
  await expect(
    page.locator('.code-line.highlight[data-line="29"]'),
  ).toHaveCount(1);
  await expect
    .poll(() => page.locator(".code-view").evaluate((node) => node.scrollTop))
    .toBeGreaterThan(200);
  await page
    .getByRole("group", { name: "Severity filter" })
    .getByRole("button", { name: /Medium/ })
    .click();
  await expect(page.locator(".finding")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /Unchecked low-level call/ }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search findings" })
    .fill("no-such-finding");
  await expect(
    page.getByRole("heading", { name: "No matching findings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".finding")).toHaveCount(3);
});

test("immutable JSON and Markdown exports", async ({ page }) => {
  await page.goto(production);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: jsonButton }).click();
  const report = JSON.parse(
    await readFile((await (await pending).path())!, "utf8"),
  );
  expect(report.execution).toBe("recorded");
  expect(report.candidates).toHaveLength(3);
  const md = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Markdown report" }).click();
  const content = await readFile((await (await md).path())!, "utf8");
  expect(content).toContain(report.source_sha256);
  expect(content).toContain(report.input.source);
});

test("edits and filenames invalidate results; zero findings is no safety claim", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Solidity source", exact: true })
    .fill("pragma solidity ^0.8.20;\ncontract Benign {}");
  await expect(page.getByRole("button", { name: jsonButton })).toBeDisabled();
  await page
    .getByRole("button", { name: "Run static analysis", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No candidates flagged" }),
  ).toBeVisible();
  await expect(page.getByText(/Manual review is still required/)).toBeVisible();
  await expect(page.getByRole("button", { name: jsonButton })).toBeEnabled();
  await page
    .getByRole("textbox", { name: "Contract filename" })
    .fill("Changed.sol");
  await expect(page.getByRole("button", { name: jsonButton })).toBeDisabled();
});

test("source markup renders as text", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Solidity source", exact: true })
    .fill(
      "pragma solidity ^0.8.20;\n// </script><img src=x onerror=alert(1)>\ncontract C {}",
    );
  await page
    .getByRole("button", { name: "Run static analysis", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No candidates flagged" }),
  ).toBeVisible();
  await expect(page.locator(".code-view img")).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test("upload valid file, reject oversize input, new contract", async ({
  page,
}) => {
  await page.goto(production);
  await page.getByLabel("Solidity file upload").setInputFiles({
    name: "Uploaded.sol",
    mimeType: "text/plain",
    buffer: Buffer.from("pragma solidity ^0.8.20;\ncontract Uploaded {}"),
  });
  await expect(
    page.getByRole("textbox", { name: "Contract filename" }),
  ).toHaveValue("Uploaded.sol");
  await expect(page.getByRole("button", { name: jsonButton })).toBeDisabled();
  await page.getByLabel("Solidity file upload").setInputFiles({
    name: "Large.sol",
    mimeType: "text/plain",
    buffer: Buffer.alloc(48001, 65),
  });
  await expect(
    page.getByRole("region", { name: /Findings/ }).getByRole("alert"),
  ).toContainText("48,000");
  await page.getByRole("button", { name: "New contract" }).click();
  await expect(
    page.getByRole("textbox", { name: "Contract filename" }),
  ).toHaveValue("Contract.sol");
  await expect(
    page.getByRole("textbox", { name: "Solidity source", exact: true }),
  ).toContainText("contract Contract");
});

test("all five reference contracts fit the viewport", async ({ page }) => {
  await page.goto(production);
  for (let i = 0; i < 5; i++) {
    await page.locator(".case-trigger").click();
    await page.locator(".case-list > button").nth(i).click();
    await expect(page.getByRole("button", { name: jsonButton })).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("public connection accepts a memory-only key without contacting AWS or localhost", async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(":8000") || r.url().includes("/api/reviews"))
      requests.push(r.url());
  });
  await page.goto(production);
  await page.getByRole("button", { name: /^API analysis/ }).click();
  await expect(
    page.getByLabel("Bedrock API key", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Bedrock API key", { exact: true }),
  ).toHaveAttribute("type", "password");
  for (const model of BEDROCK_MODELS) {
    await expect(
      page.getByRole("dialog").getByText(model.label, { exact: true }),
    ).toBeVisible();
  }
  await page.screenshot({
    path: testInfo.outputPath("web-bedrock-connection.png"),
    fullPage: false,
  });
  const key = "bedrock-api-key-" + "SYNTHETIC_".repeat(800);
  await page.getByLabel("Bedrock API key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Use API key", exact: true }).click();
  await page.getByRole("button", { name: /^API analysis/ }).click();
  await expect(page.locator(".connection-status")).toContainText("Key ready");
  await expect(page.getByLabel("Bedrock API key", { exact: true })).toHaveValue(
    "",
  );
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.content()).not.toContain(key);
  await page.reload();
  await page.getByRole("button", { name: /^API analysis/ }).click();
  await expect(page.locator(".connection-status")).toContainText(
    "No API key connected",
  );
  expect(requests).toEqual([]);
});

test("invalid keys are rejected and clearing removes the current connection", async ({
  page,
}) => {
  await page.goto(production);
  await page.getByRole("button", { name: /^API analysis/ }).click();
  await page
    .getByLabel("Bedrock API key", { exact: true })
    .fill("export AWS_BEARER_TOKEN_BEDROCK=not-a-key");
  await page.getByRole("button", { name: "Use API key", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "complete Bedrock API key only",
  );
  await page
    .getByLabel("Bedrock API key", { exact: true })
    .fill("bedrock-api-key-SYNTHETIC_BROWSER_TEST");
  await page.getByRole("button", { name: "Use API key", exact: true }).click();
  await page.getByRole("button", { name: /^API analysis/ }).click();
  await page.getByRole("button", { name: "Clear key", exact: true }).click();
  await expect(page.locator(".connection-status")).toContainText(
    "No API key connected",
  );
  await page.getByRole("button", { name: "Return to workspace" }).click();
  await page
    .getByRole("button", { name: "Run API analysis", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "AWS Bedrock" })).toBeVisible();
});

test("API failures retain clearly identified static results", async ({
  page,
}) => {
  await page.route("**/api/reviews", (route) => route.abort("failed"));
  await page.goto("/");
  await apiMode(page);
  await page
    .getByRole("button", { name: "Run API analysis", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: /Findings/ }).getByRole("alert"),
  ).toContainText("Cannot reach the analysis service");
  await expect(page.getByRole("button", { name: jsonButton })).toBeEnabled();
  await expect(page.locator(".consensus-summary")).toHaveCount(0);
  await page
    .getByRole("group", { name: "Result source" })
    .getByRole("button", { name: /^Static baseline/ })
    .click();
  await expect(page.locator(".finding")).toHaveCount(3);
  await expect(page.locator(".finding-origin")).toHaveText([
    "Static",
    "Static",
    "Static",
  ]);
});

test("schema-invalid API response is not accepted", async ({ page }) => {
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: { model_review: { findings: [] } } }),
  );
  await page.goto("/");
  await apiMode(page);
  await page
    .getByRole("button", { name: "Run API analysis", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: /Findings/ }).getByRole("alert"),
  ).toContainText("Invalid orchestration report");
  await expect(page.locator(".consensus-summary")).toHaveCount(0);
});

test("three independent reviews consolidate once, retain contributions, and export separate static evidence", async ({
  page,
}, testInfo) => {
  const { council } = await councilFixture([[0, 0], [0], [0]]);
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: council }),
  );
  await page.goto(production);
  await runApi(page);
  await expect(
    page.getByText("Three-model review complete", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".consensus-summary")).toContainText(
    "3 / 3 reviews completed",
  );
  await expect(page.locator(".finding")).toHaveCount(1);
  await expect(page.locator(".confidence-pill")).toHaveText("HIGH CONFIDENCE");
  await expect(
    page.getByText("Severity differs across models", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".finding-origin")).toHaveText("3 / 3 models");
  await expect(page.locator(".council-model.succeeded")).toHaveCount(3);
  await expect(page.locator(".model-perspective")).toHaveCount(3);
  for (let index = 0; index < BEDROCK_MODELS.length; index++) {
    const perspective = page.locator(".model-perspective").nth(index);
    await perspective.locator("summary").click();
    await expect(perspective.locator(".model-observation")).toHaveCount(
      index === 0 ? 2 : 1,
    );
    await expect(perspective.locator(".evidence").first()).toContainText(
      council.findings[0].evidence.excerpt,
    );
  }
  const result = await exportedJson(page);
  expect(result.schema_version).toBe("2.0.0");
  expect(result.static_report.candidates).toHaveLength(3);
  expect(result.static_report.execution).toBe("browser");
  expect(result.council).toEqual(council);
  expect(result.council.findings).toHaveLength(1);
  expect(result.council.findings[0].members).toHaveLength(4);
  expect(result.council.findings[0].supporting_models).toHaveLength(3);
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC_BROWSER_TEST");

  const markdownDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Markdown report" }).click();
  const markdown = await readFile(
    (await (await markdownDownload).path())!,
    "utf8",
  );
  expect(markdown).toContain(
    "Severity: HIGH | Confidence: HIGH | Agreement: 3/3",
  );
  expect(markdown).toContain("Severity disagreement: yes");
  expect(markdown).toContain("## Independent static baseline");
  expect(markdown).toContain("#### Model contributions");
  for (const model of BEDROCK_MODELS)
    expect(markdown).toContain(model.label.replaceAll(".", "\\."));
  expect(markdown).toContain(council.source_sha256);
  expect(markdown).not.toContain("SYNTHETIC_BROWSER_TEST");

  const views = page.getByRole("group", { name: "Result source" });
  await views.getByRole("button", { name: /^Static baseline/ }).click();
  await expect(page.locator(".finding")).toHaveCount(3);
  await expect(page.locator(".finding-origin")).toHaveText([
    "Static",
    "Static",
    "Static",
  ]);
  await expect(
    page.getByLabel("Consensus confidence", { exact: true }),
  ).toHaveCount(0);
  await views.getByRole("button", { name: /^Model consensus/ }).click();
  await expect(page.locator(".finding")).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator(".findings-content").evaluate((node) => node.scrollTop),
    )
    .toBe(0);
  await views.getByRole("button", { name: /^Model consensus/ }).focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("api-council-review.png"),
    fullPage: true,
  });
  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("api-council-1280x720.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("partial model failure keeps two validated reviews with medium confidence and explicit coverage", async ({
  page,
}) => {
  const { council } = await councilFixture([[0], [0], null]);
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: council }),
  );
  await page.goto(production);
  await runApi(page);
  await expect(
    page.getByText("Partial model coverage", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".consensus-summary")).toContainText(
    "2 / 3 reviews completed",
  );
  await expect(page.locator(".consensus-summary")).toContainText(
    "Partial coverage",
  );
  await expect(page.locator(".finding")).toHaveCount(1);
  await expect(page.locator(".confidence-pill")).toHaveText(
    "MEDIUM CONFIDENCE",
  );
  const unavailable = page.locator(".council-model.failed");
  await expect(unavailable).toHaveCount(1);
  await expect(unavailable.locator("summary")).toContainText(
    BEDROCK_MODELS[2].label,
  );
  await unavailable.locator("summary").click();
  await expect(unavailable).toContainText(
    "This model is unavailable for the supplied account.",
  );
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await expect(page.locator(".connection-status")).toContainText(
    "2 of 3 models returned a valid review",
  );
  await page.getByRole("button", { name: "Return to workspace" }).click();
  const result = await exportedJson(page);
  expect(result.council.status).toBe("partial");
  expect(result.council.models[2].review).toBeNull();
  expect(result.council.findings[0].agreement).toBe(2);
});

test("all model failures are unavailable, never presented as a clean review", async ({
  page,
}) => {
  const { council } = await councilFixture([null, null, null]);
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: council }),
  );
  await page.goto(production);
  await runApi(page);
  await expect(
    page.getByRole("heading", { name: "Model review unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText("Model review failed", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".consensus-summary")).toContainText(
    "0 / 3 reviews completed",
  );
  await expect(page.locator(".council-model.failed")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "No candidates flagged" }),
  ).toHaveCount(0);
  await expect(page.locator(".finding")).toHaveCount(0);
  const result = await exportedJson(page);
  expect(result.council.status).toBe("failed");
  expect(result.static_report.candidates).toHaveLength(3);
  await page
    .getByRole("button", { name: "View static baseline", exact: true })
    .click();
  await expect(page.locator(".finding")).toHaveCount(3);
});

test("confidence and severity filters operate on consolidated findings without counting duplicate votes", async ({
  page,
}) => {
  const { council } = await councilFixture([[0, 0, 1, 2], [0, 1], [0]]);
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: council }),
  );
  await page.goto(production);
  await runApi(page);
  await expect(page.locator(".finding")).toHaveCount(3);
  const confidence = page.getByLabel("Consensus confidence", { exact: true });
  for (const [level, count, agreement] of [
    ["HIGH", 1, 3],
    ["MEDIUM", 1, 2],
    ["LOW", 1, 1],
  ] as const) {
    await confidence.selectOption(level);
    await expect(page.locator(".finding")).toHaveCount(count);
    await expect(page.locator(".finding-origin")).toHaveText(
      `${agreement} / 3 models`,
    );
  }
  await page
    .getByRole("group", { name: "Severity filter" })
    .getByRole("button", { name: /High/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "No matching findings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(confidence).toHaveValue("ALL");
  await expect(page.locator(".finding")).toHaveCount(3);
});

for (const action of [
  "source edit",
  "filename edit",
  "cancel",
  "clear key",
] as const) {
  test(`${action} during a pending request cannot restore stale model results`, async ({
    page,
  }) => {
    const { council } = await councilFixture();
    let release: () => void = () => {};
    let requested: () => void = () => {};
    let settled: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      settled = resolve;
    });
    await page.route("**/api/reviews", async (route) => {
      requested();
      await waiting;
      await route.fulfill({ json: council }).catch(() => {});
      settled();
    });
    await page.goto(production);
    await runApi(page);
    await entered;
    await expect(
      page.getByRole("button", { name: "Cancel analysis" }),
    ).toBeVisible();
    if (action === "source edit") {
      await page
        .getByRole("button", { name: "Edit source", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Solidity source", exact: true })
        .fill("pragma solidity ^0.8.20;\ncontract Changed {}");
    } else if (action === "filename edit") {
      await page
        .getByRole("textbox", { name: "Contract filename" })
        .fill("Changed.sol");
    } else if (action === "cancel") {
      await page.getByRole("button", { name: "Cancel analysis" }).click();
    } else {
      await page
        .getByRole("button", { name: "Connection settings", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Clear key", exact: true })
        .click();
      await expect(page.locator(".connection-status")).toContainText(
        "No API key connected",
      );
      await page.getByRole("button", { name: "Return to workspace" }).click();
    }
    release();
    await finished;
    await expect(page.locator(".consensus-summary")).toHaveCount(0);
    await expect(page.locator(".council-model.succeeded")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Cancel analysis" }),
    ).toHaveCount(0);
    if (action.endsWith("edit")) {
      await expect(
        page.getByRole("button", { name: jsonButton }),
      ).toBeDisabled();
      await expect(page.locator(".finding")).toHaveCount(0);
    } else {
      await expect(
        page.getByRole("button", { name: jsonButton }),
      ).toBeEnabled();
      const result = await exportedJson(page);
      expect(result.council).toBeUndefined();
      expect(result.candidates).toHaveLength(3);
    }
  });
}

test("documentation opens the same-site library and setup stays on site", async ({
  page,
  request,
}) => {
  await page.goto(production);
  await apiMode(page);
  const documentation = page.getByRole("link", { name: /Documentation/ });
  await expect(documentation).toBeVisible();
  await expect(documentation).toHaveAttribute("href", "/documentation");
  await expect(documentation).toHaveAttribute("target", "_blank");
  await expect(documentation).toHaveAttribute("rel", "noopener noreferrer");
  const popupEvent = page.waitForEvent("popup");
  await documentation.click();
  const documentsPage = await popupEvent;
  await expect(documentsPage).toHaveURL(`${production}/documentation`);
  await expect(
    documentsPage.getByRole("heading", {
      name: "Orchestration design",
      exact: true,
    }),
  ).toBeVisible();
  await documentsPage.close();
  await expect(page).toHaveURL(`${production}/`);
  await page.getByRole("button", { name: /^API analysis/ }).click();
  await expect(page.locator(".connection-status")).toContainText("Key ready");
  await page.keyboard.press("Escape");
  const pdf = await request.get(
    `${production}/docs/DTCC_Platform_Overview.pdf`,
  );
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page
    .getByRole("button", { name: "Analysis method", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Evidence before conclusions" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Evidence before conclusions" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Analysis method", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("link", { name: "Local setup" })).toHaveAttribute(
    "href",
    "/guide",
  );
  await page.goto(`${production}/guide`);
  await expect(
    page.getByRole("heading", { name: "Connection & analysis" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Connect Bedrock", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect AWS Bedrock" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("desktop panes stay anchored; mobile source links reveal the code", async ({
  page,
}, testInfo) => {
  await page.goto(production);
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: /tx.origin authorization/ }).click();
    await page.getByRole("button", { name: "Line 29", exact: true }).click();
    await expect(
      page.locator('.code-line.highlight[data-line="29"]'),
    ).toBeInViewport();
    return;
  }
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Run static analysis", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: jsonButton }),
    ).toBeInViewport();
    const before = await page.locator(".workspace-toolbar").boundingBox();
    await page.locator(".code-view").hover();
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(100);
    expect(await page.locator(".workspace-toolbar").boundingBox()).toEqual(
      before,
    );
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.getByRole("button", { name: /Report details/ }).click();
    await expect(
      page.getByRole("dialog", { name: "Report details" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await page.locator(".workspace-toolbar").boundingBox()).toEqual(
      before,
    );
  }
  const initialHeight = await page
    .locator(".code-view")
    .evaluate((node) => node.clientHeight);
  await page.getByRole("button", { name: "Expand workspace" }).click();
  expect(
    await page.locator(".code-view").evaluate((node) => node.clientHeight),
  ).toBeGreaterThan(initialHeight + 80);
  await expect(
    page.getByRole("button", { name: "Run static analysis", exact: true }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Restore overview" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Short or zoomed windows fall back to a normal scrolling page, without clipped controls.
  await page.setViewportSize({ width: 1280, height: 580 });
  await page
    .getByRole("button", { name: "Run static analysis", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Run static analysis", exact: true }),
  ).toBeInViewport();
});

test("guided prompt is explicit and changing it does not start a paid analysis", async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];
  const council = await supervisedFixture(0, "few-shot");
  await page.route("**/api/reviews", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: council });
  });
  await page.goto(production);
  await apiMode(page);
  const prompt = page.getByLabel("Review prompt", { exact: true });
  await expect(prompt).toHaveValue("baseline");
  await prompt.selectOption("few-shot");
  expect(requests).toEqual([]);
  await page
    .getByRole("button", { name: "Run API analysis", exact: true })
    .click();
  await expect(page.locator(".council-model.succeeded")).toHaveCount(3);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    prompt_variant: "few-shot",
    filename: cases[0].report.input.filename,
    source: cases[0].report.input.source,
  });
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
});

test("five-contract validation requires an explicit run and exports traceable credential-free results", async ({
  page,
}, testInfo) => {
  const requests: {
    filename: string;
    source: string;
    prompt_variant: string;
  }[] = [];
  await page.route("**/api/reviews", async (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    const index = cases.findIndex(
      (item) => item.report.input.filename === input.filename,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    await route.fulfill({
      json: await supervisedFixture(index, "few-shot", false, [[], [], []]),
    });
  });
  await page.goto(production);
  await apiMode(page);
  await page
    .getByRole("button", { name: "Validate 5 cases", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Five-contract validation",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("list", { name: "Validation cases" }).locator("li"),
  ).toHaveCount(5);
  await dialog
    .getByLabel("Validation prompt", { exact: true })
    .selectOption("few-shot");
  expect(requests).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Run five-case validation", exact: true })
    .click();
  await expect(dialog.locator(".validation-status")).toContainText(
    "5 / 5 cases with results",
  );
  await expect(dialog.locator(".validation-status")).toContainText("completed");
  expect(requests).toHaveLength(5);
  expect(requests.map((item) => item.filename)).toEqual(
    cases.map((item) => item.report.input.filename),
  );
  expect(requests.every((item) => item.prompt_variant === "few-shot")).toBe(
    true,
  );
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download validation JSON", exact: true })
    .click();
  const result = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(result.status).toBe("completed");
  expect(result.prompt_variant).toBe("few-shot");
  expect(result.metrics).toMatchObject({
    completed_cases: 5,
    successful_model_reviews: 15,
    observed_attempts: 15,
  });
  expect(result.cases).toHaveLength(5);
  expect(result.case_caveats).toHaveLength(5);
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC_BROWSER_TEST");
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    dialog.getByRole("button", { name: "Close validation", exact: true }),
  ).toBeInViewport();
  if (testInfo.project.name === "mobile") {
    const run = dialog.getByRole("button", {
      name: "Run five-case validation",
      exact: true,
    });
    await run.scrollIntoViewIfNeeded();
    const bounds = await run.boundingBox();
    expect(bounds!.width).toBeGreaterThan(260);
    expect(bounds!.height).toBeLessThan(100);
  }
  await page.screenshot({
    path: testInfo.outputPath("five-contract-validation-results.png"),
    fullPage: false,
  });
  await dialog.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: testInfo.outputPath("five-contract-validation.png"),
    fullPage: false,
  });
});

test("validation cancellation keeps the completed case and does not start the remaining cases", async ({
  page,
}) => {
  let requests = 0;
  let release: () => void = () => {};
  let secondStarted: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const second = new Promise<void>((resolve) => {
    secondStarted = resolve;
  });
  await page.route("**/api/reviews", async (route) => {
    const index = requests++;
    if (index === 1) {
      secondStarted();
      await held;
    }
    await route
      .fulfill({
        json: await supervisedFixture(index, "baseline", false, [[], [], []]),
      })
      .catch(() => {});
  });
  await page.goto(production);
  await apiMode(page);
  await page
    .getByRole("button", { name: "Validate 5 cases", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Five-contract validation",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Run five-case validation", exact: true })
    .click();
  await second;
  await expect(dialog.locator(".validation-status")).toContainText(
    "1 / 5 cases with results",
  );
  await expect(
    dialog.getByLabel("Validation prompt", { exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Cancel validation", exact: true })
    .click();
  release();
  await expect(dialog.locator(".validation-status")).toContainText("cancelled");
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download validation JSON", exact: true })
    .click();
  const result = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(result.cases.map((item: { status: string }) => item.status)).toEqual([
    "completed",
    "cancelled",
    "pending",
    "pending",
    "pending",
  ]);
  expect(result.cases[0].report.models).toHaveLength(3);
  expect(result.metrics.successful_model_reviews).toBe(3);
  expect(requests).toBe(2);
});

test("retried reviews show their attempt history and retain severity disagreements for review", async ({
  page,
}, testInfo) => {
  const council = await supervisedFixture(0, "baseline", true);
  await page.route("**/api/reviews", (route) =>
    route.fulfill({ json: council }),
  );
  await page.goto(production);
  await runApi(page);
  await expect(page.locator(".consensus-summary")).toContainText(
    "4 / 6 attempts",
  );
  const queue = page.getByRole("button", { name: /^Review queue/ });
  await expect(queue).toContainText("1");
  await queue.click();
  await expect(page.locator(".finding")).toHaveCount(1);
  await expect(
    page.getByText("Severity differs across models", { exact: true }),
  ).toBeVisible();
  await page.locator(".council-model").first().locator("summary").click();
  const history = page.getByRole("list", {
    name: `${BEDROCK_MODELS[0].label} attempt history`,
  });
  await expect(history.locator("li")).toHaveCount(2);
  await expect(history).toContainText("Attempt 1 · failed");
  await expect(history).toContainText("bedrock_rate_limit");
  await expect(history).toContainText("Attempt 2 · succeeded");
  if (testInfo.project.name === "mobile") {
    expect((await history.boundingBox())!.width).toBeGreaterThan(240);
    await history.locator("li").last().scrollIntoViewIfNeeded();
    await expect(history.locator("li").last()).toBeInViewport();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("retry-and-disagreement.png"),
    fullPage: true,
  });
  const result = await exportedJson(page);
  expect(result.council.execution.total_attempts).toBe(4);
  expect(result.council.review_queue).toEqual(council.review_queue);
  expect(result.council.models[0].attempts).toHaveLength(2);
});
