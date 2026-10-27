import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const production = "http://127.0.0.1:3100";
const resources = [
  {
    title: "Platform overview",
    filename: "DTCC_Platform_Overview.pdf",
    pages: 8,
  },
  {
    title: "Orchestration design",
    filename: "DTCC_Orchestration_Design.pdf",
    pages: 3,
  },
];

test("documentation presents both undated resources with responsive reading and download controls", async ({
  page,
}, testInfo) => {
  await page.goto(`${production}/documentation`);
  await expect(page).toHaveTitle("Documentation | DTCC");
  await expect(
    page.getByRole("heading", { name: "Documentation", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main article")).toHaveCount(2);
  expect(await page.locator("main").innerText()).not.toMatch(
    /\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d/,
  );
  for (const resource of resources) {
    const card = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: resource.title, exact: true }),
    });
    await expect(
      card.getByText(`PDF · ${resource.pages} pages`, { exact: true }),
    ).toBeVisible();
    const open = card.getByRole("link", {
      name: `Open ${resource.title} PDF`,
      exact: true,
    });
    await expect(open).toHaveAttribute("href", `/docs/${resource.filename}`);
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(open).toHaveAttribute("rel", "noopener noreferrer");
    const download = card.getByRole("link", {
      name: `Download ${resource.title} PDF`,
      exact: true,
    });
    await expect(download).toHaveAttribute(
      "href",
      `/docs/${resource.filename}`,
    );
    await expect(download).toHaveAttribute("download", resource.filename);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("documentation.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Connection & analysis guide", exact: true })
    .click();
  await expect(page).toHaveURL(`${production}/guide`);
  await page
    .getByRole("navigation", { name: "Guide navigation" })
    .getByRole("link", { name: "Documentation", exact: true })
    .click();
  await expect(page).toHaveURL(`${production}/documentation`);
});

test("both PDF downloads retain exact published bytes and stable filenames", async ({
  page,
  request,
}) => {
  await page.goto(`${production}/documentation`);
  for (const resource of resources) {
    const expected = await readFile(`public/docs/${resource.filename}`);
    const response = await request.get(
      `${production}/docs/${resource.filename}`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    expect((await response.body()).equals(expected)).toBe(true);
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("link", {
        name: `Download ${resource.title} PDF`,
        exact: true,
      })
      .click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(resource.filename);
    const path = await download.path();
    expect(path).not.toBeNull();
    expect((await readFile(path!)).equals(expected)).toBe(true);
  }
});
