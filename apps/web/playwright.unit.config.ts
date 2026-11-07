import { defineConfig } from "@playwright/test";

// Request and orchestration tests need neither a browser nor a Python service.
export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results/unit",
  testMatch: [
    "bedrock-server.spec.ts",
    "bedrock-timeout-recovery.spec.ts",
    "execution-deadlines.spec.ts",
    "static-unit.spec.ts",
    "orchestration.spec.ts",
    "council-export.spec.ts",
    "evaluation.spec.ts",
    "evaluation-adjudication.spec.ts",
    "final-report-ui.spec.ts",
    "final-report-state.spec.ts",
    "second-review.spec.ts",
    "second-review-server.spec.ts",
    "second-review-client.spec.ts",
    "review-workflow.spec.ts",
  ],
  grepInvert: /production route/,
  workers: 1,
  timeout: 30_000,
  reporter: "list",
});
