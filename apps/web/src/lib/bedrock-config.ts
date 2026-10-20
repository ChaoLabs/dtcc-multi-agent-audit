// Public connection settings; credentials are never part of this module.
export const BEDROCK = {
  model: "us.openai.gpt-6.1-sol",
  label: "GPT-6.1 Sol",
  region: "us-east-1",
  protocol: "converse" as const,
};

export const BEDROCK_MODELS = [
  {
    id: "us.openai.gpt-6.1-sol",
    label: "GPT-6.1 Sol",
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
