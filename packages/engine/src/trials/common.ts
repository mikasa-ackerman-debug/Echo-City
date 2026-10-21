import { SUITS, type ChannelSpec, type Suit } from "@echo/protocol";
import type { TrialPlayer } from "../types";

export const suitNames: Record<Suit, string> = { "♦": "方块", "♥": "红心", "♣": "梅花", "♠": "黑桃" };

export function tableChannel(maxMessages = 1, maxLength = 140, description = "对本场所有参与者公开发言"): ChannelSpec {
  return { channel: "table", to: "all", maxMessages, maxLength, description };
}

export function whisperChannel(to: string[], maxMessages = 2, maxLength = 200): ChannelSpec {
  return { channel: "whisper", to, maxMessages, maxLength, description: "私信本场的其他参与者" };
}

export function groupChannel(maxMessages = 1, maxLength = 200): ChannelSpec {
  return { channel: "group", to: "all", maxMessages, maxLength, description: "只有你的小组成员能看到" };
}

export function namesOf(ids: string[], names: Record<string, string>): string[] {
  return ids.map((id) => names[id] ?? id);
}

export function idByName(name: unknown, ids: string[], names: Record<string, string>): string | undefined {
  if (typeof name !== "string") return undefined;
  return ids.find((id) => names[id] === name || id === name);
}

export function randomSuit(rng: { pick<T>(a: readonly T[]): T }): Suit {
  return rng.pick(SUITS);
}

export function playerNames(players: TrialPlayer[]): Record<string, string> {
  return Object.fromEntries(players.map((p) => [p.id, p.name]));
}

export type Dir = "N" | "E" | "S" | "W";
export const DIRS: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const DIR_NAMES: Record<Dir, string> = { N: "北", E: "东", S: "南", W: "西" };
