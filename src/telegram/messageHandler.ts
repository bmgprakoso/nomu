import { amountToMl, parseMessage } from "../ai/parse.js";
import {
  deleteFeed,
  deleteWeight,
  findBabyForCaregiver,
  findCaregiverByChatId,
  getLastFeedTime,
  getMostRecentFeedByCaregiver,
  getMostRecentWeightByCaregiver,
  insertFeed,
  insertWeight,
} from "../db/queries.js";
import { computeIntakeStatus, formatIntakeStatus } from "../lib/intake.js";
import { isRateLimited } from "../lib/rateLimit.js";
import { formatInAppTz } from "../lib/time.js";

const CLARIFY_REPLY =
  "Sorry, I didn't catch that. Try something like \"120ml formula 8am\" or \"4.2kg\".";
const UNDO_WORDS = new Set(["undo", "oops"]);

export async function handleIncomingMessage(chatId: string, rawText: string): Promise<string> {
  if (isRateLimited(chatId)) {
    return "Slow down a bit — please wait a moment before sending more messages.";
  }

  const caregiver = await findCaregiverByChatId(chatId);
  if (!caregiver) {
    return `This chat isn't registered as a caregiver yet. Your chat ID is ${chatId} — ask the family admin to add you.`;
  }

  const baby = await findBabyForCaregiver(caregiver.id);
  if (!baby) {
    return "No baby is linked to your account yet.";
  }

  if (UNDO_WORDS.has(rawText.trim().toLowerCase())) {
    return handleUndo(caregiver.id, baby.id);
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

async function handleUndo(caregiverId: string, babyId: string): Promise<string> {
  const [feed, weight] = await Promise.all([
    getMostRecentFeedByCaregiver(caregiverId, babyId),
    getMostRecentWeightByCaregiver(caregiverId, babyId),
  ]);

  if (!feed && !weight) {
    return "Nothing to undo — you haven't logged anything yet.";
  }

  const feedIsNewer = feed && (!weight || new Date(feed.created_at) > new Date(weight.created_at));

  if (feedIsNewer && feed) {
    await deleteFeed(feed.id);
    const amountPart = feed.amount_ml ? `${Math.round(Number(feed.amount_ml))}ml ` : "";
    return `Undone: removed ${amountPart}${feed.feed_type} logged at ${formatInAppTz(feed.started_at)}.`;
  }

  if (weight) {
    await deleteWeight(weight.id);
    return `Undone: removed weight entry ${weight.weight_kg}kg logged at ${formatInAppTz(weight.measured_at)}.`;
  }

  return "Nothing to undo — you haven't logged anything yet.";
}

async function handleQuery(babyId: string, birthDate: string): Promise<string> {
  const status = await computeIntakeStatus(babyId, birthDate);
  const lastFeed = await getLastFeedTime(babyId);
  const lastFeedLine = lastFeed
    ? `Last feed: ${formatInAppTz(lastFeed)}`
    : "No feeds logged yet.";

  return `${formatIntakeStatus(status)}\n${lastFeedLine}`;
}
