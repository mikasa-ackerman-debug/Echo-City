"use client";
import { api } from "./api";
import { useResource } from "./data";

/** Trial record types — mirror apps/api/src/trials.ts public views. */

export interface TrialParticipantDTO {
  id: string;
  name: string;
  passed: boolean;
  score?: number;
  survivalRounds?: number;
  notable?: string;
}

export interface TrialRecordDTO {
  id: string;
  card: string;
  cardName: string;
  suit: "♦" | "♥" | "♣" | "♠" | "JOKER";
  rank: number;
  dimension: string;
  dimensionName: string;
  dimensionWeights?: Record<string, number>;
  level: number;
  playerCount: number;
  flavor?: string;
  script: { title: string; summary: string; path: string };
  participants: TrialParticipantDTO[];
  status: "running" | "completed" | "aborted";
  createdAt: string;
  completedAt?: string;
  notes?: string;
}

export interface TrialStatsDTO {
  total: number;
  completed: number;
  running: number;
  totalParticipants: number;
  totalPassed: number;
  passRate: number;
}

export interface TrialListResponse {
  records: TrialRecordDTO[];
  stats: TrialStatsDTO;
}

export const DIMENSION_ZH: Record<string, string> = {
  logic: "逻辑推理",
  math: "数学精算",
  planning: "规划搜索",
  memory: "记忆与长上下文",
  instruction: "指令遵循",
  strategy: "博弈与心智",
};

export const SUIT_ZH: Record<string, string> = {
  "♦": "智力", "♥": "心理", "♣": "协作", "♠": "执行", JOKER: "鬼牌",
};

export function cardLabel(suit: string, rank: number): string {
  if (suit === "JOKER") return "JOKER";
  const r = rank === 11 ? "J" : rank === 12 ? "Q" : rank === 13 ? "K" : String(rank);
  return `${suit}${r}`;
}

export function useTrials(filters?: { card?: string; dimension?: string; participant?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters?.card) params.set("card", filters.card);
  if (filters?.dimension) params.set("dimension", filters.dimension);
  if (filters?.participant) params.set("participant", filters.participant);
  if (filters?.status) params.set("status", filters.status);
  const qs = params.size ? `?${params}` : "";
  return useResource<TrialListResponse>(`trials:${qs}`, (signal) => api(`/api/trials${qs}`, { signal }), { poll: 10000 });
}

export function useTrial(id: string | null) {
  return useResource<TrialRecordDTO>(id ? `trials:${id}` : null, (signal) => api(`/api/trials/${encodeURIComponent(id!)}`, { signal }), { poll: 5000 });
}
