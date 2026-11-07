import { expect, test } from "@playwright/test";
import { BEDROCK_MODELS } from "../src/lib/bedrock-config";
import {
  invokeBedrockJson,
  RequestError,
  runBoundedModel,
  type ReviewTiming,
} from "../src/server/bedrock-transport";

const timing: ReviewTiming = {
  modelTimeoutMs: 1_000,
  overallTimeoutMs: 1_500,
  retryBaseMs: 0,
  retryCapMs: 5_000,
  minimumAttemptBudgetMs: 0,
  random: () => 0,
};
const credential = "bedrock-api-key-SYNTHETIC_TIMEOUT_TEST";

function completed() {
  return Response.json({
    stopReason: "end_turn",
    output: { message: { content: [{ text: '{"complete":true}' }] } },
    usage: { inputTokens: 10, outputTokens: 5 },
  });
}

function invoke(
  model: (typeof BEDROCK_MODELS)[number],
  transport: typeof fetch,
  signal: AbortSignal,
) {
  return invokeBedrockJson({
    model,
    key: credential,
    system: "Return JSON.",
    context: { source_lines: [{ line: 1, text: "contract C {}" }] },
    outputConfig: {},
    signal,
    transport,
  });
}

function supervise(
  transport: typeof fetch,
  settings = timing,
  signal = new AbortController().signal,
  model: (typeof BEDROCK_MODELS)[number] = BEDROCK_MODELS[2],
) {
  return runBoundedModel({
    model,
    signal,
    overallDeadline: performance.now() + settings.overallTimeoutMs,
    timing: settings,
    run: (modelSignal) => invoke(model, transport, modelSignal),
  });
}

test("only an actual upstream 408 receives the provider-timeout recovery classification", async () => {
  const error = await invoke(
    BEDROCK_MODELS[2],
    async () =>
      new Response(`PRIVATE_TIMEOUT ${credential}`, {
        status: 408,
        headers: { "retry-after": "0.025" },
      }),
    new AbortController().signal,
  ).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(RequestError);
  expect(error).toMatchObject({
    code: "bedrock_model_timeout",
    retryable: true,
    retryAfterMs: 25,
  });
  expect((error as RequestError).detail).toContain("HTTP 408");
  expect((error as RequestError).detail).not.toContain("PRIVATE_TIMEOUT");
  expect((error as RequestError).detail).not.toContain(credential);
});

test("two remote timeouts can recover on the third attempt without rerunning successful models", async () => {
  const calls = new Map<string, number>();
  const transport: typeof fetch = async (url) => {
    const id = BEDROCK_MODELS.find((model) =>
      String(url).includes(model.id),
    )!.id;
    const count = (calls.get(id) ?? 0) + 1;
    calls.set(id, count);
    if (id === BEDROCK_MODELS[2].id && count < 3)
      return new Response("", { status: 408 });
    return completed();
  };
  const results = await Promise.all(
    BEDROCK_MODELS.map((model) =>
      supervise(transport, timing, new AbortController().signal, model),
    ),
  );
  expect(BEDROCK_MODELS.map((model) => calls.get(model.id))).toEqual([1, 1, 3]);
  expect(results.every((result) => result.status === "succeeded")).toBe(true);
  expect(results[2].attempts.map((attempt) => attempt.error_code)).toEqual([
    "bedrock_model_timeout",
    "bedrock_model_timeout",
    null,
  ]);
  expect(results[2].review?.content).toEqual({ complete: true });
});

test("persistent remote timeouts stop after three requests and never invent a completed review", async () => {
  let calls = 0;
  const result = await supervise(async () => {
    calls++;
    return new Response("PRIVATE_ERROR", { status: 408 });
  });
  expect(calls).toBe(3);
  expect(result.status).toBe("failed");
  expect(result.review).toBeNull();
  expect(result.error?.code).toBe("bedrock_model_timeout");
  expect(result.attempts).toHaveLength(3);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_ERROR");
});

test("retry jitter grows exponentially within its cap and still honors Retry-After", async () => {
  for (const providerDelay of [null, "0.012"]) {
    let calls = 0;
    const started = performance.now();
    const result = await supervise(
      async () => {
        calls++;
        return calls < 3
          ? new Response("", {
              status: 408,
              headers: providerDelay ? { "retry-after": providerDelay } : {},
            })
          : completed();
      },
      { ...timing, retryBaseMs: 4, retryCapMs: 6 },
    );
    expect(result.status).toBe("succeeded");
    const waits = providerDelay ? [0, 12, 12] : [0, 4, 6];
    expect(result.attempts.map((attempt) => attempt.retry_delay_ms)).toEqual(
      waits,
    );
    expect(performance.now() - started).toBeGreaterThanOrEqual(
      waits.reduce((sum, wait) => sum + wait, 0),
    );
  }
});

test("a provider timeout cannot reset the shared deadline for its next attempt", async () => {
  let calls = 0;
  let aborted = false;
  const started = performance.now();
  const result = await supervise(
    async (_url, init) => {
      calls++;
      if (calls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response("", { status: 408 });
      }
      init?.signal?.addEventListener("abort", () => (aborted = true), {
        once: true,
      });
      return new Promise<Response>(() => {});
    },
    { ...timing, modelTimeoutMs: 60, overallTimeoutMs: 120 },
  );
  expect(calls).toBe(2);
  expect(aborted).toBe(true);
  expect(result.error?.code).toBe("timeout");
  expect(result.review).toBeNull();
  expect(result.attempts.map((attempt) => attempt.error_code)).toEqual([
    "bedrock_model_timeout",
    "timeout",
  ]);
  expect(performance.now() - started).toBeLessThan(500);
});

test("user cancellation during remote-timeout backoff starts no additional request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await supervise(
    async () => {
      calls++;
      setTimeout(() => controller.abort(), 5);
      return new Response("", {
        status: 408,
        headers: { "retry-after": "0.05" },
      });
    },
    timing,
    controller.signal,
  );
  expect(calls).toBe(1);
  expect(result.error?.code).toBe("timeout");
  expect(result.attempts).toHaveLength(1);
  expect(result.attempts[0].error_code).toBe("bedrock_model_timeout");
  expect(result.review).toBeNull();
});
