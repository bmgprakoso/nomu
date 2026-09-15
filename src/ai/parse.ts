import Anthropic from "@anthropic-ai/sdk";
import { nowIsoWithOffset } from "../lib/time.js";

const anthropic = new Anthropic();

export type Intent = "feed" | "weight" | "stats" | "undo" | "unknown";
export type FeedType = "formula" | "breast_milk" | "breastfeeding" | null;

export interface ParsedMessage {
  intent: Intent;
  amount: number | null;
  unit: "ml" | "oz" | null;
  feed_type: FeedType;
  time_iso: string | null;
  repeat_count: number | null;
  repeat_interval_minutes: number | null;
  undo_count: number | null;
  weight_kg: number | null;
  confidence: "high" | "low";
}

const OZ_TO_ML = 29.5735;
const LB_TO_KG = 0.453592;

function buildSystemPrompt(nowIsoWithOffsetStr: string): string {
  return `You extract structured data from a caregiver's WhatsApp-style message about a
baby's feeding or weight. Messages may be in English, Indonesian, or a mix
("asi" = breast milk, "asupan" = intake, "hapus"/"undo" = delete, "entri" =
entries, "sebelum ini" = before this/previous, "hari ini" = today). The
current date and time, including the caregiver's UTC offset, is
${nowIsoWithOffsetStr}.
Respond with ONLY raw JSON, no markdown fences, no explanation, matching exactly:

{
  "intent": "feed" | "weight" | "stats" | "undo" | "unknown",
  "amount": number|null,
  "unit": "ml"|"oz"|null,
  "feed_type": "formula"|"breast_milk"|"breastfeeding"|null,
  "time_iso": string|null,
  "repeat_count": number|null,
  "repeat_interval_minutes": number|null,
  "undo_count": number|null,
  "weight_kg": number|null,
  "confidence": "high"|"low"
}

Rules:
- Resolve relative times ("8am","just now","10 mins ago") against the current
  date/time above into a full ISO 8601 timestamp that KEEPS the same UTC offset
  shown above (e.g. "2026-09-15T13:00:00+07:00") — do not convert to UTC/Z
  yourself, just carry the offset through unchanged.
- Convert lb to kg if given (1 lb = ${LB_TO_KG} kg).
- "asi" with an explicit volume (e.g. "70ml asi") means pumped/bottled breast
  milk -> feed_type "breast_milk". Only use "breastfeeding" for direct
  nursing with no measurable volume.
- Multiple repeated feeds (e.g. "70ml asi 3x setiap 2 jam ke depan", "50ml
  formula x4 every 3 hours"): set intent "feed", repeat_count to the number
  of repeats, repeat_interval_minutes to the interval in minutes, and
  time_iso to when the FIRST one occurs (use the current time above if the
  caregiver says "starting now" / "ke depan" / gives no explicit start).
  For a single, non-repeated feed, leave repeat_count and
  repeat_interval_minutes null.
- Requests to delete recent entries (e.g. "undo", "hapus 3 entri sebelum
  ini", "delete last 2 entries"): set intent "undo" and undo_count to how
  many of the caregiver's own most recent entries to remove (default 1 if
  the caregiver doesn't specify a number).
- "how am I doing" / "today?" / "stats" / "list asupan hari ini" / "list
  today" / "show today's feeds" -> intent "stats" (returns both the totals
  summary and an itemized log of today's feeds together).
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
    system: buildSystemPrompt(nowIsoWithOffset(now)),
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
    repeat_count: null,
    repeat_interval_minutes: null,
    undo_count: null,
    weight_kg: null,
    confidence: "low",
  };
}

export function amountToMl(amount: number, unit: "ml" | "oz"): number {
  return unit === "oz" ? amount * OZ_TO_ML : amount;
}
