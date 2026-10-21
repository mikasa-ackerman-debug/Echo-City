import type { TrialDef } from "../types";
import { diamond3 } from "./diamond-3";
import { diamond6 } from "./diamond-6";
import { diamondK } from "./diamond-K";
import { heart4, heartJ } from "./heart-collar";
import { heart7 } from "./heart-7";
import { heartQ } from "./heart-Q";
import { club8 } from "./club-8";
import { spade5 } from "./spade-5";
import { joker } from "./joker";

export const TRIALS: Record<string, TrialDef> = Object.fromEntries(
  [diamond3, diamond6, diamondK, heart4, heartJ, heart7, heartQ, club8, spade5, joker].map((t) => [t.id, t]),
);

/** Number cards that may be lit on weekday nights. */
export const NUMBER_TRIALS = ["diamond-3", "heart-4", "spade-5", "diamond-6", "heart-7", "club-8"];

export function getTrial(id: string): TrialDef {
  const t = TRIALS[id];
  if (!t) throw new Error(`unknown trial ${id}`);
  return t;
}

/** Uptime reward for passing a number card (GDD 4.1). */
export function rewardFor(rank: number): number {
  if (rank >= 2 && rank <= 4) return 1;
  if (rank >= 5 && rank <= 7) return 2;
  if (rank >= 8 && rank <= 10) return 3;
  return 0;
}

/** Failing a 2–4 card costs uptime instead of deletion. */
export const LOW_CARD_FAIL_PENALTY = 2;

/** Rank window by weekday night (GDD 5.3). */
export function rankWindow(night: number): [number, number] {
  if (night <= 2) return [2, 5];
  if (night <= 4) return [3, 8];
  return [5, 10];
}

export { diamond3, diamond6, diamondK, heart4, heartJ, heart7, heartQ, club8, spade5, joker };
