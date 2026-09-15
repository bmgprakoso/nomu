import { amountToMl, parseMessage } from "../ai/parse.js";
import {
  findBabyForCaregiver,
  findCaregiverByPhone,
  getLastFeedTime,
  insertFeed,
  insertWeight,
} from "../db/queries.js";
import { computeIntakeStatus, formatIntakeStatus } from "../lib/intake.js";

const CLARIFY_REPLY =
  "Sorry, I didn't catch that. Try something like \"120ml formula 8am\" or \"4.2kg\".";

export async function handleIncomingMessage(fromPhone: string, rawText: string): Promise<string> {
  const caregiver = await findCaregiverByPhone(fromPhone);
  if (!caregiver) {
    return "This number isn't registered as a caregiver yet. Ask the family admin to add you.";
  }

  const baby = await findBabyForCaregiver(caregiver.id);
  if (!baby) {
    return "No baby is linked to your account yet.";
  }

  const parsed = await parseMessage(rawText);

  if (parsed.confidence === "low" || parsed.intent === "unknown") {
    return CLARIFY_REPLY;
  }

  switch (parsed.intent) {
    case "feed":
      return handleFeed(caregiver.id, baby.id, baby.birth_date, rawText, parsed);
    case "weight":
      return handleWeight(caregiver.id, baby.id, rawText, parsed);
    case "query":
      return handleQuery(baby.id, baby.birth_date);
    default:
      return CLARIFY_REPLY;
  }
}

async function handleFeed(
  caregiverId: string,
  babyId: string,
  birthDate: string,
  rawText: string,
  parsed: Awaited<ReturnType<typeof parseMessage>>,
): Promise<string> {
  const isDirectBreastfeeding = parsed.feed_type === "breastfeeding";
  const amountMl =
    !isDirectBreastfeeding && parsed.amount != null && parsed.unit != null
      ? amountToMl(parsed.amount, parsed.unit)
      : null;

  if (!isDirectBreastfeeding && amountMl == null) {
    return CLARIFY_REPLY;
  }

  const startedAt = parsed.time_iso ?? new Date().toISOString();
  const feedType = isDirectBreastfeeding ? "breastfeeding_direct" : (parsed.feed_type ?? "formula");

  await insertFeed({
    babyId,
    amountMl,
    feedType,
    startedAt,
    durationMin: null,
    loggedBy: caregiverId,
    rawMessage: rawText,
  });

  if (isDirectBreastfeeding) {
    return "Logged breastfeeding session. (Direct breastfeeding isn't volume-tracked — target range only applies to bottle/formula/pumped feeds.)";
  }

  const status = await computeIntakeStatus(babyId, birthDate);
  return `Logged ${Math.round(amountMl!)}ml ${feedType}.\n${formatIntakeStatus(status)}`;
}

async function handleWeight(
  caregiverId: string,
  babyId: string,
  rawText: string,
  parsed: Awaited<ReturnType<typeof parseMessage>>,
): Promise<string> {
  if (parsed.weight_kg == null) {
    return CLARIFY_REPLY;
  }

  const measuredAt = parsed.time_iso ?? new Date().toISOString();
  await insertWeight({
    babyId,
    weightKg: parsed.weight_kg,
    measuredAt,
    loggedBy: caregiverId,
  });

  return `Logged weight: ${parsed.weight_kg}kg. Note: general guideline numbers, not medical advice — always defer to your pediatrician.`;
}

async function handleQuery(babyId: string, birthDate: string): Promise<string> {
  const status = await computeIntakeStatus(babyId, birthDate);
  const lastFeed = await getLastFeedTime(babyId);
  const lastFeedLine = lastFeed
    ? `Last feed: ${new Date(lastFeed).toLocaleString()}`
    : "No feeds logged yet.";

  return `${formatIntakeStatus(status)}\n${lastFeedLine}`;
}
