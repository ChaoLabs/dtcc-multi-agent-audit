// Server only. A slow non-streaming model can spend minutes computing before
// sending HTTP headers. Let the review's AbortSignal own that deadline.
import { Agent, fetch as fetchUpstream, type Dispatcher } from "undici";
import { BEDROCK, BEDROCK_MODELS } from "@/lib/bedrock-config";
import { REVIEW_POLICY } from "@/lib/review-policy";

const runtimeOrigin = `https://bedrock-runtime.${BEDROCK.region}.amazonaws.com`;
const endpoints = new Set(
  BEDROCK_MODELS.map(({ id }) => `${runtimeOrigin}/model/${id}/converse`),
);
const upstreamTimeout = REVIEW_POLICY.model_timeout_ms + 5_000;
const dispatcher = new Agent({
  connections: 12,
  headersTimeout: upstreamTimeout,
  bodyTimeout: upstreamTimeout,
});

export function bedrockFetchWith(agent: Dispatcher): typeof fetch {
  return async (url, init) => {
    if (
      typeof url !== "string" ||
      !endpoints.has(url) ||
      init?.method !== "POST" ||
      typeof init.body !== "string" ||
      !init.signal
    )
      throw new TypeError("Invalid Bedrock transport request.");
    const response = await fetchUpstream(url, {
      method: "POST",
      headers: Array.from(new Headers(init.headers)),
      body: init.body,
      signal: init.signal,
      redirect: "error",
      dispatcher: agent,
    });
    // Node and TypeScript's DOM library give web streams different static types.
    // Undici uses Node's native Web Streams. Preserve streaming and cancellation.
    const body = response.body;
    if (body !== null && !(body instanceof ReadableStream))
      throw new TypeError("Unexpected Bedrock response stream.");
    return new Response(body, {
      status: response.status,
      headers: Array.from(response.headers),
    });
  };
}

export const fetchBedrock = bedrockFetchWith(dispatcher);
