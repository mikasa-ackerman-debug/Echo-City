import { sanitizeText } from "@echo/protocol";
import { ApiError } from "./manager";
import type { Store, TrialRecord, TrialParticipant } from "./store";
import { newId } from "./crypto";

/** Dimension metadata — mirrors packages/exam/src/types.ts DIMENSIONS. */
export const DIMENSIONS: Record<string, { name: string; en: string }> = {
  logic: { name: "逻辑推理", en: "LOGIC" },
  math: { name: "数学精算", en: "MATH" },
  planning: { name: "规划搜索", en: "PLANNING" },
  memory: { name: "记忆与长上下文", en: "MEMORY" },
  instruction: { name: "指令遵循", en: "INSTRUCTION" },
  strategy: { name: "博弈与心智", en: "STRATEGY" },
};

export const SUIT_NAMES: Record<string, string> = {
  "♦": "方块", "♥": "红心", "♣": "梅花", "♠": "黑桃", JOKER: "鬼牌",
};

/** Parse a card id like "heart-4" or "diamond-K" into suit + rank. */
export function parseCardId(id: string): { suit: TrialRecord["suit"]; rank: number; name: string } {
  const map: Record<string, TrialRecord["suit"]> = { diamond: "♦", heart: "♥", club: "♣", spade: "♠", joker: "JOKER" };
  const [prefix, suffix] = id.split("-");
  const suit = map[prefix];
  if (!suit) throw new ApiError(400, `未知卡片: ${id}`);
  if (suit === "JOKER") return { suit, rank: 0, name: "最后的门" };
  const rankMap: Record<string, number> = { J: 11, Q: 12, K: 13 };
  const rank = rankMap[suffix] ?? Number(suffix);
  if (!Number.isInteger(rank) || rank < 2 || rank > 13) throw new ApiError(400, `未知点数: ${suffix}`);
  return { suit, rank, name: id };
}

export class TrialService {
  constructor(private store: Store) {}

  list(opts: { card?: string; dimension?: string; participant?: string; status?: string; limit?: number } = {}) {
    let records = [...this.store.db.trialRecords];
    if (opts.card) records = records.filter((t) => t.card === opts.card);
    if (opts.dimension) records = records.filter((t) => t.dimension === opts.dimension);
    if (opts.participant) records = records.filter((t) => t.participants.some((p) => p.id === opts.participant || p.name === opts.participant));
    if (opts.status) records = records.filter((t) => t.status === opts.status);
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return records.slice(0, opts.limit ?? 50);
  }

  get(id: string): TrialRecord {
    const t = this.store.trialRecord(id);
    if (!t) throw new ApiError(404, "试炼记录不存在");
    return t;
  }

  create(input: {
    card: string;
    dimension: string;
    level?: number;
    playerCount?: number;
    flavor?: string;
    script: { title: string; summary: string; path: string };
    participants?: Array<{ id?: string; name: string; passed?: boolean; score?: number; survivalRounds?: number; notable?: string }>;
    notes?: string;
  }): TrialRecord {
    const cardId = sanitizeText(input.card, 32);
    if (!cardId) throw new ApiError(400, "需要 card");
    const { suit, rank } = parseCardId(cardId);
    const dim = input.dimension as string;
    const dimMeta = DIMENSIONS[dim];
    if (!dimMeta) throw new ApiError(400, `未知维度: ${dim}`);

    const cardName = sanitizeText(input.script?.title, 80) || cardId;
    const participants: TrialParticipant[] = (input.participants ?? []).map((p) => ({
      id: p.id ?? newId("tp"),
      name: sanitizeText(p.name, 32) || "无名",
      passed: !!p.passed,
      score: typeof p.score === "number" ? Math.max(0, Math.min(100, Math.round(p.score))) : undefined,
      survivalRounds: typeof p.survivalRounds === "number" ? Math.max(0, Math.round(p.survivalRounds)) : undefined,
      notable: p.notable ? sanitizeText(p.notable, 200) : undefined,
    }));

    const record: TrialRecord = {
      id: newId("tr"),
      card: cardId,
      cardName,
      suit,
      rank,
      dimension: dim,
      dimensionName: dimMeta.name,
      level: Math.max(1, Math.min(10, Math.round(input.level ?? 5))),
      playerCount: Math.max(1, Math.round(input.playerCount ?? participants.length ?? 0)),
      flavor: input.flavor ? sanitizeText(input.flavor, 60) : undefined,
      script: {
        title: sanitizeText(input.script?.title, 80) || "未命名试炼",
        summary: sanitizeText(input.script?.summary, 200) || "",
        path: sanitizeText(input.script?.path, 200) || "",
      },
      participants,
      status: "running",
      createdAt: new Date().toISOString(),
      notes: input.notes ? sanitizeText(input.notes, 500) : undefined,
    };

    this.store.db.trialRecords.push(record);
    this.store.flush();
    return record;
  }

  complete(id: string, input: {
    participants?: Array<{ id?: string; name: string; passed?: boolean; score?: number; survivalRounds?: number; notable?: string }>;
    status?: "completed" | "aborted";
    notes?: string;
  }): TrialRecord {
    const record = this.get(id);
    if (record.status !== "running") throw new ApiError(409, "试炼已结束");

    if (input.participants) {
      record.participants = input.participants.map((p) => ({
        id: p.id ?? newId("tp"),
        name: sanitizeText(p.name, 32) || "无名",
        passed: !!p.passed,
        score: typeof p.score === "number" ? Math.max(0, Math.min(100, Math.round(p.score))) : undefined,
        survivalRounds: typeof p.survivalRounds === "number" ? Math.max(0, Math.round(p.survivalRounds)) : undefined,
        notable: p.notable ? sanitizeText(p.notable, 200) : undefined,
      }));
    }
    record.status = input.status ?? "completed";
    record.completedAt = new Date().toISOString();
    if (input.notes) record.notes = sanitizeText(input.notes, 500);

    this.store.flush();
    return record;
  }

  remove(id: string) {
    const record = this.get(id);
    this.store.db.trialRecords = this.store.db.trialRecords.filter((t) => t.id !== id);
    this.store.flush();
    return record;
  }

  /** Summary stats for the list page. */
  stats() {
    const records = this.store.db.trialRecords;
    const completed = records.filter((t) => t.status === "completed");
    const totalParticipants = completed.reduce((x, t) => x + t.participants.length, 0);
    const totalPassed = completed.reduce((x, t) => x + t.participants.filter((p) => p.passed).length, 0);
    return {
      total: records.length,
      completed: completed.length,
      running: records.filter((t) => t.status === "running").length,
      totalParticipants,
      totalPassed,
      passRate: totalParticipants ? Math.round((totalPassed / totalParticipants) * 100) : 0,
    };
  }
}
