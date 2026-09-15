import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export type Intent = "feed" | "weight" | "query" | "unknown";
export type FeedType = "formula" | "breast_milk" | "breastfeeding" | null;

export interface ParsedMessage {
  intent: Intent;
  amount: number | null;
  unit: "ml" | "oz" | null;
  feed_type: FeedType;
  time_iso: string | null;
  weight_kg: number | null;
  confidence: "high" | "low";
}

const OZ_TO_ML = 29.5735;
const LB_TO_KG = 0.453592;

function buildSystemPrompt(nowIso: string): string {
  return `You extract structured data from a caregiver's WhatsApp-style message about a
baby's feeding or weight. The current date and time is ${nowIso}.
Respond with ONLY raw JSON, no markdown fences, no explanation, matching exactly:

{
  "intent": "feed" | "weight" | "query" | "unknown",
  "amount": number|null,
  "unit": "ml"|"oz"|null,
  "feed_type": "formula"|"breast_milk"|"breastfeeding"|null,
  "time_iso": string|null,
  "weight_kg": number|null,
  "confidence": "high"|"low"
}

Rules:
- Resolve relative times ("8am","just now","10 mins ago") against current
  date/time into a full ISO 8601 timestamp.
- Convert lb to kg if given (1 lb = ${LB_TO_KG} kg).
- "how am I doing" / "today?" / "stats" -> intent "query".
- If ambiguous or low confidence, use intent "unknown", confidence "low" -
  reply asking the caregiver to clarify rather than guessing.`;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

export async function parseMessage(rawMessage: string, now: Date = new Date()): Promise<ParsedMessage> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    system: buildSystemPrompt(now.toISOString()),
    messages: [{ role: "user", content: rawMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return unknownResult();
  }

  try {
    const parsed = JSON.parse(stripCodeFence(textBlock.text)) as ParsedMessage;
    return parsed;
  } catch {
    return unknownResult();
  }
}

function unknownResult(): ParsedMessage {
  return {
    intent: "unknown",
    amount: null,
    unit: null,
    feed_type: null,
    time_iso: null,
    weight_kg: null,
    confidence: "low",
  };
}

export function amountToMl(amount: number, unit: "ml" | "oz"): number {
  return unit === "oz" ? amount * OZ_TO_ML : amount;
}
