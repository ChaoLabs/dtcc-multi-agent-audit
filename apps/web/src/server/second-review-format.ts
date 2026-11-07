import {
  SecondReviewValidationError,
  secondReviewResponseSchema,
  SECOND_REVIEW_POLICY,
} from "@/lib/second-review";
import { sourceLines } from "@/lib/static-analysis";

const ABSENT_SEVERITY = "NOT_APPLICABLE";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Resolve model-selected locations, never a model-authored or repaired quote. */
function resolveSourceSpan(entry: unknown, index: number, lines: string[]) {
  const field = `assessments.assessment_${index + 1}.evidence`;
  if (
    !object(entry) ||
    !object(entry.evidence) ||
    Object.keys(entry.evidence).length !== 2 ||
    !Object.hasOwn(entry.evidence, "line_start") ||
    !Object.hasOwn(entry.evidence, "line_end")
  )
    throw new SecondReviewValidationError(
      `${field} must contain only line_start and line_end for a source-span citation.`,
    );
  const { line_start, line_end } = entry.evidence;
  if (
    typeof line_start !== "number" ||
    typeof line_end !== "number" ||
    !Number.isSafeInteger(line_start) ||
    !Number.isSafeInteger(line_end)
  )
    throw new SecondReviewValidationError(
      `${field}.line_start and line_end must be whole-number source line numbers.`,
    );
  if (
    line_start < 1 ||
    line_end < 1 ||
    line_start > lines.length ||
    line_end > lines.length
  )
    throw new SecondReviewValidationError(
      `${field} must cite source line numbers between 1 and ${lines.length}, inclusive.`,
    );
  if (line_end < line_start)
    throw new SecondReviewValidationError(
      `${field}.line_end must be greater than or equal to line_start.`,
    );
  if (line_end - line_start >= 12)
    throw new SecondReviewValidationError(
      `${field} exceeds the 12-line citation limit. Select a focused source span with line_end - line_start + 1 <= 12.`,
    );
  const excerpt = lines.slice(line_start - 1, line_end).join("\n");
  if (!excerpt.trim())
    throw new SecondReviewValidationError(
      `${field} selects only blank source lines. Select a non-empty source span relevant to your judgment.`,
    );
  if (excerpt.length > 12000)
    throw new SecondReviewValidationError(
      `${field} exceeds the 12000-character citation limit. Select a shorter relevant source span.`,
    );
  return { ...entry, evidence: { line_start, line_end, excerpt } };
}

/**
 * The native grammar always has the same twelve required named slots. Models
 * never manufacture or copy claim IDs; the server binds each explicit slot to
 * its immutable assignment only after the entire wire response validates.
 * Every reviewer selects source spans; the application resolves the quoted
 * source text. Unassigned slots must be null and never become assessments.
 */
export function secondReviewWireFormat(candidateIds: string[]) {
  const canonicalSchema = secondReviewResponseSchema(candidateIds);
  const canonicalAssessment = canonicalSchema.properties.assessments.items;
  const properties = canonicalAssessment.properties;
  const assignments = candidateIds.map((finding_id, index) => ({
    response_slot: `assessment_${index + 1}`,
    finding_id,
  }));
  const assessmentSchema = {
    ...canonicalAssessment,
    required: canonicalAssessment.required.filter(
      (name) => name !== "finding_id",
    ),
    properties: {
      ...Object.fromEntries(
        Object.entries(properties).filter(([name]) => name !== "finding_id"),
      ),
      proposed_severity: {
        type: "string",
        enum: ["HIGH", "MEDIUM", "LOW", ABSENT_SEVERITY],
      },
      evidence: {
        type: "object",
        additionalProperties: false,
        required: ["line_start", "line_end"],
        properties: {
          line_start: properties.evidence.properties.line_start,
          line_end: properties.evidence.properties.line_end,
        },
      },
    },
  };
  const slots = Array.from(
    { length: SECOND_REVIEW_POLICY.max_candidates },
    (_, index) => `assessment_${index + 1}`,
  );
  const sharedSchema = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "assessments"],
    $defs: { Assessment: assessmentSchema },
  };
  const schema = {
    ...sharedSchema,
    properties: {
      summary: canonicalSchema.properties.summary,
      assessments: {
        type: "object",
        additionalProperties: false,
        required: slots,
        properties: Object.fromEntries(
          slots.map((slot, index) => [
            slot,
            index < assignments.length
              ? { $ref: "#/$defs/Assessment" }
              : { type: "null" },
          ]),
        ),
      },
    },
  };
  // Provider grammar is byte-identical for every model, source and assignment
  // count. Twelve nullable slots stay within Bedrock's sixteen-union limit.
  // Assignment-specific non-null/null requirements are enforced by local AJV.
  const nativeSchema = {
    ...sharedSchema,
    properties: {
      summary: canonicalSchema.properties.summary,
      assessments: {
        type: "object",
        additionalProperties: false,
        required: slots,
        properties: Object.fromEntries(
          slots.map((slot) => [
            slot,
            { anyOf: [{ $ref: "#/$defs/Assessment" }, { type: "null" }] },
          ]),
        ),
      },
    },
  };

  return {
    schema,
    nativeSchema,
    canonicalSchema,
    assignments,
    absentSeverity: `"${ABSENT_SEVERITY}"`,
    evidenceInstruction: `Each assessment must select a 1-based inclusive source span of at most 12 lines
using evidence.line_start and evidence.line_end from the supplied source_lines.
Check line_end >= line_start and line_end - line_start + 1 <= 12 before returning it.
For a longer function, cite a focused span and discuss the wider context in the rationale.
The selected text must be non-empty and at most 12000 characters.
Explain how those lines support the judgment. The application resolves their exact
text from the submitted source. Do not return an excerpt or a validation field.`,
    /** Call only after validating against this model's complete wire schema. */
    decode(value: unknown, source: string): unknown {
      if (
        !object(value) ||
        Object.keys(value).length !== 2 ||
        !Object.hasOwn(value, "summary") ||
        !object(value.assessments) ||
        Object.keys(value.assessments).length !== slots.length ||
        slots.some(
          (slot) => !Object.hasOwn(value.assessments as object, slot),
        ) ||
        slots
          .slice(assignments.length)
          .some(
            (slot) =>
              (value.assessments as Record<string, unknown>)[slot] !== null,
          )
      )
        throw new SecondReviewValidationError(
          "Return a summary and all twelve assessment slots exactly once; unused slots must be null.",
        );
      const returnedSlots = value.assessments;
      const lines = sourceLines(source);
      return {
        summary: value.summary,
        assessments: assignments.map((assignment, index) => {
          const entry = returnedSlots[assignment.response_slot];
          if (!object(entry) || Object.hasOwn(entry, "finding_id"))
            throw new SecondReviewValidationError(
              `assessments.assessment_${index + 1} must contain an assessment without a model-supplied claim ID.`,
            );
          const decoded = resolveSourceSpan(entry, index, lines);
          return {
            ...decoded,
            ...((entry.verdict === "not_supported" ||
              entry.verdict === "uncertain") &&
            entry.proposed_severity === ABSENT_SEVERITY
              ? { proposed_severity: null }
              : {}),
            finding_id: assignment.finding_id,
          };
        }),
      };
    },
  };
}
