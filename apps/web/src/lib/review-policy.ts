/** Public, versioned execution limits; never credentials or provider overrides. */
export const POLICY_VERSION = "bounded-review-v3-validation-recovery" as const;
export const PROMPT_VERSION =
  "independent-review-v5-bounded-evidence-correction-grok-medium" as const;
export type IndependentPromptVersion =
  | typeof PROMPT_VERSION
  | "independent-review-v4-reader-focused-source-spans-grok-medium"
  | "independent-review-v3-source-spans-grok-medium"
  | "independent-review-v2";
export type PromptVariant = "baseline" | "few-shot";

export const LEGACY_REVIEW_POLICY = Object.freeze({
  max_attempts_per_model: 2,
  model_timeout_ms: 180_000,
  overall_timeout_ms: 210_000,
  max_output_tokens: 8192,
  max_provider_requests: 6,
} as const);

export const REVIEW_POLICY = Object.freeze({
  ...LEGACY_REVIEW_POLICY,
  max_attempts_per_model: 3,
  model_timeout_ms: 270_000,
  overall_timeout_ms: 285_000,
  max_provider_requests: 9,
} as const);

export const REVIEW_CLIENT_TIMEOUT_MS = 295_000;

export type ReviewPolicyVersion =
  | typeof POLICY_VERSION
  | "bounded-review-v2-network-recovery"
  | "bounded-review-v1";

/** Historical records keep the execution budget that governed their requests. */
export function reviewPolicyLimits(version: ReviewPolicyVersion) {
  return version === POLICY_VERSION ? REVIEW_POLICY : LEGACY_REVIEW_POLICY;
}

// Separately authored microexamples. Never import the five regression cases or
// their expected rules into this prompt. Same examples/order for all reviewers.
const demonstrations = [
  {
    source: [
      "pragma solidity ^0.8.20;",
      "contract FeeSettings {",
      "    uint256 public feeBps = 30;",
      "    function setFee(uint256 next) external { feeBps = next; }",
      "}",
    ].join("\n"),
    response: {
      summary: "A public fee-setting function lacks caller authorization.",
      findings: [
        {
          title: "Unrestricted fee configuration",
          category: "access-control",
          proposed_severity: "MEDIUM",
          rationale:
            "Any account can replace feeBps through setFee. The supplied source does not show how fees are consumed, so asset loss is not established.",
          recommendation:
            "Restrict fee updates to an authorized role and validate the permitted fee range.",
          evidence: {
            line_start: 4,
            line_end: 4,
          },
        },
      ],
    },
  },
  {
    source: [
      "pragma solidity ^0.8.20;",
      "contract CheckedMath {",
      "    function increment(uint256 amount) external pure returns (uint256) {",
      "        return amount + 1;",
      "    }",
      "}",
    ].join("\n"),
    response: {
      summary:
        "No source-grounded security finding identified in this snippet. Solidity 0.8 checked arithmetic reverts on overflow; no exploitable surrounding behavior is shown. This is not proof of safety.",
      findings: [],
    },
  },
];

export function promptInstructions(variant: PromptVariant): string {
  if (variant === "baseline") return "";
  return `The following independent microexamples illustrate the review format and evidence discipline. They are not the contract under review, not an exhaustive taxonomy, and must never be cited as evidence for the current source. Analyze the current source independently; do not copy their findings. An empty findings array means no supported finding, not a safety certification.\n${JSON.stringify(demonstrations)}\nEnd of examples. Only the source in the user message is under review.`;
}
