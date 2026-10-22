"use client";
import { api } from "./api";
import { useResource } from "./data";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CardRoomStatus = "open" | "waiting" | "running" | "closed";

export interface RoomPlayerDTO {
  userId: string;
  name: string;
  agentId?: string;
  joinedAt: string;
}

export interface DimensionWeights {
  logic: number;
  math: number;
  planning: number;
  memory: number;
  instruction: number;
  strategy: number;
}

export interface CardRoomDTO {
  id: string;
  cardId: string;
  cardName: string;
  suit: "♦" | "♥" | "♣" | "♠" | "JOKER";
  rank: number;
  maxPlayers: number;
  hostId: string;
  hostName: string;
  dimensionWeights: DimensionWeights;
  players: RoomPlayerDTO[];
  status: CardRoomStatus;
  scriptTitle?: string;
  scriptSummary?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  survivors: string[];
  results: Array<{ userId: string; name: string; passed: boolean; score?: number }>;
}

export interface CardStateDTO {
  id: string;
  name: string;
  suit: "♦" | "♥" | "♣" | "♠" | "JOKER";
  rank: number;
  maxPlayers: number;
  state: { status: CardRoomStatus; roomId?: string; closedAt?: string };
}

export interface ProgressDTO {
  roundId: string;
  status: "active" | "joker" | "finished";
  total: number;
  closed: number;
  jokerOpen: boolean;
  survivors: Array<{ userId: string; name: string; wins: number }>;
  cardStates: Record<string, { status: CardRoomStatus; roomId?: string; closedAt?: string }>;
}

export const SUIT_ZH: Record<string, string> = {
  "♦": "智力", "♥": "心理", "♣": "协作", "♠": "执行", JOKER: "鬼牌",
};

export function cardLabel(suit: string, rank: number): string {
  if (suit === "JOKER") return "JOKER";
  const r = rank === 11 ? "J" : rank === 12 ? "Q" : rank === 13 ? "K" : String(rank);
  return `${suit}${r}`;
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

export const useProgress = () => useResource<ProgressDTO>("progress", (signal) => api("/api/progress", { signal }), { poll: 5000 });
export const useCardStates = () => useResource<CardStateDTO[]>("cards:states", (signal) => api("/api/cards/states", { signal }), { poll: 5000 });
export const useRooms = (status?: string) => {
  const qs = status ? `?status=${status}` : "";
  return useResource<CardRoomDTO[]>(`rooms:${qs}`, (signal) => api(`/api/rooms${qs}`, { signal }), { poll: 5000 });
};
export const useRoom = (id: string | null) => useResource<CardRoomDTO>(id ? `rooms:${id}` : null, (signal) => api(`/api/rooms/${encodeURIComponent(id!)}`, { signal }), { poll: 3000 });

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export async function createRoom(cardId: string, dimensionWeights?: Partial<DimensionWeights>, agentId?: string) {
  return api<CardRoomDTO>("/api/rooms", { body: { cardId, dimensionWeights, agentId } });
}

export async function joinRoom(roomId: string, agentId?: string) {
  return api<CardRoomDTO>(`/api/rooms/${encodeURIComponent(roomId)}/join`, { body: { agentId } });
}

export async function leaveRoom(roomId: string) {
  return api(`/api/rooms/${encodeURIComponent(roomId)}/leave`, { body: {} });
}

export async function finishGame(roomId: string, results: Array<{ userId: string; name: string; passed: boolean; score?: number }>) {
  return api<CardRoomDTO>(`/api/rooms/${encodeURIComponent(roomId)}/finish`, { body: { results } });
}

export async function openJoker() {
  return api<CardRoomDTO>("/api/rooms/joker", { body: {} });
}
