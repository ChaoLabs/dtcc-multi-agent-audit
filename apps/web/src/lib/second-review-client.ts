import { validateApiKey } from "@/lib/bedrock-config";
import type { CouncilReport } from "@/lib/orchestration";
import {
  validateSecondReviewReport,
  type SecondReviewReport,
} from "@/lib/second-review";

/** Fixed diagnostics only: never show upstream bodies or thrown network text. */
export class SecondReviewRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly code = "second_review_failed",
  ) {
    super(message);
    this.name = "SecondReviewRequestError";
  }
}

function aborted() {
  return new SecondReviewRequestError(
    "Second review stopped or reached its time limit. The independent review is retained.",
    null,
    "cancelled",
  );
}

/** One request, no browser retries; the server owns the finite attempt budget. */
export async function requestSecondReview({
  apiKey,
  filename,
  source,
  baseline,
  signal,
  transport = fetch,
}: {
  apiKey: string;
  filename: string;
  source: string;
  baseline: CouncilReport;
  signal: AbortSignal;
  transport?: typeof fetch;
}): Promise<SecondReviewReport> {
  const key = validateApiKey(apiKey);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 235_000);
  const bounded = AbortSignal.any([signal, deadline.signal]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectAbort: (error: unknown) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  // Prevent an abort during synchronous validation from leaving an unhandled rejection.
  void interrupted.catch(() => {});
  const abort = () => {
    rejectAbort(aborted());
    void reader?.cancel().catch(() => {});
  };
  bounded.addEventListener("abort", abort, { once: true });
  try {
    if (bounded.aborted) throw aborted();
    const pending = transport("/api/reviews/second-round", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, filename, source, baseline }),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: bounded,
    }).then((response) => {
      if (bounded.aborted) {
        void response.body?.cancel().catch(() => {});
        throw aborted();
      }
      return response;
    });
    const response = await Promise.race([pending, interrupted]);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const access = [401, 403].includes(response.status);
      throw new SecondReviewRequestError(
        access
          ? "Second review was denied. Check the Bedrock connection. The independent review is retained."
          : response.status === 429
            ? "Second review reached a rate limit. The independent review is retained."
            : response.status === 413
              ? "The review exceeds the second-round size limit. Keep the independent report for manual review."
              : "Second review did not return a valid result. The independent review is retained.",
        response.status,
        access
          ? "access"
          : response.status === 429
            ? "rate_limit"
            : "request_failed",
      );
    }
    if (!response.body) throw new Error("Empty response");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      if (bounded.aborted) throw aborted();
      const part = await Promise.race([reader.read(), interrupted]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1_500_000) {
        void reader.cancel().catch(() => {});
        throw new Error("Oversized response");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let decodedKey = "";
    try {
      decodedKey = atob(
        key
          .slice("bedrock-api-key-".length)
          .replace(/-/g, "+")
          .replace(/_/g, "/"),
      );
    } catch {
      /* A token need not contain decodable text. */
    }
    if (
      raw.includes(key) ||
      (decodedKey.length >= 16 && raw.includes(decodedKey))
    )
      throw new Error("Credential echo");
    const value: unknown = JSON.parse(raw);
    const decoded = JSON.stringify(value);
    if (
      decoded.includes(key) ||
      (decodedKey.length >= 16 && decoded.includes(decodedKey))
    )
      throw new Error("Credential echo");
    const result = await validateSecondReviewReport(value, source, baseline);
    if (bounded.aborted) throw aborted();
    return result;
  } catch (error) {
    if (bounded.aborted) throw aborted();
    if (error instanceof SecondReviewRequestError) throw error;
    throw new SecondReviewRequestError(
      "Second review could not be validated. The independent review is retained.",
    );
  } finally {
    clearTimeout(timer);
    bounded.removeEventListener("abort", abort);
    reader?.releaseLock();
  }
}
