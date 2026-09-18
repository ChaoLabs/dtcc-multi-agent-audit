// Public connection settings; credentials are never part of this module.
export const BEDROCK = {
  model: "us.openai.gpt-6-astra",
  label: "GPT-6 Astra",
  region: "us-east-1",
  protocol: "converse" as const,
};

export function validateApiKey(value: string): string {
  const key = value.trim();
  if (key.length > 16_384 || !/^bedrock-api-key-[A-Za-z0-9+/=_-]+$/.test(key))
    throw new Error(
      "Paste the complete Bedrock API key only, without an export command or quotes.",
    );
  return key;
}
