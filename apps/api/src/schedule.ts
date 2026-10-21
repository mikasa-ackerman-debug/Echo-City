/**
 * Weekly schedule in Asia/Shanghai (UTC+8, no DST). GDD D1:
 * Mon–Fri 19:00 dawn / 21:00 trial, Sat 21:00 judgment, Sun 21:00 joker.
 */
const TZ_OFFSET_MS = 8 * 3600 * 1000;

export function nextMonday1900(from = new Date()): Date {
  const local = new Date(from.getTime() + TZ_OFFSET_MS);
  const dow = (local.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dow, 19, 0, 0) - TZ_OFFSET_MS;
  return new Date(monday > from.getTime() ? monday : monday + 7 * 86400000);
}

/** Wall-clock time at which a stage may begin for a cycle starting at `startsAt` (Monday 19:00). */
export function stageTime(startsAt: Date, night: number, stage: string): Date | null {
  const day = startsAt.getTime() + (Math.max(1, night) - 1) * 86400000;
  if (stage === "dawn") return new Date(day); // 19:00 that day
  if (stage === "trial_start") return new Date(day + 2 * 3600000); // 21:00
  return null;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
