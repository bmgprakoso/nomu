import { getGuidelineForAge, getLatestWeight, getTodayTotalMl } from "../db/queries.js";

const STALE_WEIGHT_DAYS = 21;

export interface IntakeStatus {
  todayTotalMl: number;
  targetLowMl: number | null;
  targetHighMl: number | null;
  staleWeight: boolean;
  noWeightOnFile: boolean;
  noGuidelineForAge: boolean;
}

export function ageDaysFromBirthDate(birthDate: string, now: Date = new Date()): number {
  const birth = new Date(birthDate);
  return Math.floor((now.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));
}

export async function computeIntakeStatus(babyId: string, birthDate: string, now: Date = new Date()): Promise<IntakeStatus> {
  const todayTotalMl = await getTodayTotalMl(babyId);
  const latestWeight = await getLatestWeight(babyId);

  if (!latestWeight) {
    return {
      todayTotalMl,
      targetLowMl: null,
      targetHighMl: null,
      staleWeight: false,
      noWeightOnFile: true,
      noGuidelineForAge: false,
    };
  }

  const ageDays = ageDaysFromBirthDate(birthDate, now);
  const guideline = await getGuidelineForAge(ageDays);

  if (!guideline) {
    return {
      todayTotalMl,
      targetLowMl: null,
      targetHighMl: null,
      staleWeight: false,
      noWeightOnFile: false,
      noGuidelineForAge: true,
    };
  }

  const weightKg = Number(latestWeight.weight_kg);
  const measuredAt = new Date(latestWeight.measured_at);
  const daysSinceWeighed = (now.getTime() - measuredAt.getTime()) / (1000 * 60 * 60 * 24);

  return {
    todayTotalMl,
    targetLowMl: weightKg * Number(guideline.ml_per_kg_low),
    targetHighMl: weightKg * Number(guideline.ml_per_kg_high),
    staleWeight: daysSinceWeighed > STALE_WEIGHT_DAYS,
    noWeightOnFile: false,
    noGuidelineForAge: false,
  };
}

// Plain aligned text meant to be wrapped in an HTML <pre> block by the caller
// (Telegram monospace) — no emoji here, since variable-width glyphs break
// column alignment.
export function formatIntakeStatus(status: IntakeStatus): string {
  if (status.noWeightOnFile) {
    return `Today   : ${status.todayTotalMl}ml\n(no weight on file — log one, e.g. "4.2kg", to see a target range)`;
  }

  if (status.noGuidelineForAge) {
    return `Today   : ${status.todayTotalMl}ml\n(no guideline range for this age yet)`;
  }

  const low = Math.round(status.targetLowMl!);
  const high = Math.round(status.targetHighMl!);
  const lines = [
    `Today   : ${status.todayTotalMl}ml`,
    `Target  : ${low}-${high}ml`,
  ];

  if (status.staleWeight) {
    lines.push(`(!) last weight is over ${STALE_WEIGHT_DAYS} days old — target may be off`);
  }

  return lines.join("\n");
}
