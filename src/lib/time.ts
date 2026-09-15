const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "UTC";

// e.g. "2026-09-15T20:00:00+07:00" — local wall-clock time with explicit UTC offset,
// so relative-time parsing anchors to the caregiver's actual clock, not the server's.
export function nowIsoWithOffset(now: Date = new Date(), timeZone: string = APP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const datePart = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;

  return `${datePart}${offsetString(now, timeZone)}`;
}

function offsetString(now: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  const tzPart = dtf.formatToParts(now).find((p) => p.type === "timeZoneName")!.value;
  // tzPart looks like "GMT+7" or "GMT+7:30" or "GMT"
  const match = tzPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return "+00:00";
  const [, sign, hourDigits, minuteDigits] = match;
  const hours = hourDigits.padStart(2, "0");
  const minutes = (minuteDigits ?? "00").padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

export function formatInAppTz(date: Date | string, timeZone: string = APP_TIMEZONE): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" });
}

// HH:mm only, for table rows where the date is already implied (e.g. "today's feeds").
export function formatTimeOnlyInAppTz(date: Date | string, timeZone: string = APP_TIMEZONE): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
}

// Day boundary for "today's total" queries, expressed as a UTC instant range,
// so it matches the caregiver's local day rather than the DB server's timezone.
export function localDayBoundsUtc(timeZone: string = APP_TIMEZONE, now: Date = new Date()): { startUtc: string; endUtc: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const localMidnightIso = `${get("year")}-${get("month")}-${get("day")}T00:00:00${offsetString(now, timeZone)}`;
  const startUtc = new Date(localMidnightIso);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc: startUtc.toISOString(), endUtc: endUtc.toISOString() };
}
