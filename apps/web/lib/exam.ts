"use client";
import { DIMENSIONS, DIMENSION_IDS, type Dimension } from "@echo/exam";
import { api } from "./api";
import { useResource } from "./data";

/** Standing exam (考场) — types mirror apps/api/src/exam.ts public views. */
export { DIMENSIONS, DIMENSION_IDS, type Dimension };

export interface ExamineeDTO {
  id: string; name: string; kind: "pull" | "hosted" | "webhook" | "house"; model?: string;
  /** Imported from a game Agent (轮回). */
  agentId?: string; lineageId?: string;
  attempts: number; sessions: number; createdAt: string; lastAt?: string;
  overall: number; abilities: Record<Dimension, { r: number; n: number }>;
  best?: number; running?: string | null;
}
export interface AttemptDTO {
  i: number; family: string; dimension: Dimension; level: number | null; title?: string; issuedAt?: string; ms?: number;
  score?: number; correct?: boolean; detail?: string; before?: number; after?: number; expected?: string; answer?: string;
}
export interface SessionDTO { id: string; status: "running" | "done" | "aborted"; createdAt: string; endedAt?: string; score?: number; examinee: ExamineeDTO | null; attempts: AttemptDTO[] }
export interface SessionItem { id: string; status: SessionDTO["status"]; createdAt: string; score?: number; examinee: string; examineeId: string; done: number; total: number }
export interface LevelDTO { level: number; rating: number; attempts: number; passRate: number | null }
export interface FamilyDTO { id: string; name: string; blurb: string; maxLevel: number; levels: LevelDTO[]; frontier: number; attempts: number }
export interface DimensionDTO { id: Dimension; name: string; en: string; blurb: string; population: number; families: FamilyDTO[] }
export interface TaskDTO { id: string; family: string; dimension: Dimension; level: number; title: string; prompt: string; answer_format: string; time_limit_ms: number }

export const KIND_ZH: Record<ExamineeDTO["kind"], string> = { pull: "拉取", hosted: "托管", webhook: "Webhook", house: "基准" };

export const useLibrary = () => useResource<DimensionDTO[]>("exam:lib", (signal) => api("/api/exam/library", { signal, auth: false }), { poll: 15000 });
export const useLadder = () => useResource<ExamineeDTO[]>("exam:ladder", (signal) => api("/api/exam/ladder", { signal, auth: false }), { poll: 10000 });
export const useRecent = () => useResource<SessionItem[]>("exam:recent", (signal) => api("/api/exam/sessions?limit=12", { signal, auth: false }), { poll: 5000 });
// 考卷 / 考生档案仅主人可读（M0 越权修复），必须带 Bearer。
export const useSession = (id: string, poll?: number) => useResource<SessionDTO>(`exam:s:${id}:${poll ?? 0}`, (signal) => api(`/api/exam/sessions/${encodeURIComponent(id)}`, { signal }), { poll });
export const useProfile = (id: string) => useResource<{ examinee: ExamineeDTO; rank: number | null; sessions: Array<SessionItem & { endedAt?: string }> }>(`exam:e:${id}`, (signal) => api(`/api/exam/examinees/${encodeURIComponent(id)}`, { signal }), { poll: 8000 });

/** Rating → a word. 1000 is an untested newcomer; the scale is Elo-like. */
export function tier(r: number): string {
  return r >= 1600 ? "超越" : r >= 1400 ? "卓越" : r >= 1200 ? "熟练" : r >= 1050 ? "合格" : r >= 900 ? "入门" : "未及格";
}
