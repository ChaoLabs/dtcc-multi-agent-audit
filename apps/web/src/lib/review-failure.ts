export type ReviewFailureExplanation = {
  label: string;
  explanation: string;
  nextStep: string;
};

type ReviewFailure = { code: string; detail: string } | null | undefined;

function legacyStop(error: ReviewFailure, reason: string): boolean {
  // Older exports used "incomplete" for every HTTP-success stop reason.
  // Match only the exact application-authored marker, never arbitrary prose.
  return (
    error?.code === "incomplete" &&
    typeof error.detail === "string" &&
    error.detail.includes(`AWS stop reason: ${reason}. `)
  );
}

/** Plain-language guidance. Provider/model text is never copied into this view. */
export function explainReviewFailure(
  error: ReviewFailure = undefined,
): ReviewFailureExplanation {
  if (
    error?.code === "content_filtered" ||
    legacyStop(error, "content_filtered")
  )
    return {
      label: "Content filtered",
      explanation:
        "The model provider stopped this review because of its content filter. This result does not indicate an expired API key.",
      nextStep:
        "Keep the available results. If this contract needs review by this model, ask your AWS administrator or provider support about the restriction.",
    };
  if (
    error?.code === "guardrail_intervened" ||
    legacyStop(error, "guardrail_intervened")
  )
    return {
      label: "AWS policy intervention",
      explanation:
        "An AWS guardrail intervened, and the platform could not accept a completed review from this model.",
      nextStep:
        "Keep the available results and ask your AWS administrator to review the applicable policy.",
    };
  if (legacyStop(error, "max_tokens"))
    return {
      label: "Response too long",
      explanation:
        "The model reached its output limit before finishing. Its incomplete answer was not accepted.",
      nextStep:
        "Keep the available results and share the error details with the platform maintainer before starting another run.",
    };
  if (legacyStop(error, "model_context_window_exceeded"))
    return {
      label: "Input exceeds model limit",
      explanation:
        "The provider reported that this review exceeded the model's context limit.",
      nextStep:
        "Ask the platform maintainer to review the input size. Avoid removing relevant contract code just to obtain a result.",
    };
  if (
    legacyStop(error, "malformed_model_output") ||
    legacyStop(error, "malformed_tool_use")
  )
    return {
      label: "Response could not be used",
      explanation:
        "The provider reported an incorrectly formed answer. No judgment from this model was accepted.",
      nextStep:
        "Use the available results and share the error details with the platform maintainer.",
    };
  if (legacyStop(error, "tool_use"))
    return {
      label: "Unexpected model action",
      explanation:
        "The model requested an external action instead of returning a completed review.",
      nextStep:
        "Use the available results and share the error details with the platform maintainer.",
    };
  if (legacyStop(error, "stop_sequence"))
    return {
      label: "Review ended early",
      explanation:
        "The provider reported an early stop without confirming a completed review.",
      nextStep:
        "Use the available results and share the error details with the platform maintainer.",
    };

  switch (error?.code) {
    case "bedrock_model_timeout":
      return {
        label: "Provider time limit reached",
        explanation:
          "AWS stopped processing before a complete review was returned. The bounded recovery attempts have ended.",
        nextStep:
          "Keep the available results. Check the execution details before starting another review.",
      };
    case "bedrock_network":
      return {
        label: "Connection interrupted",
        explanation:
          "The connection to AWS was interrupted. The allowed recovery attempts have ended.",
        nextStep:
          "Keep the available results and check the connection before starting a new review.",
      };
    case "bedrock_access":
      return {
        label: "Access denied",
        explanation:
          "AWS did not accept this key or did not allow access to this model.",
        nextStep:
          "Check the key in Connection settings. Ask your AWS administrator about model permissions if a current key still fails.",
      };
    case "bedrock_rate_limit":
      return {
        label: "Request limit reached",
        explanation:
          "AWS limited requests for this model. Any allowed retries have stopped.",
        nextStep:
          "Keep the available results and wait before starting a new run. Ask your AWS administrator about capacity if this continues.",
      };
    case "busy":
      return {
        label: "Another check is running",
        explanation:
          "The platform cannot start another check under its current request limits.",
        nextStep: "Wait for the active check to finish before trying again.",
      };
    case "timeout":
      return {
        label: "Time limit reached",
        explanation:
          "This review did not finish within its time limit, or it was cancelled. No incomplete answer was accepted.",
        nextStep:
          "Keep the available results. If you start a new run later, it will make new model requests and may incur charges.",
      };
    case "invalid_report":
      return {
        label: "Response could not be used",
        explanation:
          "The model returned an answer that did not meet the report requirements. It was excluded from the results.",
        nextStep:
          "Use the other results and share the error details with the platform maintainer.",
      };
    case "invalid_evidence":
      return {
        label: "Evidence could not be verified",
        explanation:
          "The model's answer did not pass the source-evidence checks. It was excluded from the results.",
        nextStep:
          "Review the available source evidence and share the error details with the platform maintainer.",
      };
    case "bedrock_model":
      return {
        label: "Request not accepted",
        explanation:
          "AWS did not accept the configured model request. This is different from a temporary service interruption.",
        nextStep:
          "Share the error details with the platform maintainer so the model configuration can be checked.",
      };
    case "bedrock_unavailable":
      return {
        label: "Model unavailable",
        explanation:
          "AWS could not complete this model request. The other available results are retained.",
        nextStep:
          "Inspect the error details before starting a new run later. New requests may incur charges.",
      };
    case "incomplete":
      return {
        label: "Review not completed",
        explanation:
          "The model did not return a completed review. The available information does not establish why.",
        nextStep:
          "Keep the other results and share the error details with the platform maintainer.",
      };
    default:
      return {
        label: "Review unavailable",
        explanation:
          "No valid review is available from this model. It does not count as agreement or rejection.",
        nextStep:
          "Keep the other results and inspect the error details before deciding whether to start a new run.",
      };
  }
}
