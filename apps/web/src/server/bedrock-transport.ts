// Shared server-only transport and bounded supervisor for both review rounds.
import { createHash } from "node:crypto";
import { BEDROCK, BEDROCK_MODELS } from "@/lib/bedrock-config";
import { REVIEW_POLICY } from "@/lib/review-policy";
import type { ModelAttempt } from "@/lib/orchestration";

export class RequestError extends Error {
  constructor(
    readonly detail: string,
    readonly status = 502,
    readonly code = "review_failed",
    readonly retryable = false,
    readonly retryAfterMs: number | null = null,
  ) {
    super(detail);
  }
}

// A bounded per-instance guard, not a distributed rate limit or user identity store.
export function createLimiter() {
  const entries = new Map<
    string,
    { start: number; count: number; active: boolean }
  >();
  let active = 0;
  return (key: string) => {
    const now = Date.now();
    for (const [id, entry] of entries)
      if (!entry.active && now - entry.start >= 60_000) entries.delete(id);
    const id = createHash("sha256").update(key).digest("hex");
    const entry = entries.get(id) ?? { start: now, count: 0, active: false };
    if (
      entry.active ||
      entry.count >= 12 ||
      active >= 4 ||
      (!entries.has(id) && entries.size >= 1000)
    )
      throw new RequestError(
        "Analysis is busy. Wait a moment before trying again.",
        429,
        "busy",
      );
    entry.active = true;
    entry.count++;
    active++;
    entries.set(id, entry);
    return () => {
      entry.active = false;
      active--;
    };
  };
}
export const acquire = createLimiter();

// Test injection is module-only. HTTP requests cannot alter these resource limits.
export type ReviewTiming = {
  modelTimeoutMs: number;
  overallTimeoutMs: number;
  retryBaseMs: number;
  retryCapMs: number;
  minimumAttemptBudgetMs: number;
  random: () => number;
};
export const defaultTiming: ReviewTiming = {
  modelTimeoutMs: REVIEW_POLICY.model_timeout_ms,
  overallTimeoutMs: REVIEW_POLICY.overall_timeout_ms,
  retryBaseMs: 500,
  retryCapMs: 5_000,
  minimumAttemptBudgetMs: 1_000,
  random: Math.random,
};
export const retryableStatuses = new Set([429, 500, 502, 503, 504]);

export function timeoutError() {
  return new RequestError(
    "Analysis timed out or was cancelled. Static results remain available.",
    504,
    "timeout",
  );
}

function retryAfter(response: Response): number | null {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;
  // Honor the provider's minimum delay; a long delay is rejected by the budget,
  // never shortened. Invalid headers fall back to the local jitter policy.
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const milliseconds = Number(value) * 1000;
    return Number.isFinite(milliseconds) ? Math.ceil(milliseconds) : Infinity;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(timeoutError());
  return new Promise((resolve, reject) => {
    const until = performance.now() + milliseconds;
    const finish = () => {
      const remaining = until - performance.now();
      if (remaining > 0) {
        timer = setTimeout(finish, Math.ceil(remaining));
        return;
      }
      signal.removeEventListener("abort", abort);
      resolve();
    };
    let timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(timeoutError());
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function fetchBounded(
  transport: typeof fetch,
  url: string,
  init: RequestInit & { signal: AbortSignal },
) {
  const { signal } = init;
  if (signal.aborted) throw timeoutError();
  let rejectAbort: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => rejectAbort(timeoutError());
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw timeoutError();
    const pending = transport(url, init).then((response) => {
      // Defensive cleanup even if a custom transport settles after cancellation.
      if (signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw timeoutError();
      }
      return response;
    });
    return await Promise.race([pending, interrupted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
export function sameOrigin(request: Request) {
  const raw = request.headers.get("origin");
  if (!raw) return false;
  try {
    const origin = new URL(raw);
    // Next's internal request URL may use localhost behind a reverse proxy.
    // Host is the actual incoming authority; never accept arbitrary forwarded hosts.
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const secure =
      origin.protocol === "https:" ||
      (origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
    return secure && origin.origin === raw && origin.host === host;
  } catch {
    return false;
  }
}

export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
) {
  const checkAbort = () => {
    if (signal.aborted)
      throw new RequestError(
        "Analysis timed out or was cancelled. Static results remain available.",
        504,
        "timeout",
      );
  };
  checkAbort();
  if (!body)
    throw new RequestError(
      "Empty response or request body.",
      400,
      "invalid_body",
    );
  const reader = body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  let rejectAbort: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    rejectAbort(
      new RequestError(
        "Analysis timed out or was cancelled. Static results remain available.",
        504,
        "timeout",
      ),
    );
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    while (true) {
      checkAbort();
      const part = await Promise.race([reader.read(), interrupted]);
      checkAbort();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new RequestError(
          "Data exceeds the supported size limit.",
          413,
          "too_large",
        );
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

export const headers = {
  "Cache-Control": "no-store, private",
  "Vercel-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export const tokens = (value: unknown) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 10_000_000
    ? value
    : null;

export type BedrockModel = (typeof BEDROCK_MODELS)[number];

/** No returned response or peer context may expose the supplied credential. */
export function assertCredentialAbsent(value: string, key: string): void {
  const secrets = [key];
  // Short-term bearer keys encode a signed URL. Reject that decoded secret too.
  // Synthetic or non-UTF8 keys have no meaningful decoded representation.
  try {
    const encoded = key.slice("bedrock-api-key-".length);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(encoded, "base64"),
    );
    if (decoded.length >= 32 && /^[\x20-\x7e]+$/.test(decoded)) {
      secrets.push(decoded);
      try {
        const url = new URL(
          decoded.startsWith("https://") ? decoded : `https://${decoded}`,
        );
        for (const name of ["X-Amz-Security-Token", "X-Amz-Signature"]) {
          const secret = url.searchParams.get(name);
          if (secret && secret.length >= 32) secrets.push(secret);
        }
      } catch {
        /* Non-URL long-term credentials need only exact matching. */
      }
    }
  } catch {
    /* An opaque token is checked in its original form. */
  }
  if (secrets.some((secret) => value.includes(secret)))
    throw new RequestError(
      "The review contains credential material and was rejected.",
      502,
      "invalid_report",
    );
}

/** Fixed-origin Converse transport; callers own schema and source validation. */
export async function invokeBedrockJson({
  model,
  key,
  system,
  context,
  outputConfig,
  signal,
  transport,
}: {
  model: BedrockModel;
  key: string;
  system: string;
  context: unknown;
  outputConfig: unknown;
  signal: AbortSignal;
  transport: typeof fetch;
}) {
  const started = performance.now();

  assertCredentialAbsent(JSON.stringify(context), key);
  const response = await fetchBounded(
    transport,
    `https://bedrock-runtime.${BEDROCK.region}.amazonaws.com/model/${model.id}/converse`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system: [{ text: system }],
        messages: [
          { role: "user", content: [{ text: JSON.stringify(context) }] },
        ],
        inferenceConfig: { maxTokens: REVIEW_POLICY.max_output_tokens },
        outputConfig,
        ...(model.id === "us.openai.gpt-6.1-sol"
          ? {
              additionalModelRequestFields: {
                text: { format: { strict: true } },
              },
            }
          : {}),
      }),
      signal,
      redirect: "error",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    void response.body?.cancel().catch(() => {});

    if (response.status === 401 || response.status === 403)
      throw new RequestError(
        `Bedrock denied access. Check access to ${model.label} in ${BEDROCK.region}.`,
        401,
        "bedrock_access",
      );

    if (response.status === 429)
      throw new RequestError(
        "Bedrock is rate limited. Wait before trying again.",
        429,
        "bedrock_rate_limit",
        true,
        retryAfter(response),
      );

    if (response.status === 400 || response.status === 404)
      throw new RequestError(
        `Bedrock could not use model ${model.id}.`,
        502,
        "bedrock_model",
      );

    throw new RequestError(
      "Bedrock is temporarily unavailable. Try again later.",
      502,
      "bedrock_unavailable",
      retryableStatuses.has(response.status),
      retryAfter(response),
    );
  }

  const raw = await readBounded(response.body, 256_000, signal);

  assertCredentialAbsent(raw, key);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new RequestError(
      `${model.label} returned invalid JSON.`,
      502,
      "invalid_report",
    );
  }

  if (!object(payload) || payload.stopReason !== "end_turn")
    throw new RequestError(
      `${model.label} did not complete the review. Try a smaller contract.`,
      502,
      "incomplete",
    );

  const output = payload.output;
  const message = object(output) ? output.message : null;
  const blocks = object(message) ? message.content : null;

  if (!Array.isArray(blocks))
    throw new RequestError(`${model.label} returned an unreadable report.`);

  let text = blocks
    .filter((b) => object(b) && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();

  if (text.startsWith("```json\n") && text.endsWith("```"))
    text = text.slice(8, -3).trim();

  let content: unknown;
  try {
    content = JSON.parse(text);
  } catch {
    throw new RequestError(
      `${model.label} returned invalid JSON. Try again with a smaller source.`,
      502,
      "invalid_report",
    );
  }

  assertCredentialAbsent(JSON.stringify(content), key);
  const usage = object(payload.usage) ? payload.usage : {};
  return {
    content,
    elapsed_ms: Math.round(performance.now() - started),
    input_tokens: tokens(usage.inputTokens),
    output_tokens: tokens(usage.outputTokens),
  };
}
/** One deadline across all attempts; only explicit temporary HTTP failures retry. */
export async function runBoundedModel<T extends { elapsed_ms: number }>({
  model,
  signal,
  overallDeadline,
  timing,
  run,
}: {
  model: BedrockModel;
  signal: AbortSignal;
  overallDeadline: number;
  timing: ReviewTiming;
  run: (signal: AbortSignal) => Promise<T>;
}): Promise<{
  model_id: string;
  label: string;
  status: "succeeded" | "failed";
  elapsed_ms: number;
  attempts: ModelAttempt[];
  review: T | null;
  error: { code: string; detail: string } | null;
}> {
  const modelStart = performance.now();
  const deadline = Math.min(
    modelStart + timing.modelTimeoutMs,
    overallDeadline,
  );
  const modelSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(timing.modelTimeoutMs),
  ]);
  const attempts: ModelAttempt[] = [];
  const elapsed = () =>
    Math.max(
      Math.round(performance.now() - modelStart),
      attempts.reduce(
        (total, attempt) => total + attempt.elapsed_ms + attempt.retry_delay_ms,
        0,
      ),
    );
  let retryDelay = 0;
  let failure = timeoutError();
  try {
    for (
      let number = 1;
      number <= REVIEW_POLICY.max_attempts_per_model;
      number++
    ) {
      if (modelSignal.aborted || performance.now() >= deadline)
        throw timeoutError();
      const attemptStart = performance.now();
      try {
        const review = await run(modelSignal);
        if (modelSignal.aborted || performance.now() >= deadline)
          throw timeoutError();
        attempts.push({
          attempt: number,
          status: "succeeded",
          elapsed_ms: Math.max(
            Math.round(performance.now() - attemptStart),
            review.elapsed_ms,
          ),
          error_code: null,
          retry_delay_ms: retryDelay,
        });
        return {
          model_id: model.id,
          label: model.label,
          status: "succeeded",
          elapsed_ms: elapsed(),
          attempts,
          review,
          error: null,
        };
      } catch (error) {
        failure = modelSignal.aborted
          ? timeoutError()
          : error instanceof RequestError
            ? error
            : new RequestError(
                `${model.label} could not complete its review.`,
                502,
                "review_failed",
              );
        attempts.push({
          attempt: number,
          status: "failed",
          elapsed_ms: Math.round(performance.now() - attemptStart),
          error_code: failure.code,
          retry_delay_ms: retryDelay,
        });
        if (
          modelSignal.aborted ||
          !failure.retryable ||
          number === REVIEW_POLICY.max_attempts_per_model
        )
          break;
        const jitter = Math.ceil(
          timing.retryBaseMs * (1 + Math.max(0, Math.min(1, timing.random()))),
        );
        retryDelay = Math.max(jitter, failure.retryAfterMs ?? 0);
        if (
          retryDelay > timing.retryCapMs ||
          retryDelay + timing.minimumAttemptBudgetMs >=
            deadline - performance.now()
        )
          break;
        await pause(retryDelay, modelSignal);
      }
    }
  } catch {
    // Backoff cancellation consumes no new AWS request and keeps the prior
    // transient failure in the attempt history for diagnosis.
    failure = timeoutError();
  }
  return {
    model_id: model.id,
    label: model.label,
    status: "failed",
    elapsed_ms: elapsed(),
    attempts,
    review: null,
    error: { code: failure.code, detail: failure.detail },
  };
}
