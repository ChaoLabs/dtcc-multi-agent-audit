import { defineConfig } from "@playwright/test";

// Request and orchestration tests need neither a browser nor a Python service.
export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results/unit",
  testMatch: [
    "bedrock-server.spec.ts",
    "orchestration.spec.ts",
    "council-export.spec.ts",
    "evaluation.spec.ts",
  ],
  grepInvert: /production route/,
  workers: 1,
  timeout: 30_000,
  reporter: "list",
});
