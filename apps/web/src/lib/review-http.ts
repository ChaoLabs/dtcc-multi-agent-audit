// An opting-in client accepts legal JSON whitespace while an admitted long
// review is running. Older servers can ignore this header and return normal JSON.
export const reviewHeaders = {
  "Content-Type": "application/json",
  "X-Review-Heartbeat": "1",
} as const;

/** Independent reports include evidence for up to three models plus aggregation. */
export async function readCouncilJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  // The API can be replaced by an HTML error page or a truncated stream from
  // an intermediary. Keep the status for diagnosis; never display its body.
  const transportFailure = (reason: string) =>
    new Error(`Review service (HTTP ${response.status}): ${reason}`);
  if (signal.aborted) {
    void response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
  }
  if (
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ===
    "text/html"
  ) {
    void response.body?.cancel().catch(() => {});
    throw transportFailure("an HTML page was returned instead of a report.");
  }
  if (!response.body) throw transportFailure("no report was received.");
  const reader = response.body.getReader();
  const limit = response.ok ? 8 * 1024 * 1024 : 16_384;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  const decode = (bytes?: Uint8Array) => {
    try {
      return bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode();
    } catch {
      throw transportFailure("the response was not valid UTF-8.");
    }
  };
  let size = 0;
  const abort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const next = await reader.read().catch(() => {
        signal.throwIfAborted();
        throw transportFailure(
          "the connection closed before the report was delivered.",
        );
      });
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit)
        throw new Error("The review response exceeded its size limit.");
      chunks.push(decode(next.value));
    }
    chunks.push(decode());
    const raw = chunks.join("");
    if (!raw.trim())
      throw transportFailure("the response ended without a report.");
    try {
      return JSON.parse(raw);
    } catch {
      throw transportFailure(
        raw.trimStart().startsWith("<")
          ? "an HTML page was returned instead of a report."
          : "the response was incomplete or was not valid JSON.",
      );
    }
  } catch (error) {
    abort();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
