import { expect, test } from "@playwright/test";
import cases from "../src/generated/cases.json";
import { requestSecondReview } from "../src/lib/second-review-client";
import {
  syntheticBaseline,
  syntheticSecondReview,
} from "./second-review-fixtures";

const key = "bedrock-api-key-SYNTHETIC_CLIENT_ONLY";
const source = cases[0].report.input.source;
const filename = cases[0].report.input.filename;
async function input() {
  return {
    apiKey: key,
    filename,
    source,
    baseline: await syntheticBaseline(source),
    signal: new AbortController().signal,
  };
}

test("second-review client validates the exact baseline and makes one credential-free-cookies POST", async () => {
  const options = await input();
  let calls = 0;
  const result = await requestSecondReview({
    ...options,
    transport: async (url, init) => {
      calls++;
      expect(url).toBe("/api/reviews/second-round");
      expect(init).toMatchObject({
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        api_key: key,
        filename,
        source,
        baseline: options.baseline,
      });
      return Response.json(
        await syntheticSecondReview(source, options.baseline),
      );
    },
  });
  expect(calls).toBe(1);
  expect(result.status).toBe("completed");
  expect(options.baseline.findings[0].agreement).toBe(1);
  expect(result.findings[0].supporting_models).toHaveLength(3);
  expect(JSON.stringify(result)).not.toContain(key);
});

for (const status of [401, 403, 429, 500, 413]) {
  test(`HTTP ${status} does not leak its body or cause client retries`, async () => {
    let calls = 0;
    await expect(
      requestSecondReview({
        ...(await input()),
        transport: async () => {
          calls++;
          return new Response(key, { status });
        },
      }),
    ).rejects.toMatchObject({
      status,
      message: expect.not.stringContaining(key),
    });
    expect(calls).toBe(1);
  });
}

test("abort interrupts a stalled response body and retains no credential-bearing diagnostic", async () => {
  const abort = new AbortController();
  let cancelled = false;
  const pending = requestSecondReview({
    ...(await input()),
    signal: abort.signal,
    transport: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"models":'));
            setTimeout(() => abort.abort(), 5);
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  expect(cancelled).toBe(true);
});

test("abort interrupts a transport that ignores its signal without waiting for its completion", async () => {
  const abort = new AbortController();
  const pending = requestSecondReview({
    ...(await input()),
    signal: abort.signal,
    transport: async () => {
      setTimeout(() => abort.abort(), 5);
      return new Promise<Response>(() => {});
    },
  });
  await expect(pending).rejects.toMatchObject({ code: "cancelled" });
});

test("wrong baseline hash and malformed bodies cannot enter client state", async () => {
  const options = await input();
  const result = await syntheticSecondReview(source, options.baseline);
  result.baseline_sha256 = "0".repeat(64);
  await expect(
    requestSecondReview({
      ...options,
      transport: async () => Response.json(result),
    }),
  ).rejects.toThrow("could not be validated");
});

test("oversized responses are cancelled before parsing", async () => {
  await expect(
    requestSecondReview({
      ...(await input()),
      transport: async () => new Response("x".repeat(1_500_001)),
    }),
  ).rejects.toThrow("could not be validated");
});

test("invalid key and pre-aborted request make no HTTP calls", async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    return Response.json({});
  };
  await expect(
    requestSecondReview({ ...(await input()), apiKey: "bad", transport }),
  ).rejects.toThrow();
  const abort = new AbortController();
  abort.abort();
  await expect(
    requestSecondReview({
      ...(await input()),
      signal: abort.signal,
      transport,
    }),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(calls).toBe(0);
});

test("escaped decoded credential text is rejected after JSON parsing", async () => {
  const options = await input();
  const credentialText = "SYNTHETIC_PRIVATE_PAYLOAD_1234567890";
  const specialKey = `bedrock-api-key-${btoa(credentialText)}`;
  const result = await syntheticSecondReview(source, options.baseline);
  result.models[0].review!.summary = credentialText;
  const escaped = JSON.stringify(result).replace(
    credentialText,
    [...credentialText]
      .map(
        (character) =>
          `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
      )
      .join(""),
  );
  expect(escaped).not.toContain(credentialText);
  await expect(
    requestSecondReview({
      ...options,
      apiKey: specialKey,
      transport: async () => new Response(escaped),
    }),
  ).rejects.toThrow("could not be validated");
});
