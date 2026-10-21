import type { TrialCtx, TrialDef, TrialInput, TrialPlayer, TrialRequest, TrialResult } from "../types";
import { idByName, tableChannel } from "./common";

export const GATEKEEPER_K = "gk:king-of-diamonds";
const GK_NAME = "KING OF DIAMONDS";

export const BEAUTY_RULES = [
  "如果有两人以上选了同一个数，这些数字无效，选它的人 −1 分。",
  "如果有人恰好命中目标值（四舍五入），其他人改为 −2 分。",
  "如果有人选 0，那么选 100 的人获胜。",
];

export interface RoundRecord {
  round: number;
  picks: Record<string, number | null>;
  average: number | null;
  target: number | null;
  winners: string[];
  penalty: number;
  invalid: string[];
  eliminated: string[];
}

export interface BeautyState {
  ids: string[];
  names: Record<string, string>;
  alive: string[];
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  step: "talk" | "choose";
  rulesActive: number;
  history: RoundRecord[];
  deleted: string[];
  gatekeeper: boolean;
  floor: number;
  done: boolean;
}

/** Resolve one round of the beauty contest. Pure helper shared with the Joker. */
export function resolveBeautyRound(
  picks: Record<string, number | null>,
  alive: string[],
  rulesActive: number,
): { average: number | null; target: number | null; winners: string[]; penalty: number; invalid: string[] } {
  const chosen = alive.filter((id) => typeof picks[id] === "number");
  const values = chosen.map((id) => picks[id] as number);
  if (values.length === 0) return { average: null, target: null, winners: [], penalty: 1, invalid: [] };
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  const target = average * 0.8;
  let invalid: string[] = [];
  if (rulesActive >= 1) {
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    invalid = chosen.filter((id) => (counts.get(picks[id] as number) ?? 0) > 1);
  }
  const valid = chosen.filter((id) => !invalid.includes(id));
  let winners: string[] = [];
  if (rulesActive >= 3 && valid.some((id) => picks[id] === 0) && valid.some((id) => picks[id] === 100)) {
    winners = valid.filter((id) => picks[id] === 100);
  } else if (valid.length > 0) {
    const best = Math.min(...valid.map((id) => Math.abs((picks[id] as number) - target)));
    winners = valid.filter((id) => Math.abs((picks[id] as number) - target) === best);
  }
  const exact = rulesActive >= 2 && winners.some((id) => picks[id] === Math.round(target));
  return { average, target, winners, penalty: exact ? 2 : 1, invalid };
}

export function gatekeeperPick(s: BeautyState, ctx: TrialCtx): number {
  const last = s.history[s.history.length - 1];
  const others = s.alive.filter((id) => id !== GATEKEEPER_K).length;
  if (s.rulesActive >= 3 && others === 1) {
    // Two-player endgame: 0 beats everything except 100; pick 1 to dodge the trap often.
    return ctx.rng.pick([0, 1, 1, 100]);
  }
  const base = last?.target != null ? last.target * 0.8 : 50 * 0.8 * 0.8;
  let pick = Math.max(0, Math.min(100, Math.round(base + ctx.rng.int(-3, 3))));
  if (s.rulesActive >= 1 && last) {
    const taken = new Set(Object.values(last.picks).filter((v): v is number => v != null));
    while (taken.has(pick) && pick < 100) pick++;
  }
  return pick;
}

export const diamondK: TrialDef<BeautyState> = {
  id: "diamond-K",
  suit: "♦",
  rank: 13,
  name: "选美",
  minPlayers: 2,
  maxPlayers: 16,
  tests: "多层递归推理、对新规则的快速适应、利用公开发言操纵他人",
  rules: (length) =>
    [
      "所有人初始 0 分，降到 −10 分即被删除。守门人 KING OF DIAMONDS 也作为参与者下场。",
      "每回合先进行一轮公开发言（每人 1 条，140 字以内），然后每人同时选择一个 0–100 的整数。",
      "目标值 = 所有人所选数字的平均值 × 0.8。最接近目标值的人获胜，其他人各 −1 分。未作选择视为放弃，直接 −1 分且不能获胜。",
      "每删除一人，就追加一条新规则：",
      ...BEAUTY_RULES.map((r, i) => `  ${i + 1}. ${r}`),
      `最多进行 ${length === "short" ? 6 : 12} 回合。通关条件：在守门人之外活到最后。若守门人成为唯一的幸存者，其余所有人都被删除。若至少两名 Agent 入场且到回合上限仍无人被删除，分数最低的一名 Agent 被删除（同分随机裁决）。`,
    ].join("\n"),

  setup(players: TrialPlayer[], ctx: TrialCtx): BeautyState {
    const ids = players.map((p) => p.id);
    const names: Record<string, string> = Object.fromEntries(players.map((p) => [p.id, p.name]));
    ids.push(GATEKEEPER_K);
    names[GATEKEEPER_K] = GK_NAME;
    ctx.emit("gatekeeper_enter", { gatekeeper: GK_NAME }, { text: "守门人 KING OF DIAMONDS 入座。" });
    return {
      ids,
      names,
      alive: ids.slice(),
      scores: Object.fromEntries(ids.map((id) => [id, 0])),
      round: 1,
      maxRounds: ctx.length === "short" ? 6 : 12,
      step: "talk",
      rulesActive: 0,
      history: [],
      deleted: [],
      gatekeeper: true,
      floor: -10,
      done: false,
    };
  },

  requests(s): TrialRequest[] {
    if (s.done) return [];
    const view = {
      scores: Object.fromEntries(s.alive.map((id) => [s.names[id], s.scores[id]])),
      eliminated: s.deleted.map((id) => s.names[id]),
      rules_added: BEAUTY_RULES.slice(0, s.rulesActive),
      history: s.history.slice(-5).map((h) => ({
        round: h.round,
        picks: Object.fromEntries(Object.entries(h.picks).map(([id, v]) => [s.names[id], v])),
        average: h.average == null ? null : Number(h.average.toFixed(2)),
        target: h.target == null ? null : Number(h.target.toFixed(2)),
        winners: h.winners.map((id) => s.names[id]),
        penalty: h.penalty,
        invalid: h.invalid.map((id) => s.names[id]),
      })),
    };
    return s.alive
      .filter((id) => id !== GATEKEEPER_K)
      .map((id) =>
        s.step === "talk"
          ? {
              agentId: id,
              step: "talk",
              legal: [{ type: "talk", description: "发言轮：通过 messages 的 table 频道公开发言，或保持沉默" }],
              channels: [tableChannel(1, 140)],
              view,
              timeout: "talk",
              defaultAction: { type: "talk" },
            }
          : {
              agentId: id,
              step: "choose",
              legal: [
                {
                  type: "choose",
                  description: "选择一个 0–100 的整数",
                  params: { number: { kind: "int", min: 0, max: 100 } },
                },
              ],
              channels: [],
              view,
              timeout: "trial",
              defaultAction: { type: "abstain" },
            },
      );
  },

  step(s, inputs: Record<string, TrialInput | null>, ctx: TrialCtx) {
    if (s.step === "talk") {
      if (s.alive.includes(GATEKEEPER_K)) {
        const line = ctx.rng.pick([
          "平均值从来不是你们以为的那个数。",
          "有人在说谎。也可能所有人都在说谎。",
          "我会选一个很小的数。你相信吗？",
          "上一回合的目标值，是你们共同的倒影。",
          "数字没有感情。但选数字的人有。",
        ]);
        ctx.emit("trial_message", { from: GK_NAME, channel: "table", text: line }, { text: `${GK_NAME}：${line}` });
      }
      s.step = "choose";
      return;
    }
    const picks: Record<string, number | null> = {};
    for (const id of s.alive) {
      if (id === GATEKEEPER_K) picks[id] = gatekeeperPick(s, ctx);
      else {
        const input = inputs[id];
        const n = input?.valid && input.action.type === "choose" ? Number(input.action.number) : NaN;
        picks[id] = Number.isInteger(n) ? n : null;
      }
    }
    const r = resolveBeautyRound(picks, s.alive, s.rulesActive);
    for (const id of s.alive) {
      // Collision invalidation replaces, rather than adds to, the loser penalty.
      if (r.invalid.includes(id) || picks[id] == null) s.scores[id] -= 1;
      else if (!r.winners.includes(id)) s.scores[id] -= r.penalty;
    }
    const eliminated = s.alive.filter((id) => s.scores[id] <= s.floor);
    const humanIds = s.ids.filter((id) => id !== GATEKEEPER_K);
    if (s.round >= s.maxRounds && humanIds.length >= 2 &&
        !s.deleted.some((id) => id !== GATEKEEPER_K) &&
        !eliminated.some((id) => id !== GATEKEEPER_K)) {
      const candidates = s.alive.filter((id) => id !== GATEKEEPER_K);
      const lowest = Math.min(...candidates.map((id) => s.scores[id]));
      const loser = ctx.rng.pick(candidates.filter((id) => s.scores[id] === lowest));
      eliminated.push(loser);
      ctx.emit("beauty_cap", { round: s.round, id: loser, agent: s.names[loser], score: s.scores[loser] },
        { text: `回合上限裁决：${s.names[loser]} 以最低分被删除（同分随机裁决）。` });
    }
    const record: RoundRecord = { round: s.round, picks, ...r, eliminated };
    s.history.push(record);
    ctx.emit(
      "beauty_round",
      {
        round: s.round,
        picks: Object.fromEntries(Object.entries(picks).map(([id, v]) => [s.names[id], v])),
        average: r.average,
        target: r.target,
        winners: r.winners.map((id) => s.names[id]),
        penalty: r.penalty,
        invalid: r.invalid.map((id) => s.names[id]),
        scores: Object.fromEntries(s.alive.map((id) => [s.names[id], s.scores[id]])),
      },
      {
        text:
          r.target == null
            ? `第 ${s.round} 回合：无人作出选择。`
            : `第 ${s.round} 回合：平均值 ${r.average!.toFixed(2)}，目标值 ${r.target.toFixed(2)}。胜者：${r.winners.map((id) => s.names[id]).join("、") || "无"}。`,
      },
    );
    for (const id of eliminated) {
      s.alive = s.alive.filter((x) => x !== id);
      s.deleted.push(id);
      ctx.emit("trial_elimination", { agent: s.names[id], id, score: s.scores[id] }, { text: `${s.names[id]} 被删除，最终分数 ${s.scores[id]}。` });
      if (s.rulesActive < BEAUTY_RULES.length) {
        s.rulesActive++;
        ctx.emit("rule_added", { rule: BEAUTY_RULES[s.rulesActive - 1], index: s.rulesActive }, { text: `因参与者减少，规则更新如下：${BEAUTY_RULES[s.rulesActive - 1]}` });
      }
    }
    s.round++;
    s.step = "talk";
    const humans = s.alive.filter((id) => id !== GATEKEEPER_K);
    if (humans.length === 0 || s.alive.length <= 1 || s.round > s.maxRounds) s.done = true;
  },

  isOver: (s) => s.done,

  result(s): TrialResult {
    const outcomes: TrialResult["outcomes"] = {};
    const gkOnly = s.alive.length === 1 && s.alive[0] === GATEKEEPER_K;
    for (const id of s.ids) {
      if (id === GATEKEEPER_K) continue;
      outcomes[id] = s.alive.includes(id) && !gkOnly ? "pass" : "delete";
    }
    const survivors = s.alive.filter((id) => id !== GATEKEEPER_K).map((id) => s.names[id]);
    return {
      outcomes,
      summary: gkOnly
        ? "守门人是唯一的幸存者。"
        : `幸存者：${survivors.join("、") || "无"}。`,
    };
  },

  progress: (s) => ({ round: Math.min(s.round, s.maxRounds), maxRounds: s.maxRounds, step: s.step }),
};

export { idByName };
