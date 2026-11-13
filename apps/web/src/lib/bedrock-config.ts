// Public connection settings; credentials are never part of this module.
export const BEDROCK_MODELS = [
  {
    id: "us.openai.gpt-6-astra",
    label: "GPT-6 Astra",
    provider: "OpenAI",
  },
  {
    id: "us.anthropic.claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "Anthropic",
  },
  {
    id: "us.xai.grok-4.7",
    label: "Grok 4.7",
    provider: "xAI",
  },
] as const;

export const BEDROCK = {
  model: BEDROCK_MODELS[0].id,
  label: BEDROCK_MODELS[0].label,
  region: "us-east-1",
  protocol: "converse" as const,
};

// These complete rosters are for validating archived reports only. New runs
// always use BEDROCK_MODELS and never send a request to the archived Fable ID.
const ARCHIVED_COUNCILS = [
  [
    BEDROCK_MODELS[0],
    {
      id: "us.anthropic.claude-fable-5-2",
      label: "Claude Fable 5.2",
      provider: "Anthropic",
    },
    BEDROCK_MODELS[2],
  ],
  [
    { id: "us.openai.gpt-6.1-sol", label: "GPT-6.1 Sol", provider: "OpenAI" },
    BEDROCK_MODELS[1],
    BEDROCK_MODELS[2],
  ],
] as const;

type CouncilMember = {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
};

/** Resolve only complete known rosters. IDs from two generations cannot be combined. */
export function recordedCouncil(
  models: readonly { model_id: string }[],
): readonly CouncilMember[] {
  const ids = new Set(models.map((model) => model.model_id));
  const roster = [BEDROCK_MODELS, ...ARCHIVED_COUNCILS].find(
    (candidate) =>
      candidate.length === models.length &&
      candidate.every(({ id }) => ids.has(id)),
  );
  if (!roster)
    throw new Error("Invalid or mixed model identity in the review council.");
  return roster;
}

export function validateApiKey(value: string): string {
  const key = value.trim();
  if (
    !key ||
    key.length > 16_384 ||
    !/^bedrock-api-key-[A-Za-z0-9+/=_-]+$/.test(key)
  )
    throw new Error(
      "Paste the complete Bedrock API key only, without an export command or quotes.",
    );
  return key;
}
