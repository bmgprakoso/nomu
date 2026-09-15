import cron from "node-cron";
import { sendWhatsAppMessage } from "../whatsapp/client.js";
import { getAllBabyIds, getCaregiversForBaby, getLastFeedTime } from "../db/queries.js";
import { pool } from "../db/pool.js";
import { computeIntakeStatus, formatIntakeStatus } from "../lib/intake.js";

const NUDGE_THRESHOLD_HOURS = Number(process.env.NUDGE_THRESHOLD_HOURS ?? 6);
const DIGEST_TIME = process.env.DIGEST_TIME ?? "20:00"; // HH:mm, server local time

async function getBirthDate(babyId: string): Promise<string> {
  const { rows } = await pool.query<{ birth_date: string }>(
    "SELECT birth_date FROM babies WHERE id = $1",
    [babyId],
  );
  return rows[0].birth_date;
}

async function runDailyDigest() {
  const babyIds = await getAllBabyIds();
  for (const babyId of babyIds) {
    const birthDate = await getBirthDate(babyId);
    const status = await computeIntakeStatus(babyId, birthDate);
    const caregivers = await getCaregiversForBaby(babyId);
    const message = `Daily digest\n${formatIntakeStatus(status)}`;

    for (const caregiver of caregivers) {
      await sendWhatsAppMessage(caregiver.phone_number, message).catch((err) =>
        console.error(`digest send failed for ${caregiver.phone_number}:`, err),
      );
    }
  }
}

async function runInactivityCheck() {
  const babyIds = await getAllBabyIds();
  const thresholdMs = NUDGE_THRESHOLD_HOURS * 60 * 60 * 1000;

  for (const babyId of babyIds) {
    const lastFeed = await getLastFeedTime(babyId);
    const hoursSince = lastFeed ? Date.now() - new Date(lastFeed).getTime() : Infinity;

    if (hoursSince < thresholdMs) continue;

    const caregivers = await getCaregiversForBaby(babyId);
    const message = lastFeed
      ? `No feed logged in over ${NUDGE_THRESHOLD_HOURS}h (last: ${new Date(lastFeed).toLocaleString()}).`
      : `No feeds logged yet for this baby.`;

    for (const caregiver of caregivers) {
      await sendWhatsAppMessage(caregiver.phone_number, message).catch((err) =>
        console.error(`nudge send failed for ${caregiver.phone_number}:`, err),
      );
    }
  }
}

export function startJobs() {
  const [hour, minute] = DIGEST_TIME.split(":").map(Number);
  cron.schedule(`${minute} ${hour} * * *`, () => {
    runDailyDigest().catch((err) => console.error("daily digest failed:", err));
  });

  // Check inactivity every hour; a caregiver may get nudged more than once
  // per stale period until they log a feed (acceptable at this scale).
  cron.schedule("0 * * * *", () => {
    runInactivityCheck().catch((err) => console.error("inactivity check failed:", err));
  });

  console.log(`jobs scheduled: daily digest @ ${DIGEST_TIME}, inactivity check hourly (${NUDGE_THRESHOLD_HOURS}h threshold)`);
}
