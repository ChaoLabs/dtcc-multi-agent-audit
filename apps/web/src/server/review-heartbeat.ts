import { headers } from "./bedrock-transport";
import { REVIEW_POLICY } from "@/lib/review-policy";

type ReviewHandler = (
  request: Request,
  transport: typeof fetch,
) => Promise<Response>;

/**
 * Quiet, non-streaming models can take longer than an intermediary's idle
 * timeout. Only the opting-in workspace receives leading JSON whitespace.
 * No response headers are committed before admission and the first paid call.
 */
export function deliverReview(
  request: Request,
  run: ReviewHandler,
  upstream: typeof fetch,
  longRequests = REVIEW_POLICY.overall_timeout_ms > 300_000,
  intervalMs = 15_000,
) {
  if (request.headers.get("X-Review-Heartbeat") !== "1" || !longRequests)
    return run(request, upstream);

  const disconnected = new AbortController();
  const signal = AbortSignal.any([request.signal, disconnected.signal]);
  // Next may wrap a route Request in a Proxy. Passing that wrapper as native
  // Request input triggers Node's private-field brand check before admission.
  // Forward the original byte stream (no clone, tee or second body read).
  const init: RequestInit & { duplex: "half" } = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    duplex: "half",
    signal,
  };
  const scoped = new Request(request.url, init);
  let announce!: (response: Response) => void;
  const admitted = new Promise<Response>((resolve) => {
    announce = resolve;
  });
  let started = false;
  const pending: Promise<Response> = run(scoped, (url, init) => {
    signal.throwIfAborted();
    if (!started) {
      started = true;
      // The route's built-in handlers call this transport only after validation
      // and admission. The callback is asynchronous with respect to pending.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1024).fill(32));
          const heartbeat = setInterval(() => {
            if (controller.desiredSize !== null && controller.desiredSize > 0)
              controller.enqueue(Uint8Array.of(10));
          }, intervalMs);
          const stop = () => {
            clearInterval(heartbeat);
            controller.error(new Error("Review connection closed."));
          };
          signal.addEventListener("abort", stop, { once: true });
          // Resolve on a microtask so synchronous transport test doubles and
          // asynchronous route handlers share exactly one completion channel.
          void Promise.resolve()
            .then(() => pending)
            .then(async (response) => {
              clearInterval(heartbeat);
              if (!response.ok || signal.aborted || !response.body) {
                void response.body?.cancel().catch(() => {});
                throw new Error("The review did not return a complete report.");
              }
              // Internal handlers produce one already-bounded, canonical JSON
              // response. Never expose an intermediate model response.
              const bytes = new Uint8Array(await response.arrayBuffer());
              if (!signal.aborted) {
                controller.enqueue(bytes);
                controller.close();
              }
            })
            .catch(stop)
            .finally(() => {
              clearInterval(heartbeat);
              signal.removeEventListener("abort", stop);
            });
        },
        cancel() {
          disconnected.abort();
        },
      });
      announce(
        new Response(stream, {
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Cache-Control": "no-store, private, no-transform",
            "X-Accel-Buffering": "no",
          },
        }),
      );
    }
    return upstream(url, init);
  });
  return Promise.race([admitted, pending]);
}
