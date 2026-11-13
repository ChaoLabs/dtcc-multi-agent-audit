import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MockAgent } from "undici";
import { bedrockFetchWith } from "../src/server/bedrock-fetch";
import supplemental from "../src/generated/supplemental-cases.json";
import { BEDROCK_MODELS } from "../src/lib/bedrock-config";
import { buildFinalReviewReport } from "../src/lib/final-report";
import { validateCouncil } from "../src/lib/orchestration";
import { validateResponse } from "../src/lib/report";
import { validateSecondReviewReport } from "../src/lib/second-review";
import { analyzeStatic, sourceLines } from "../src/lib/static-analysis";
import { createLimiter, handleReview } from "../src/server/bedrock";
import { handleSecondReview } from "../src/server/second-review";

const recorded = supplemental.find(
  (entry) => entry.id === "dao-treasury",
)!.report;
const { filename } = recorded.input;
const source = readFileSync(
  resolve(__dirname, "../../../contracts/fixtures/supplemental", filename),
  "utf8",
);
const lines = sourceLines(source);

test("DAO Treasury can be scanned on-device from the exact supplied source", async () => {
  expect(recorded.input.source).toBe(source);
  const result = await analyzeStatic(filename, source);
  await validateResponse(result, filename, source, "browser");
  expect(result.source_sha256).toBe(recorded.source_sha256);
  // Compare implementations, without treating scanner output as a vulnerability label.
  expect(result.candidates.map((f) => [f.rule_id, f.evidence])).toEqual(
    recorded.candidates.map((f) => [f.rule_id, f.evidence]),
  );
});

const origin = "https://audit.example";
function request(path: string, extra: object = {}) {
  return new Request(origin + path, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      api_key: "bedrock-api-key-SYNTHETIC_TREASURY",
      source,
      filename,
      ...extra,
    }),
  });
}

function providerReply(result: object) {
  return Response.json({
    stopReason: "end_turn",
    output: { message: { content: [{ text: JSON.stringify(result) }] } },
    usage: { inputTokens: 120, outputTokens: 30 },
  });
}

test("Treasury on the Bedrock transport: Opus accepts, only a truncated Grok request repeats", async () => {
  const agent = new MockAgent();
  agent.disableNetConnect();
  try {
    const upstream = agent.get(
      "https://bedrock-runtime.us-east-1.amazonaws.com",
    );
    const complete = {
      stopReason: "end_turn",
      output: {
        message: {
          content: [
            {
              text: JSON.stringify({
                summary: "No supported issues in this offline replay.",
                findings: [],
              }),
            },
          ],
        },
      },
      usage: { inputTokens: 100, outputTokens: 32 },
    };
    const active = [
      "us.openai.gpt-6-astra",
      "us.anthropic.claude-opus-5-5",
      "us.xai.grok-4.7",
    ];
    for (const id of active) {
      const grok = id === "us.xai.grok-4.7";
      for (const budget of grok ? [32768, 65536] : [32768]) {
        upstream
          .intercept({
            path: `/model/${id}/converse`,
            method: "POST",
            body: (raw) => JSON.parse(raw).inferenceConfig.maxTokens === budget,
          })
          .reply(
            200,
            grok && budget === 32768 ? { stopReason: "max_tokens" } : complete,
          );
      }
    }
    const transport = bedrockFetchWith(agent);
    const first = await handleReview(
      request("/api/reviews"),
      transport,
      createLimiter(),
    );
    const baseline = await validateCouncil(await first.json(), source);
    expect(baseline.status).toBe("completed");
    expect(baseline.models.map((m) => m.model_id)).toEqual(active);
    expect(baseline.models.map((m) => m.attempts?.length)).toEqual([1, 1, 2]);
    expect(baseline.findings).toEqual([]);
    agent.assertNoPendingInterceptors();
    await expect(
      transport("https://example.com/", {
        method: "POST",
        body: "{}",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Invalid Bedrock transport request");
  } finally {
    await agent.close();
  }
});

for (const omitted of [false, true]) {
  test(`DAO Treasury produces a final report with ${omitted ? "one synthetic peer-review assignment per non-reporting model" : "no model findings"}`, async () => {
    // The provider is simulated; this tests routing and source binding, not audit accuracy.
    const line =
      lines.findIndex((text) => text.includes("_to.transfer(_amount);")) + 1;
    expect(line).toBeGreaterThan(0);
    const evidence = { line_start: line, line_end: line };
    const first = await handleReview(
      request("/api/reviews"),
      async (url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(
          JSON.parse(body.messages[0].content[0].text).source_lines.map(
            (entry: { text: string }) => entry.text,
          ),
        ).toEqual(lines);
        const reportsClaim =
          omitted && String(url).includes(BEDROCK_MODELS[0].id);
        return providerReply({
          summary: "Synthetic response for the Treasury workflow test.",
          findings: reportsClaim
            ? [
                {
                  title: "Synthetic test claim",
                  category: "other",
                  proposed_severity: "LOW",
                  rationale:
                    "Synthetic finding for the peer-review routing test.",
                  recommendation: "Inspect the cited source line.",
                  evidence,
                },
              ]
            : [],
        });
      },
      createLimiter(),
    );
    expect(first.status).toBe(200);
    const baseline = await validateCouncil(await first.json(), source);
    expect(baseline.models.map((model) => model.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);

    const assigned: string[] = [];
    const second = await handleSecondReview(
      request("/api/reviews/second-round", { baseline }),
      async (url, init) => {
        assigned.push(String(url).split("/model/")[1].split("/")[0]);
        const body = JSON.parse(String(init?.body));
        const context = JSON.parse(body.messages[0].content[0].text);
        expect(
          context.source_lines.map((entry: { text: string }) => entry.text),
        ).toEqual(lines);
        expect(context.assigned_claims).toHaveLength(1);
        expect(context.assigned_claims[0].finding_id).toBe(
          baseline.findings[0].id,
        );
        // A peer may reject the test claim; a higher agreement count is not required.
        const assessments = Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [
            `assessment_${i + 1}`,
            i === 0
              ? {
                  verdict: "not_supported",
                  proposed_severity: "NOT_APPLICABLE",
                  rationale:
                    "The synthetic claim does not establish a vulnerability.",
                  evidence,
                }
              : null,
          ]),
        );
        return providerReply({
          summary: "Synthetic second-round judgment.",
          assessments,
        });
      },
      createLimiter(),
    );
    expect(second.status).toBe(200);
    const review = await validateSecondReviewReport(
      await second.json(),
      source,
      baseline,
    );
    expect(assigned.sort()).toEqual(
      omitted
        ? BEDROCK_MODELS.slice(1)
            .map((m) => m.id)
            .sort()
        : [],
    );
    expect(review.status).toBe(omitted ? "completed" : "skipped");
    const final = buildFinalReviewReport(baseline, review);
    expect(final.source_sha256).toBe(recorded.source_sha256);
    expect(final.summary).toMatchObject({
      first_round_completed: 3,
      second_round_completed: omitted ? 2 : 0,
      total_findings: omitted ? 1 : 0,
    });
    if (omitted) expect(final.findings[0].not_supported_models).toHaveLength(2);
  });
}
