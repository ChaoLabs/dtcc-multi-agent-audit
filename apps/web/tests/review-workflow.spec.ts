import { expect, test } from "@playwright/test";
import {
  buildCouncilReport,
  type CouncilReport,
} from "../src/lib/orchestration";
import { reviewStageAvailability } from "../src/lib/review-stages";
import { createReviewRunGate } from "../src/lib/review-workflow";
import {
  syntheticBaseline,
  syntheticSecondReview,
} from "./second-review-fixtures";

const source = "pragma solidity ^0.8.20;\ncontract Example {}\n";

async function withFailedModels(indices: number[]) {
  const baseline = await syntheticBaseline(source);
  return buildCouncilReport(
    baseline.models.map((model, index) =>
      indices.includes(index)
        ? {
            ...model,
            status: "failed" as const,
            review: null,
            error: {
              code: "content_filtered",
              detail: "Provider stopped this response.",
            },
            attempts: [
              {
                attempt: 1,
                status: "failed" as const,
                elapsed_ms: 2,
                error_code: "content_filtered",
                retry_delay_ms: 0,
              },
            ],
          }
        : model,
    ),
    source,
    3,
    baseline.execution,
  );
}

test("one active review lease rejects duplicate starts across both stages", () => {
  const gate = createReviewRunGate();
  const first = gate.begin()!;
  expect(gate.isActive()).toBe(true);
  expect(gate.begin()).toBeNull();
  expect(first.isCurrent()).toBe(true);
  first.finish();
  expect(first.isCurrent()).toBe(false);
  expect(gate.isActive()).toBe(false);
  expect(gate.begin()).not.toBeNull();
});

test("cancellation invalidates old work and an old finally cannot release a new run", () => {
  const gate = createReviewRunGate();
  const previous = gate.begin()!;
  gate.cancel();
  expect(previous.controller.signal.aborted).toBe(true);
  expect(previous.isCurrent()).toBe(false);
  const current = gate.begin()!;
  previous.finish();
  expect(current.isCurrent()).toBe(true);
  expect(gate.isActive()).toBe(true);
});

test("Findings with reviewable differences unlock manual Second Review but not the Final Report", async () => {
  const baseline = await syntheticBaseline(source);
  const snapshot = JSON.stringify(baseline);
  const state = reviewStageAvailability(baseline, null, false);
  expect(state.secondReviewAvailable).toBe(true);
  expect(state.plan!.candidate_ids).not.toHaveLength(0);
  expect(state.plan!.skipped_reason).toBeNull();
  expect(state.finalReportAvailable).toBe(false);
  expect(state.finalReportReason).toContain("Run Second Review");
  expect(JSON.stringify(baseline)).toBe(snapshot);
});

test("a validated Second Review unlocks Final Report while retaining the exact independent results", async () => {
  const baseline = await syntheticBaseline(source);
  const second = await syntheticSecondReview(source, baseline);
  const original = JSON.stringify({ baseline, second });
  const state = reviewStageAvailability(baseline, second, false);
  expect(state.finalReportAvailable).toBe(true);
  expect(state.finalReportReason).toContain("second-round judgments");
  expect(JSON.stringify({ baseline, second })).toBe(original);
});

test("pending, cancelled or rejected second-review requests cannot unlock a premature Final Report", async () => {
  const baseline = await syntheticBaseline(source);
  const second = await syntheticSecondReview(source, baseline);
  for (const report of [null, second]) {
    const running = reviewStageAvailability(baseline, report, true);
    expect(running.secondReviewAvailable).toBe(false);
    expect(running.finalReportAvailable).toBe(false);
  }
  // A rejected or cancelled response is never stored as an accepted report.
  expect(
    reviewStageAvailability(baseline, null, false).finalReportAvailable,
  ).toBe(false);
  const otherSource = { ...second, source_sha256: "0".repeat(64) };
  expect(
    reviewStageAvailability(baseline, otherSource, false).finalReportAvailable,
  ).toBe(false);
});

test("no disagreement permits a clearly explained first-round Final Report without extra calls", async () => {
  const baseline = await syntheticBaseline(source, "baseline", true);
  const state = reviewStageAvailability(baseline, null, false);
  expect(state.plan!.skipped_reason).toBe("no_disagreements");
  expect(state.finalReportAvailable).toBe(true);
  expect(state.finalReportReason).toContain(
    "No findings require Second Review",
  );
  expect(state.plan!.model_ids).toEqual([]);
});

test("insufficient initial coverage permits an explicitly limited report without inventing reviews", async () => {
  const baseline = await withFailedModels([1, 2]);
  const before = JSON.stringify(baseline);
  const state = reviewStageAvailability(baseline, null, false);
  expect(state.plan!.skipped_reason).toBe("insufficient_reviewers");
  expect(state.finalReportAvailable).toBe(true);
  expect(state.finalReportReason).toContain(
    "requires at least two completed model reviews",
  );
  expect(state.finalReportReason).toContain("available first-round findings");
  expect(state.plan!.model_ids).toEqual([]);
  expect(JSON.stringify(baseline)).toBe(before);
  expect(
    baseline.models.filter((model) => model.status === "succeeded"),
  ).toHaveLength(1);
});

test("a partial initial run only assigns valid reviewers and cannot unlock final before their manual review", async () => {
  const baseline = await withFailedModels([2]);
  const state = reviewStageAvailability(baseline, null, false);
  expect(state.plan!.model_ids).not.toContain(baseline.models[2].model_id);
  expect(state.plan!.model_ids).toEqual([baseline.models[1].model_id]);
  expect(state.finalReportAvailable).toBe(false);
  const second = await syntheticSecondReview(source, baseline);
  expect(
    reviewStageAvailability(baseline, second, false).finalReportAvailable,
  ).toBe(true);
  expect(baseline.models[2].status).toBe("failed");
});

test("source invalidation and legacy reports cannot inherit stages from an earlier result", async () => {
  const baseline = await syntheticBaseline(source);
  const second = await syntheticSecondReview(source, baseline);
  expect(reviewStageAvailability(null, second, false)).toMatchObject({
    plan: null,
    secondReviewAvailable: false,
    finalReportAvailable: false,
  });
  const legacy: CouncilReport = {
    ...baseline,
    schema_version: "2.0.0",
    execution: undefined,
    review_queue: undefined,
  };
  expect(reviewStageAvailability(legacy, null, false)).toMatchObject({
    plan: null,
    secondReviewAvailable: false,
    finalReportAvailable: false,
  });
});
