import { expect, test } from "@playwright/test";
import { maxDuration as firstRouteDuration } from "../src/app/api/reviews/route";
import { maxDuration as secondRouteDuration } from "../src/app/api/reviews/second-round/route";
import {
  REVIEW_CLIENT_TIMEOUT_MS,
  REVIEW_POLICY,
} from "../src/lib/review-policy";
import { requestSecondReview } from "../src/lib/second-review-client";
import { EVALUATION_CASES, runEvaluation } from "../src/lib/evaluation";
import {
  syntheticBaseline,
  syntheticSecondReview,
} from "./second-review-fixtures";

const key = "bedrock-api-key-SYNTHETIC_DEADLINES_ONLY";

// Advance only long application timers. Provider calls remain synthetic; tests
// exercise cancellation without waiting several minutes or changing wall time.
function applicationClock() {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const pending = new Map<
    ReturnType<typeof setTimeout>,
    { at: number; fire: () => void }
  >();
  const scheduled: number[] = [];
  let now = 0;
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    const handle = originalSet(callback, delay, ...args);
    if (typeof delay === "number" && delay >= 200_000) {
      scheduled.push(delay);
      pending.set(handle, { at: now + delay, fire: () => callback(...args) });
    }
    return handle;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    pending.delete(handle);
    originalClear(handle);
  }) as typeof clearTimeout;
  return {
    scheduled,
    advance(milliseconds: number) {
      now += milliseconds;
      for (const [handle, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(handle);
          originalClear(handle);
          timer.fire();
        }
      }
    },
    restore() {
      for (const handle of pending.keys()) originalClear(handle);
      globalThis.setTimeout = originalSet;
      globalThis.clearTimeout = originalClear;
    },
  };
}

test("both routes leave finalization and browser headroom inside the 300-second deployment cap", () => {
  expect(REVIEW_POLICY.model_timeout_ms).toBe(270_000);
  expect(REVIEW_POLICY.overall_timeout_ms).toBeGreaterThan(
    REVIEW_POLICY.model_timeout_ms,
  );
  expect(REVIEW_CLIENT_TIMEOUT_MS).toBeGreaterThan(
    REVIEW_POLICY.overall_timeout_ms,
  );
  for (const limit of [firstRouteDuration, secondRouteDuration]) {
    expect(limit).toBe(300);
    expect(REVIEW_CLIENT_TIMEOUT_MS).toBeLessThan(limit * 1000);
  }
});

test("a delayed valid second review survives the former browser cutoff without another request", async () => {
  const fixture = EVALUATION_CASES[0];
  const baseline = await syntheticBaseline(fixture.source);
  const result = await syntheticSecondReview(fixture.source, baseline);
  const clock = applicationClock();
  let calls = 0;
  let finish!: (response: Response) => void;
  let requestSignal!: AbortSignal;
  try {
    const response = requestSecondReview({
      apiKey: key,
      filename: fixture.filename,
      source: fixture.source,
      baseline,
      signal: new AbortController().signal,
      transport: async (_url, init) => {
        calls++;
        requestSignal = init!.signal!;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      },
    });
    clock.advance(250_000);
    expect(requestSignal.aborted).toBe(false);
    finish(Response.json(result));
    expect((await response).status).toBe("completed");
    expect(calls).toBe(1);
    expect(clock.scheduled).toEqual([REVIEW_CLIENT_TIMEOUT_MS]);
  } finally {
    clock.restore();
  }
});

test("the extended client deadline still interrupts a stalled provider response with no outer retry", async () => {
  const fixture = EVALUATION_CASES[0];
  const baseline = await syntheticBaseline(fixture.source);
  const clock = applicationClock();
  let calls = 0;
  try {
    const pending = requestSecondReview({
      apiKey: key,
      filename: fixture.filename,
      source: fixture.source,
      baseline,
      signal: new AbortController().signal,
      transport: async () => {
        calls++;
        return new Promise<Response>(() => {});
      },
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: "cancelled",
    });
    clock.advance(REVIEW_CLIENT_TIMEOUT_MS);
    await rejected;
    expect(calls).toBe(1);
  } finally {
    clock.restore();
  }
});

for (const paired of [false, true]) {
  test(`five-case ${paired ? "paired" : "independent"} validation reserves the full browser budget for every round`, async () => {
    const clock = applicationClock();
    let calls = 0;
    try {
      const result = await runEvaluation({
        apiKey: key,
        promptVariant: "baseline",
        includeSecondReview: paired,
        signal: new AbortController().signal,
        transport: async (url, init) => {
          calls++;
          const body = JSON.parse(String(init!.body));
          expect(init!.signal!.aborted).toBe(false);
          clock.advance(250_000);
          expect(init!.signal!.aborted).toBe(false);
          return Response.json(
            url === "/api/reviews"
              ? await syntheticBaseline(body.source)
              : await syntheticSecondReview(body.source, body.baseline),
          );
        },
      });
      expect(result.status).toBe("completed");
      expect(result.cases.every((entry) => entry.status === "completed")).toBe(
        true,
      );
      expect(calls).toBe(paired ? 10 : 5);
      expect(clock.scheduled[0]).toBe(
        EVALUATION_CASES.length * (paired ? 2 : 1) * REVIEW_CLIENT_TIMEOUT_MS +
          30_000,
      );
    } finally {
      clock.restore();
    }
  });
}
