import { amountToMl, parseMessage } from "../ai/parse.js";
import {
  deleteFeed,
  deleteWeight,
  findBabyForCaregiver,
  findCaregiverByChatId,
  getLastFeedTime,
  getMostRecentFeedByCaregiver,
  getMostRecentWeightByCaregiver,
  getTodayFeeds,
  insertFeed,
  insertWeight,
} from "../db/queries.js";
import { describeFeedType, escapeHtml, feedTypeTableLabel, padTable } from "../lib/format.js";
import { computeIntakeStatus, formatIntakeStatus } from "../lib/intake.js";
import { isRateLimited } from "../lib/rateLimit.js";
import { formatInAppTz, formatTimeOnlyInAppTz } from "../lib/time.js";

const CLARIFY_REPLY =
  '❓ Sorry, I didn\'t catch that. Try something like <code>120ml formula 8am</code> or <code>4.2kg</code>.';
const UNDO_WORDS = new Set(["undo", "oops"]);
const MAX_REPEAT = 20;
const MAX_UNDO = 20;

export async function handleIncomingMessage(chatId: string, rawText: string): Promise<string> {
  if (isRateLimited(chatId)) {
    return "⏳ Slow down a bit — please wait a moment before sending more messages.";
  }

  const caregiver = await findCaregiverByChatId(chatId);
  if (!caregiver) {
    return `🔒 This chat isn't registered as a caregiver yet.\nYour chat ID is <code>${escapeHtml(chatId)}</code> — ask the family admin to add you.`;
  }

  const baby = await findBabyForCaregiver(caregiver.id);
  if (!baby) {
    return "👶 No baby is linked to your account yet.";
  }

  if (UNDO_WORDS.has(rawText.trim().toLowerCase())) {
    return handleUndo(caregiver.id, baby.id, 1);
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
    case "stats":
      return handleStats(baby.id, baby.birth_date);
    case "undo":
      return handleUndo(caregiver.id, baby.id, parsed.undo_count ?? 1);
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

  const feedType = isDirectBreastfeeding ? "breastfeeding_direct" : (parsed.feed_type ?? "formula");
  const anchorTime = parsed.time_iso ? new Date(parsed.time_iso) : new Date();
  const repeatCount = Math.min(MAX_REPEAT, Math.max(1, parsed.repeat_count ?? 1));

  if (repeatCount > 1 && (!parsed.repeat_interval_minutes || parsed.repeat_interval_minutes <= 0)) {
    return '❓ I understood multiple feeds but not the interval between them — try <code>70ml asi 3x setiap 2 jam</code>.';
  }

  const intervalMinutes = parsed.repeat_interval_minutes ?? 0;
  const timestamps = Array.from(
    { length: repeatCount },
    (_, i) => new Date(anchorTime.getTime() + i * intervalMinutes * 60_000),
  );

  for (const t of timestamps) {
    await insertFeed({
      babyId,
      amountMl,
      feedType,
      startedAt: t.toISOString(),
      durationMin: null,
      loggedBy: caregiverId,
      rawMessage: rawText,
    });
  }

  if (isDirectBreastfeeding) {
    return "🤱 Logged breastfeeding session.\n<i>Direct breastfeeding isn't volume-tracked — target range only applies to bottle/formula/pumped feeds.</i>";
  }

  const status = await computeIntakeStatus(babyId, birthDate);
  const statsBlock = `<pre>${escapeHtml(formatIntakeStatus(status))}</pre>`;

  if (repeatCount === 1) {
    return `✅ Logged <b>${Math.round(amountMl!)}ml</b> ${describeFeedType(feedType)}\n\n${statsBlock}`;
  }

  const timesStr = timestamps.map((t) => formatInAppTz(t)).join(", ");
  const hasFuture = timestamps[timestamps.length - 1].getTime() > Date.now();
  const futureNote = hasFuture
    ? "\n<i>Some of these are scheduled later today — today's total already includes them.</i>"
    : "";
  return `✅ Logged <b>${repeatCount}x ${Math.round(amountMl!)}ml</b> ${describeFeedType(feedType)}\nat ${timesStr}${futureNote}\n\n${statsBlock}`;
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

  return `⚖️ Logged weight: <b>${parsed.weight_kg}kg</b>\n<i>General guideline numbers, not medical advice — always defer to your pediatrician.</i>`;
}

async function handleUndo(caregiverId: string, babyId: string, requestedCount: number): Promise<string> {
  const count = Math.min(MAX_UNDO, Math.max(1, requestedCount));
  const removed: string[] = [];

  for (let i = 0; i < count; i++) {
    const [feed, weight] = await Promise.all([
      getMostRecentFeedByCaregiver(caregiverId, babyId),
      getMostRecentWeightByCaregiver(caregiverId, babyId),
    ]);

    if (!feed && !weight) break;

    const feedIsNewer = feed && (!weight || new Date(feed.created_at) > new Date(weight.created_at));

    if (feedIsNewer && feed) {
      await deleteFeed(feed.id);
      const amountPart = feed.amount_ml ? `${Math.round(Number(feed.amount_ml))}ml ` : "";
      removed.push(`${amountPart}${describeFeedType(feed.feed_type)} @ ${formatInAppTz(feed.started_at)}`);
    } else if (weight) {
      await deleteWeight(weight.id);
      removed.push(`⚖️ ${weight.weight_kg}kg @ ${formatInAppTz(weight.measured_at)}`);
    }
  }

  if (removed.length === 0) {
    return "🤷 Nothing to undo — you haven't logged anything yet.";
  }

  return `🗑️ <b>Undone (${removed.length}):</b>\n${removed.map((r) => `• ${r}`).join("\n")}`;
}

async function handleStats(babyId: string, birthDate: string): Promise<string> {
  const status = await computeIntakeStatus(babyId, birthDate);
  const lastFeed = await getLastFeedTime(babyId);
  const feeds = await getTodayFeeds(babyId);

  const lastFeedLine = lastFeed
    ? `Last feed: ${formatInAppTz(lastFeed)}`
    : "No feeds logged yet.";

  const parts = [
    `📊 <b>Today's Stats</b>\n<pre>${escapeHtml(formatIntakeStatus(status))}</pre>`,
    lastFeedLine,
  ];

  if (feeds.length > 0) {
    const rows = feeds.map((f) => [
      formatTimeOnlyInAppTz(f.started_at),
      `${f.amount_ml ? `${Math.round(Number(f.amount_ml))}ml ` : ""}${feedTypeTableLabel(f.feed_type)}`,
      f.caregiver_name ?? "-",
    ]);
    const table = padTable(rows, ["Time", "Feed", "By"]);
    parts.push(`🍼 <b>Today's feeds (${feeds.length})</b>\n<pre>${escapeHtml(table)}</pre>`);
  }

  return parts.join("\n\n");
}
