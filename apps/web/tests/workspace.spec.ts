import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import cases from "../src/generated/cases.json";

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
  await expect(page.getByText("GPT-6 Astra", { exact: true })).toBeVisible();
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
  await expect(page.locator(".model-summary")).toHaveCount(0);
  await expect(page.locator(".finding")).toHaveCount(3);
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
  ).toContainText("Invalid Bedrock report");
  await expect(page.locator(".model-summary")).toHaveCount(0);
});

test("validated model review and export preserve static evidence", async ({
  page,
  request,
}, testInfo) => {
  const baseline = await (
    await request.post("http://127.0.0.1:8000/api/audits", {
      data: cases[0].report.input,
    })
  ).json();
  const finding = baseline.candidates[0];
  const review = {
    provider: "aws-bedrock",
    model_id: "us.openai.gpt-6-astra",
    region: "us-east-1",
    protocol: "converse",
    source_sha256: baseline.source_sha256,
    created_at: new Date().toISOString(),
    elapsed_ms: 42,
    input_tokens: 100,
    output_tokens: 50,
    summary: "Mocked integration test: inspect the external call.",
    findings: [
      {
        title: finding.title,
        category: finding.category,
        proposed_severity: finding.proposed_severity,
        rationale: finding.rationale,
        recommendation: finding.recommendation,
        evidence: finding.evidence,
      },
    ],
  };
  await page.route("**/api/reviews", (route) =>
    route.fulfill({
      json: {
        schema_version: "1.0.0",
        static_report: baseline,
        model_review: review,
      },
    }),
  );
  await page.goto(production);
  await apiMode(page);
  await page
    .getByRole("button", { name: "Run API analysis", exact: true })
    .click();
  await expect(page.locator(".model-summary")).toContainText(review.summary);
  await expect(page.locator(".finding")).toHaveCount(4);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: jsonButton }).click();
  const result = JSON.parse(
    await readFile((await (await pending).path())!, "utf8"),
  );
  expect(result.static_report.candidates).toHaveLength(3);
  expect(result.model_review.findings).toHaveLength(1);
  expect(result.static_report.execution).toBe("browser");
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC_BROWSER_TEST");
  await page.screenshot({
    path: testInfo.outputPath("api-review-test.png"),
    fullPage: true,
  });
});

test("cancel or edit during a pending request cannot restore stale results", async ({
  page,
}) => {
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/reviews", async (route) => {
    await waiting;
    await route.fulfill({ json: { schema_version: "1.0.0" } }).catch(() => {});
  });
  await page.goto("/");
  await apiMode(page);
  await page
    .getByRole("button", { name: "Run API analysis", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancel analysis" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Contract filename" })
    .fill("New.sol");
  release();
  await expect(page.getByRole("button", { name: jsonButton })).toBeDisabled();
  await expect(page.locator(".finding")).toHaveCount(0);
  await expect(page.locator(".model-summary")).toHaveCount(0);
});

test("documentation is a real same-site PDF and setup stays on site", async ({
  page,
  request,
}) => {
  await page.goto(production);
  const documentation = page.getByRole("link", { name: /Documentation/ });
  await expect(documentation).toBeVisible();
  await expect(documentation).toHaveAttribute(
    "href",
    "/docs/DTCC_Platform_Overview.pdf",
  );
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
