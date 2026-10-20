import type { ErrorObject } from "ajv";
import generated from "@/generated/review.schema.json";
import type { ModelReview, ReviewFinding } from "@/generated/review";
import { validateReviewEvidence } from "@/lib/report";

export type IncomingReviewFinding = Omit<ReviewFinding, "evidence"> & {
  evidence: Omit<ReviewFinding["evidence"], "validation">;
};

export type IncomingReviewContent = {
  summary: string;
  findings: IncomingReviewFinding[];
};

const incomingEvidenceSchema = {
  ...generated.$defs.Evidence,
  properties: Object.fromEntries(
    Object.entries(generated.$defs.Evidence.properties).filter(
      ([name]) => name !== "validation",
    ),
  ),
  required: generated.$defs.Evidence.required.filter(
    (name) => name !== "validation",
  ),
};

// The local validator and prompt share the generated contract. Bedrock metadata
// and the source-binding annotation are owned by our server. The model cannot
// declare its own evidence verified; it supplies only the evidence to check.
export const reviewContentSchema = {
  $defs: {
    ReviewFinding: generated.$defs.ReviewFinding,
    Evidence: incomingEvidenceSchema,
  },
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: generated.$defs.ModelReview.properties.summary,
    findings: generated.$defs.ModelReview.properties.findings,
  },
};

type Schema = Record<string, unknown>;

function object(value: unknown): value is Schema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolve(value: unknown): Schema {
  if (!object(value)) throw new Error("Invalid review schema definition.");
  if (!Object.hasOwn(value, "$ref")) return value;
  if (value.$ref === "#/$defs/ReviewFinding")
    return generated.$defs.ReviewFinding;
  if (value.$ref === "#/$defs/Evidence") return incomingEvidenceSchema;
  throw new Error("Unsupported review schema reference.");
}

/**
 * Bedrock structured-output grammars accept a smaller JSON Schema vocabulary.
 * Inline only our known definitions and omit quantitative constraints from the
 * wire grammar. The complete bounds remain in the prompt and local AJV check.
 */
function providerSchema(value: unknown): Schema {
  const source = resolve(value);
  const result: Schema = {};
  for (const key of ["type", "enum", "const", "description"]) {
    if (Object.hasOwn(source, key)) result[key] = source[key];
  }
  if (source.type === "object") {
    if (!object(source.properties))
      throw new Error("Object review schemas require named properties.");
    result.properties = Object.fromEntries(
      Object.entries(source.properties).map(([name, property]) => [
        name,
        providerSchema(property),
      ]),
    );
    result.required = Object.keys(source.properties);
    result.additionalProperties = false;
  }
  if (source.type === "array") result.items = providerSchema(source.items);
  return result;
}

export const bedrockOutputConfig = {
  textFormat: {
    type: "json_schema",
    structure: {
      jsonSchema: {
        name: "smart_contract_review",
        description:
          "Source-grounded Solidity review candidates for human assessment.",
        schema: JSON.stringify(providerSchema(reviewContentSchema)),
      },
    },
  },
} as const;

export const reviewFormatInstructions = `Return one JSON object matching the following complete JSON Schema. All named fields are required; no additional fields are allowed. Respect every string-length, array-size, integer and enum constraint even when the output grammar does not enforce it. Return no Markdown fences or explanation outside the object.
${JSON.stringify(reviewContentSchema)}
Evidence must contain exactly line_start, line_end and excerpt. Cite 1-based inclusive line numbers, at most 12 lines per finding, and reproduce those complete source lines exactly, joined by newline. Do not add a validation field: source binding is checked and recorded by the server. Do not include confidence, model metadata or unsupported severity labels. Use an empty findings array when no source-grounded candidate is identified.`;

/**
 * Older prompts/models may still return a validation annotation. Ignore that
 * one server-owned field before strict incoming-schema validation. Preserve all
 * actual evidence, findings and other properties without correction or coercion.
 */
export function normalizeReviewContent(value: unknown): unknown {
  if (!object(value) || !Array.isArray(value.findings)) return value;
  return {
    ...value,
    findings: value.findings.map((finding) => {
      if (!object(finding) || !object(finding.evidence)) return finding;
      return {
        ...finding,
        evidence: Object.fromEntries(
          Object.entries(finding.evidence).filter(
            ([name]) => name !== "validation",
          ),
        ),
      };
    }),
  };
}

/** Call only after the strict incoming schema check; never repair model evidence. */
export function bindReviewContentToSource(
  content: IncomingReviewContent,
  source: string,
): Pick<ModelReview, "summary" | "findings"> {
  validateReviewEvidence(content.findings, source);
  return {
    summary: content.summary,
    findings: content.findings.map((finding) => ({
      ...finding,
      evidence: { ...finding.evidence, validation: "source-bound" },
    })),
  };
}

function schemaLocation(
  path: unknown,
): { schema: Schema; label: string } | null {
  if (typeof path !== "string") return null;
  let current = resolve(reviewContentSchema);
  let label = "report";
  if (path === "") return { schema: current, label };
  if (!path.startsWith("/")) return null;
  for (const segment of path.slice(1).split("/")) {
    if (current.type === "array") {
      // Indices are bounded by the local findings limit; never copy arbitrary
      // pointer segments, escaped property names or returned field values.
      if (
        !/^(?:0|[1-9][0-9]?)$/.test(segment) ||
        Number(segment) >=
          generated.$defs.ModelReview.properties.findings.maxItems
      )
        return null;
      current = resolve(current.items);
      label += `[${Number(segment)}]`;
    } else if (
      object(current.properties) &&
      Object.hasOwn(current.properties, segment)
    ) {
      current = resolve(current.properties[segment]);
      label = label === "report" ? segment : `${label}.${segment}`;
    } else {
      return null;
    }
  }
  return { schema: current, label };
}

/** Only trusted schema facts and known field paths may enter public errors. */
export function schemaFailureDetail(
  errors: ErrorObject[] | null | undefined,
): string {
  const fallback = "Output does not match the required review schema.";
  const issue = errors?.[0];
  if (!issue) return fallback;
  const location = schemaLocation(issue.instancePath);
  if (!location) return fallback;
  const { schema, label } = location;
  let detail: string;
  switch (issue.keyword) {
    case "required": {
      const missing = issue.params?.missingProperty;
      // A missing-property name is exposed only when it exactly matches a
      // trusted property from the generated schema at this known location.
      if (
        typeof missing === "string" &&
        object(schema.properties) &&
        Object.hasOwn(schema.properties, missing)
      ) {
        detail = `${label === "report" ? "" : `${label}.`}${missing} is required.`;
      } else {
        detail = `${label} is missing a required field.`;
      }
      break;
    }
    case "additionalProperties":
      detail = `${label} contains an unexpected field.`;
      break;
    case "type": {
      const type = schema.type;
      detail =
        typeof type === "string" &&
        ["string", "integer", "object", "array"].includes(type)
          ? `${label} must be ${type === "string" ? "a" : "an"} ${type}.`
          : fallback;
      break;
    }
    case "enum":
      detail =
        Array.isArray(schema.enum) &&
        schema.enum.every((item) => typeof item === "string")
          ? `${label} must be one of ${schema.enum.join(", ")}.`
          : fallback;
      break;
    case "const":
      detail =
        typeof schema.const === "string"
          ? `${label} must equal ${JSON.stringify(schema.const)}.`
          : fallback;
      break;
    case "maxLength":
    case "minLength": {
      const bound = schema[issue.keyword];
      detail =
        typeof bound === "number"
          ? `${label} must contain ${issue.keyword === "maxLength" ? "at most" : "at least"} ${bound} characters.`
          : fallback;
      break;
    }
    case "maxItems":
      detail =
        typeof schema.maxItems === "number"
          ? `${label} must contain at most ${schema.maxItems} items.`
          : fallback;
      break;
    case "minimum":
      detail =
        typeof schema.minimum === "number"
          ? `${label} must be at least ${schema.minimum}.`
          : fallback;
      break;
    default:
      detail = fallback;
  }
  return detail.length <= 350 ? detail : fallback;
}
