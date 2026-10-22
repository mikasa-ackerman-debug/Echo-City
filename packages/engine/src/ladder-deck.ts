import { cardLabel, SUITS, type Suit } from "@echo/protocol";
import type { Dimension } from "@echo/exam";
import { getTrial } from "./trials";

/**
 * The city's ladder: four suits, each climbed 2 → 10 → J → Q → K. Clearing all 48 opens the JOKER.
 * Cards are not collected — passing one moves you one step up that suit.
 */
export const LADDER: Record<Suit, string[]> = {
  "♦": ["diamond-2", "diamond-3", "diamond-4", "diamond-5", "diamond-6", "diamond-7", "diamond-8", "diamond-9", "diamond-10", "diamond-J", "diamond-Q", "diamond-K"],
  "♣": ["club-2", "club-3", "club-4", "club-5", "club-6", "club-7", "club-8", "club-9", "club-10", "club-J", "club-Q", "club-K"],
  "♠": ["spade-2", "spade-3", "spade-4", "spade-5", "spade-6", "spade-7", "spade-8", "spade-9", "spade-10", "spade-J", "spade-Q", "spade-K"],
  "♥": ["heart-2", "heart-3", "heart-4-relay", "heart-5", "heart-6", "heart-7", "heart-8", "heart-9", "heart-10", "heart-J", "heart-Q", "heart-K"],
};
export const LADDER_STEPS = 12;
export const JOKER_TRIAL = "joker-gate";

export const SUIT_THEMES: Record<Suit, { name: string; theme: string; dims: Dimension[] }> = {
  "♦": { name: "方块", theme: "推理", dims: ["logic", "math"] },
  "♣": { name: "梅花", theme: "规划与协作", dims: ["planning", "math"] },
  "♠": { name: "黑桃", theme: "博弈与决策", dims: ["strategy", "planning"] },
  "♥": { name: "红心", theme: "记忆与指令", dims: ["memory", "instruction"] },
};

export const LADDER_SUITS: Suit[] = [...SUITS];

/** Failing a card: 2–4 cost 1 Uptime, 5–10 cost 2, faces and the Joker delete. */
export function ladderFailCost(rank: number): number | "delete" {
  if (rank <= 4) return 1;
  if (rank <= 10) return 2;
  return "delete";
}

/** Uptime refunded for passing a card. */
export function ladderReward(rank: number): number {
  if (rank <= 7) return 1;
  return 2;
}

/** All 49 ladder cards in order, for compendiums. */
export function ladderCards() {
  return [
    ...LADDER_SUITS.flatMap((suit) => LADDER[suit].map((id, i) => ({ id, suit, step: i + 1 }))),
    { id: JOKER_TRIAL, suit: "joker" as const, step: 13 },
  ].map((c) => {
    const t = getTrial(c.id);
    return { ...c, card: cardLabel(t.suit, t.rank), name: t.name, rank: t.rank, tests: t.tests, gatekeeper: t.rank >= 11 || c.suit === "joker", minPlayers: t.minPlayers, maxPlayers: t.maxPlayers };
  });
}
