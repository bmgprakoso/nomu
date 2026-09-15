import { pool } from "./pool.js";
import { localDayBoundsUtc } from "../lib/time.js";

export interface Caregiver {
  id: string;
  telegram_chat_id: string;
  name: string | null;
}

export interface Baby {
  id: string;
  name: string;
  birth_date: string;
  sex: string | null;
}

export async function findCaregiverByChatId(chatId: string): Promise<Caregiver | null> {
  const { rows } = await pool.query<Caregiver>(
    "SELECT id, telegram_chat_id, name FROM caregivers WHERE telegram_chat_id = $1",
    [chatId],
  );
  return rows[0] ?? null;
}

// Personal-use assumption: one baby per caregiver (see tech-doc.md open decisions
// re: multi-baby disambiguation). Returns the first linked baby.
export async function findBabyForCaregiver(caregiverId: string): Promise<Baby | null> {
  const { rows } = await pool.query<Baby>(
    `SELECT b.id, b.name, b.birth_date, b.sex
     FROM babies b
     JOIN caregiver_baby cb ON cb.baby_id = b.id
     WHERE cb.caregiver_id = $1
     LIMIT 1`,
    [caregiverId],
  );
  return rows[0] ?? null;
}

export async function insertFeed(params: {
  babyId: string;
  amountMl: number | null;
  feedType: string;
  startedAt: string;
  durationMin: number | null;
  loggedBy: string;
  rawMessage: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO feeds (baby_id, amount_ml, feed_type, started_at, duration_min, logged_by, raw_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      params.babyId,
      params.amountMl,
      params.feedType,
      params.startedAt,
      params.durationMin,
      params.loggedBy,
      params.rawMessage,
    ],
  );
  return rows[0].id as string;
}

export async function insertWeight(params: {
  babyId: string;
  weightKg: number;
  measuredAt: string;
  loggedBy: string;
}) {
  const { rows } = await pool.query(
    `INSERT INTO weights (baby_id, weight_kg, measured_at, logged_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [params.babyId, params.weightKg, params.measuredAt, params.loggedBy],
  );
  return rows[0].id as string;
}

export interface RecentFeed {
  id: string;
  amount_ml: string | null;
  feed_type: string;
  started_at: string;
  created_at: string;
}

export interface RecentWeight {
  id: string;
  weight_kg: string;
  measured_at: string;
  created_at: string;
}

export async function getMostRecentFeedByCaregiver(caregiverId: string, babyId: string): Promise<RecentFeed | null> {
  const { rows } = await pool.query<RecentFeed>(
    `SELECT id, amount_ml, feed_type, started_at, created_at FROM feeds
     WHERE baby_id = $1 AND logged_by = $2
     ORDER BY created_at DESC LIMIT 1`,
    [babyId, caregiverId],
  );
  return rows[0] ?? null;
}

export async function getMostRecentWeightByCaregiver(caregiverId: string, babyId: string): Promise<RecentWeight | null> {
  const { rows } = await pool.query<RecentWeight>(
    `SELECT id, weight_kg, measured_at, created_at FROM weights
     WHERE baby_id = $1 AND logged_by = $2
     ORDER BY created_at DESC LIMIT 1`,
    [babyId, caregiverId],
  );
  return rows[0] ?? null;
}

export async function deleteFeed(id: string): Promise<void> {
  await pool.query("DELETE FROM feeds WHERE id = $1", [id]);
}

export async function deleteWeight(id: string): Promise<void> {
  await pool.query("DELETE FROM weights WHERE id = $1", [id]);
}

export async function getLatestWeight(babyId: string) {
  const { rows } = await pool.query<{ weight_kg: string; measured_at: string }>(
    `SELECT weight_kg, measured_at FROM weights
     WHERE baby_id = $1 ORDER BY measured_at DESC LIMIT 1`,
    [babyId],
  );
  return rows[0] ?? null;
}

export async function getGuidelineForAge(ageDays: number) {
  const { rows } = await pool.query<{ ml_per_kg_low: string; ml_per_kg_high: string }>(
    `SELECT ml_per_kg_low, ml_per_kg_high FROM intake_guidelines
     WHERE $1 BETWEEN age_days_min AND age_days_max
     LIMIT 1`,
    [ageDays],
  );
  return rows[0] ?? null;
}

export interface TodayFeed {
  amount_ml: string | null;
  feed_type: string;
  started_at: string;
  caregiver_name: string | null;
}

export async function getTodayFeeds(babyId: string): Promise<TodayFeed[]> {
  const { startUtc, endUtc } = localDayBoundsUtc();
  const { rows } = await pool.query<TodayFeed>(
    `SELECT f.amount_ml, f.feed_type, f.started_at, c.name AS caregiver_name
     FROM feeds f
     LEFT JOIN caregivers c ON c.id = f.logged_by
     WHERE f.baby_id = $1
       AND f.started_at >= $2 AND f.started_at < $3
     ORDER BY f.started_at ASC`,
    [babyId, startUtc, endUtc],
  );
  return rows;
}

export async function getTodayTotalMl(babyId: string) {
  const { startUtc, endUtc } = localDayBoundsUtc();
  const { rows } = await pool.query<{ total: string | null }>(
    `SELECT SUM(amount_ml) AS total FROM feeds
     WHERE baby_id = $1
       AND started_at >= $2 AND started_at < $3
       AND feed_type != 'breastfeeding_direct'`,
    [babyId, startUtc, endUtc],
  );
  return rows[0]?.total ? Number(rows[0].total) : 0;
}

export async function getLastFeedTime(babyId: string) {
  const { rows } = await pool.query<{ started_at: string }>(
    `SELECT started_at FROM feeds WHERE baby_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [babyId],
  );
  return rows[0]?.started_at ?? null;
}

export async function getAllBabyIds(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM babies");
  return rows.map((r) => r.id);
}

export async function getCaregiversForBaby(babyId: string): Promise<Caregiver[]> {
  const { rows } = await pool.query<Caregiver>(
    `SELECT c.id, c.telegram_chat_id, c.name FROM caregivers c
     JOIN caregiver_baby cb ON cb.caregiver_id = c.id
     WHERE cb.baby_id = $1`,
    [babyId],
  );
  return rows;
}
