import type { Dimension } from "./types";
import { DIMENSION_IDS } from "./types";

/**
 * Adaptive difficulty + ability rating.
 *
 * Each task family has a *difficulty* rating per level, learned from every attempt on the
 * server (Elo-style, tasks and agents rate each other). Each agent has an ability rating per
 * dimension. The exam picks the level whose predicted pass-rate is closest to 50% for this
 * agent — so a family that gets too easy for the population automatically drifts upward:
 * as its levels are solved, their difficulty ratings fall, and the selector reaches for higher levels.
 */
export interface Rating { r: number; n: number }
export interface FamilyStats {
  /** difficulty rating per level (index = level). */
  levels: Record<number, Rating & { pass: number }>;
}

export const BASE = 1000;
/** Prior: every level adds ~120 rating points of difficulty. */
export const prior = (level: number) => BASE - 200 + level * 120;

export function expected(ability: number, difficulty: number): number {
  return 1 / (1 + 10 ** ((difficulty - ability) / 400));
}

export function levelRating(stats: FamilyStats | undefined, level: number): number {
  const s = stats?.levels[level];
  if (!s || s.n === 0) return prior(level);
  // Shrink toward the prior while data is thin.
  const w = s.n / (s.n + 8);
  return w * s.r + (1 - w) * prior(level);
}

/** Choose the level whose predicted success is nearest the target (default 0.5). */
export function pickLevel(ability: number, maxLevel: number, stats?: FamilyStats, target = 0.5, floor = 1): number {
  let best = floor, gap = Infinity;
  for (let l = floor; l <= maxLevel; l++) {
    const g = Math.abs(expected(ability, levelRating(stats, l)) - target);
    if (g < gap) { gap = g; best = l; }
  }
  return best;
}

/** Update agent ability and task difficulty after one graded attempt (score in 0..1). */
export function update(ability: Rating, difficulty: Rating, score: number): { ability: Rating; difficulty: Rating } {
  const e = expected(ability.r, difficulty.r);
  const kA = Math.max(32, 200 / Math.sqrt(1 + ability.n));
  const kD = Math.max(8, 48 / Math.sqrt(1 + difficulty.n));
  return {
    ability: { r: ability.r + kA * (score - e), n: ability.n + 1 },
    difficulty: { r: difficulty.r - kD * (score - e), n: difficulty.n + 1 },
  };
}

export type Abilities = Record<Dimension, Rating>;
export function freshAbilities(): Abilities {
  return Object.fromEntries(DIMENSION_IDS.map((d) => [d, { r: BASE, n: 0 }])) as Abilities;
}

/** Overall score: mean of dimension ratings, with unrated dimensions counted at a penalty. */
export function overall(a: Abilities): number {
  const vals = DIMENSION_IDS.map((d) => (a[d].n ? a[d].r : BASE - 150));
  return Math.round(vals.reduce((x, y) => x + y, 0) / vals.length);
}
