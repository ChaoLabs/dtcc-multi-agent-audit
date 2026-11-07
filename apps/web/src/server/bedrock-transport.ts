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

const temporaryNetworkCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function isTemporaryNetworkFailure(error: unknown, depth = 0): boolean {
  if (!object(error) || depth > 4) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError")
    return false;
  // Use only structured runtime codes. Message matching could mistake a TLS,
  // URL, input or programming error for a temporary connection failure.
  if (typeof error.code === "string")
    return temporaryNetworkCodes.has(error.code);
  if (Array.isArray(error.errors))
    return (
      error.errors.length > 0 &&
      error.errors.length <= 8 &&
      error.errors.every((entry) => isTemporaryNetworkFailure(entry, depth + 1))
    );
  return isTemporaryNetworkFailure(error.cause, depth + 1);
}

function transportFailure(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted) return timeoutError();
  if (error instanceof Error && isTemporaryNetworkFailure(error))
    return new RequestError(
      "A temporary network interruption prevented a completed Bedrock response. The bounded retry policy applies.",
      502,
      "bedrock_network",
      true,
    );
  return error;
}

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
  } catch (error) {
    throw transportFailure(error, signal);
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

// Diagnostic-only classification. Never return any upstream message, property
// value, schema path or URL. These hints do not change retry or access policy.
const knownProviderExceptions = new Set([
  "ValidationException",
  "ResourceNotFoundException",
  "AccessDeniedException",
  "ExpiredTokenException",
  "UnrecognizedClientException",
  "ThrottlingException",
  "ModelNotReadyException",
  "ModelTimeoutException",
  "ModelErrorException",
  "ServiceUnavailableException",
  "InternalServerException",
]);

function knownProviderException(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256) return null;
  // AWS may prefix __type with a namespace, or suffix an error header with a
  // URL. Only an exact member of our fixed allowlist may leave this function.
  const name = value.split("#").at(-1)?.split(":")[0];
  return name && knownProviderExceptions.has(name) ? name : null;
}

function badRequestCategory(message: string): string | null {
  if (
    /\b(?:output_?config|textformat|json_schema|structured outputs?|output schema|json schema)\b/i.test(
      message,
    )
  )
    return "The provider diagnostic mentions structured-output configuration. Check the schema and this model's supported output format.";
  if (
    /\b(?:input is too long|input length|context length|maximum context|too many input tokens|input token count)\b/i.test(
      message,
    )
  )
    return "The provider diagnostic mentions an input or context limit. Try a smaller contract or peer-review context.";
  if (/\b(?:max_?tokens|temperature|top_?p|inferenceconfig)\b/i.test(message))
    return "The provider diagnostic mentions an inference parameter. Check the configured output-token and generation settings for this model.";
  if (
    /\b(?:model identifier|modelid|inference profile|on-demand throughput)\b/i.test(
      message,
    )
  )
    return "The provider diagnostic mentions a model identifier or inference profile. Check the configured model and region.";
  return null;
}

async function badRequestDiagnostic(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  let exception = knownProviderException(
    response.headers.get("x-amzn-errortype"),
  );
  let category: string | null = null;
  try {
    const raw = await readBounded(
      response.body,
      16_384,
      AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
    );
    const payload: unknown = JSON.parse(raw);
    if (object(payload)) {
      exception ??= knownProviderException(payload.__type);
      const message = payload.message ?? payload.Message;
      if (typeof message === "string") category = badRequestCategory(message);
    }
  } catch {
    // A malformed, oversized, interrupted or stalled diagnostic must never
    // hide the observed HTTP failure or turn it into a retryable error.
  } finally {
    void response.body?.cancel().catch(() => {});
  }
  return [category, exception ? `AWS exception: ${exception}.` : null]
    .filter(Boolean)
    .join(" ");
}

function incompleteDiagnostic(stopReason: unknown): string {
  // Exact allowlist only: upstream reason text may contain private data. Keep
  // these failures terminal; a stop reason is not a transient HTTP failure.
  switch (stopReason) {
    case "max_tokens":
      return "AWS stop reason: max_tokens. The model reached its output token limit before completing the review.";
    case "model_context_window_exceeded":
      return "AWS stop reason: model_context_window_exceeded. The model exceeded its context window; review the input size and model context limits.";
    case "guardrail_intervened":
      return "AWS stop reason: guardrail_intervened. A Bedrock guardrail interrupted the review.";
    case "content_filtered":
      return "AWS stop reason: content_filtered. Bedrock reported content filtering and did not complete the review.";
    case "malformed_model_output":
      return "AWS stop reason: malformed_model_output. Bedrock reported malformed model output.";
    case "malformed_tool_use":
      return "AWS stop reason: malformed_tool_use. Bedrock reported malformed tool use; this review requires a completed JSON response.";
    case "tool_use":
      return "AWS stop reason: tool_use. The model requested a tool action; this review requires a completed JSON response.";
    case "stop_sequence":
      return "AWS stop reason: stop_sequence. The model stopped at a stop sequence without confirming a completed review.";
    default:
      return "Bedrock returned an unknown or missing stop reason. The cause of the incomplete review is not available.";
  }
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
          : model.id === "us.xai.grok-4.7"
            ? { additionalModelRequestFields: { reasoning_effort: "medium" } }
            : {}),
      }),
      signal,
      redirect: "error",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const providerDiagnostic =
      response.status === 400
        ? await badRequestDiagnostic(response, signal)
        : "";
    if (response.status !== 400) void response.body?.cancel().catch(() => {});

    // Only the opaque AWS request identifier and fixed diagnostic labels are
    // retained. Never expose upstream messages, URLs or credential text.
    const rawRequestId = response.headers.get("x-amzn-requestid") ?? "";
    const requestId =
      /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
        rawRequestId,
      )
        ? rawRequestId
        : null;
    const diagnostic = (detail: string) =>
      `${detail} HTTP ${response.status}.${requestId ? ` AWS request ID: ${requestId}.` : ""}`;

    // An actual Bedrock 408 is a provider-side ModelTimeoutException. It may
    // recover on a later attempt inside the SAME model deadline. Local deadline
    // exhaustion and user cancellation never reach this retryable branch.
    if (response.status === 408)
      throw new RequestError(
        diagnostic(
          "Bedrock reached its model processing limit. The bounded retry policy applies while execution time remains.",
        ),
        504,
        "bedrock_model_timeout",
        true,
        retryAfter(response),
      );

    if (response.status === 401 || response.status === 403)
      throw new RequestError(
        diagnostic(
          response.status === 401
            ? "Bedrock rejected the credential. Replace an expired or invalid API key before trying again."
            : `Bedrock denied permission for ${model.label}. Check the key's account permissions, model access and ${BEDROCK.region} region.`,
        ),
        response.status,
        "bedrock_access",
      );

    if (response.status === 429)
      throw new RequestError(
        diagnostic(
          "Bedrock is rate limited. Wait before trying again; check the account's model quota if this persists.",
        ),
        429,
        "bedrock_rate_limit",
        true,
        retryAfter(response),
      );

    if (response.status === 400 || response.status === 404)
      throw new RequestError(
        diagnostic(
          response.status === 404
            ? `Bedrock could not find model ${model.id} in ${BEDROCK.region}. Check the configured inference profile and model availability.`
            : `Bedrock rejected the request for ${model.id}. ${providerDiagnostic || "Check support for the configured model, region and structured output format."}`,
        ),
        502,
        "bedrock_model",
      );

    throw new RequestError(
      diagnostic(
        retryableStatuses.has(response.status)
          ? "Bedrock is temporarily unavailable. The bounded retry policy applies; try a new run later if the service remains unavailable."
          : "Bedrock could not complete this request. It was not automatically retried; check model availability and account access.",
      ),
      502,
      "bedrock_unavailable",
      retryableStatuses.has(response.status),
      retryAfter(response),
    );
  }

  let raw: string;
  try {
    raw = await readBounded(response.body, 256_000, signal);
  } catch (error) {
    // Incoming request bodies and report validation never use this recovery
    // classification: it applies only to reading an outbound AWS response.
    throw transportFailure(error, signal);
  }

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
      `${model.label} did not complete the review. ${incompleteDiagnostic(object(payload) ? payload.stopReason : undefined)} No partial result was accepted.`,
      502,
      object(payload) &&
        (payload.stopReason === "content_filtered" ||
          payload.stopReason === "guardrail_intervened")
        ? payload.stopReason
        : "incomplete",
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
/** One shared attempt/deadline budget; only endpoint-authorized failures retry. */
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
        const jitter = Math.min(
          timing.retryCapMs,
          Math.ceil(
            timing.retryBaseMs *
              2 ** (number - 1) *
              (1 + Math.max(0, Math.min(1, timing.random()))),
          ),
        );
        // The local jitter cap is not a provider Retry-After cap. Honor the
        // provider's minimum delay whenever it fits this model's remaining
        // deadline; otherwise stop without sending an early retry.
        retryDelay = Math.max(jitter, failure.retryAfterMs ?? 0);
        if (
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
