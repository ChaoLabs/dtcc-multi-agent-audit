import { BEDROCK, BEDROCK_MODELS } from "../src/lib/bedrock-config";
import {
  buildCouncilReport,
  type CouncilReport,
  type ModelRun,
} from "../src/lib/orchestration";
import {
  POLICY_VERSION,
  PROMPT_VERSION,
  type PromptVariant,
} from "../src/lib/review-policy";
import {
  buildSecondReviewPlan,
  buildSecondReviewReport,
  type SecondReviewAssessment,
  type SecondReviewModelRun,
} from "../src/lib/second-review";
import { sha256, sourceLines } from "../src/lib/static-analysis";

/** Synthetic source-bound transport records; not vulnerability labels. */
export async function syntheticBaseline(
  source: string,
  variant: PromptVariant = "baseline",
  noQueue = false,
) {
  const hash = await sha256(source);
  const models: ModelRun[] = BEDROCK_MODELS.map((model, index) => ({
    model_id: model.id,
    label: model.label,
    status: "succeeded",
    elapsed_ms: 2,
    error: null,
    attempts: [
      {
        attempt: 1,
        status: "succeeded",
        elapsed_ms: 2,
        error_code: null,
        retry_delay_ms: 0,
      },
    ],
    review: {
      provider: "aws-bedrock",
      model_id: model.id,
      region: BEDROCK.region,
      protocol: BEDROCK.protocol,
      source_sha256: hash,
      created_at: "2026-10-27T12:00:00.000Z",
      elapsed_ms: 2,
      input_tokens: 10,
      output_tokens: 20,
      summary: "Synthetic review record for transport tests only.",
      findings:
        index || noQueue
          ? []
          : [
              {
                title: "Synthetic claim for reassessment",
                category: "other",
                proposed_severity: "LOW",
                rationale:
                  "A synthetic source-bound claim used to exercise the review workflow.",
                recommendation: "Inspect this synthetic test record.",
                evidence: {
                  line_start: 1,
                  line_end: 1,
                  excerpt: sourceLines(source)[0],
                  validation: "source-bound",
                },
              },
            ],
    },
  }));
  return buildCouncilReport(models, source, 3, {
    policy_version: POLICY_VERSION,
    prompt_version: PROMPT_VERSION,
    prompt_variant: variant,
    max_attempts_per_model: 2,
    model_timeout_ms: 180000,
    overall_timeout_ms: 210000,
    total_attempts: 3,
  });
}

export async function syntheticSecondReview(
  source: string,
  baseline: CouncilReport,
  verdicts: SecondReviewAssessment["verdict"][] = [
    "supported",
    "supported",
    "supported",
  ],
) {
  const plan = buildSecondReviewPlan(baseline);
  const models: SecondReviewModelRun[] = plan.model_ids.map((id, index) => {
    const first = baseline.models.find((model) => model.model_id === id)!;
    const { findings: _, ...provenance } = first.review!;
    void _;
    return {
      model_id: id,
      label: first.label,
      status: "succeeded",
      elapsed_ms: 2,
      error: null,
      attempts: [
        {
          attempt: 1,
          status: "succeeded",
          elapsed_ms: 2,
          error_code: null,
          retry_delay_ms: 0,
        },
      ],
      review: {
        ...provenance,
        summary: "Synthetic second-review result; no AWS models were called.",
        assessments: plan.candidate_ids.map((finding_id) => ({
          finding_id,
          verdict: verdicts[index],
          proposed_severity: verdicts[index] === "supported" ? "LOW" : null,
          rationale: "Synthetic assessment based on the supplied test source.",
          evidence: baseline.findings.find(
            (finding) => finding.id === finding_id,
          )!.evidence,
        })),
      },
    };
  });
  return buildSecondReviewReport(
    models,
    source,
    baseline,
    plan.skipped_reason ? 0 : 3,
  );
}
