import type { ErrorObject } from "ajv";

const assessmentFields = [
  "finding_id",
  "verdict",
  "proposed_severity",
  "rationale",
  "evidence",
];
const evidenceFields = ["line_start", "line_end", "excerpt"];
const assessmentSlots = Array.from(
  { length: 12 },
  (_, index) => `assessment_${index + 1}`,
);

/** Never copy arbitrary JSON pointers, property names or model output into errors. */
export function secondReviewFormatFailure(
  errors: ErrorObject[] | null | undefined,
): string {
  const fallback = "Output does not match the required assessment format.";
  const issue = errors?.[0];
  if (!issue || typeof issue.instancePath !== "string") return fallback;
  const segments = issue.instancePath.split("/").slice(1);
  let label = "report";
  let children = ["summary", "assessments"];
  if (segments.length) {
    if (!children.includes(segments[0])) return fallback;
    label = segments[0];
    children = label === "assessments" ? assessmentSlots : [];
    if (segments.length > 1) {
      if (label !== "assessments") return fallback;
      if (/^(?:[0-9]|1[01])$/.test(segments[1]))
        label += `[${Number(segments[1])}]`;
      else if (assessmentSlots.includes(segments[1]))
        label += `.${segments[1]}`;
      else return fallback;
      children = assessmentFields;
      if (segments.length > 2) {
        if (!children.includes(segments[2])) return fallback;
        label += `.${segments[2]}`;
        children = segments[2] === "evidence" ? evidenceFields : [];
        if (segments.length > 3) {
          if (!children.includes(segments[3]) || segments.length > 4)
            return fallback;
          label += `.${segments[3]}`;
          children = [];
        }
      }
    }
  }
  switch (issue.keyword) {
    case "required": {
      const missing: unknown = issue.params?.missingProperty;
      return typeof missing === "string" && children.includes(missing)
        ? `${label === "report" ? "" : `${label}.`}${missing} is required.`
        : `${label} is missing a required field.`;
    }
    case "additionalProperties":
      return `${label} contains an unexpected field.`;
    case "enum":
      return label.endsWith(".finding_id")
        ? `${label} must be one of this model's assigned claim IDs.`
        : `${label} is outside the permitted choices.`;
    case "type":
      return `${label} has an incorrect JSON type.`;
    case "minItems":
    case "maxItems":
      return `${label} must contain exactly one assessment per assigned claim.`;
    case "minLength":
    case "maxLength":
      return `${label} is outside the permitted text length.`;
    case "minimum":
    case "maximum":
      return `${label} is outside the permitted numeric range.`;
    default:
      return fallback;
  }
}
