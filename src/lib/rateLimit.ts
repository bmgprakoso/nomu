const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 10);

const hits = new Map<string, number[]>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > MAX_PER_WINDOW;
}
