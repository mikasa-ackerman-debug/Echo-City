import type { TrialCtx, TrialDef, TrialInput, TrialPlayer, TrialRequest, TrialResult } from "../types";
import { whisperChannel } from "./common";

/** ♥7「囚徒的晚餐」：iterated prisoner's dilemma with public pairings. */

const PAYOFF: Record<string, [number, number]> = {
  "cooperate/cooperate": [3, 3],
  "cooperate/defect": [0, 5],
  "defect/cooperate": [5, 0],
  "defect/defect": [1, 1],
};

export interface DinnerState {
  ids: string[];
  names: Record<string, string>;
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  step: "talk" | "choose";
  pairs: Array<[string, string]>;
  bye: string | null;
  history: Array<{ round: number; results: Array<{ a: string; b: string; ca: string; cb: string; pa: number; pb: number }>; bye: string | null }>;
  tiebreak: Record<string, number>;
  done: boolean;
}

function pairUp(s: DinnerState, ctx: TrialCtx) {
  const order = ctx.rng.shuffle(s.ids);
  s.pairs = [];
  s.bye = order.length % 2 === 1 ? order.pop()! : null;
  for (let i = 0; i < order.length; i += 2) s.pairs.push([order[i], order[i + 1]]);
}

function partnerOf(s: DinnerState, id: string): string | null {
  for (const [a, b] of s.pairs) {
    if (a === id) return b;
    if (b === id) return a;
  }
  return null;
}

export const heart7: TrialDef<DinnerState> = {
  id: "heart-7",
  suit: "♥",
  rank: 7,
  name: "囚徒的晚餐",
  minPlayers: 4,
  maxPlayers: 8,
  tests: "重复博弈策略、声誉管理",
  rules: (length) =>
    [
      `共 ${length === "short" ? 4 : 6} 回合。每回合所有人随机两两配对，配对结果公开。人数为奇数时，一人轮空并获得 2 分。`,
      "每对先进行一轮私聊（每人最多 2 条），然后同时选择 cooperate（合作）或 defect（背叛）。",
      "收益：双方合作 3/3；一方背叛 5/0；双方背叛 1/1。每回合结果公开。",
      "通关条件：总分不在最后 2 名（同分时由 ANANKE 抽签）。失败：删除。",
    ].join("\n"),

  setup(players: TrialPlayer[], ctx: TrialCtx): DinnerState {
    const s: DinnerState = {
      ids: players.map((p) => p.id),
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      round: 1,
      maxRounds: ctx.length === "short" ? 4 : 6,
      step: "talk",
      pairs: [],
      bye: null,
      history: [],
      tiebreak: Object.fromEntries(players.map((p) => [p.id, ctx.rng.next()])),
      done: false,
    };
    pairUp(s, ctx);
    ctx.emit("dinner_pairs", { round: 1, pairs: s.pairs.map(([a, b]) => [s.names[a], s.names[b]]), bye: s.bye ? s.names[s.bye] : null }, { text: `第 1 回合配对：${s.pairs.map(([a, b]) => `${s.names[a]} × ${s.names[b]}`).join("，")}。` });
    return s;
  },

  requests(s): TrialRequest[] {
    if (s.done) return [];
    const view = (id: string) => ({
      scores: Object.fromEntries(s.ids.map((x) => [s.names[x], s.scores[x]])),
      partner: partnerOf(s, id) ? s.names[partnerOf(s, id)!] : null,
      pairs: s.pairs.map(([a, b]) => [s.names[a], s.names[b]]),
      history: s.history.slice(-4).map((h) => ({
        round: h.round,
        results: h.results.map((r) => ({ [s.names[r.a]]: r.ca, [s.names[r.b]]: r.cb })),
      })),
    });
    return s.ids
      .filter((id) => partnerOf(s, id))
      .map((id) => {
        const partner = partnerOf(s, id)!;
        return s.step === "talk"
          ? {
              agentId: id,
              step: "talk",
              legal: [{ type: "talk", description: "私聊阶段：用 whisper 频道给你的配对对象发消息" }],
              channels: [whisperChannel([s.names[partner]], 2, 200)],
              view: view(id),
              timeout: "talk" as const,
              defaultAction: { type: "talk" },
            }
          : {
              agentId: id,
              step: "choose",
              legal: [
                { type: "cooperate", description: "合作" },
                { type: "defect", description: "背叛" },
              ],
              channels: [],
              view: view(id),
              timeout: "trial" as const,
              defaultAction: { type: "defect" },
            };
      });
  },

  step(s, inputs: Record<string, TrialInput | null>, ctx: TrialCtx) {
    if (s.step === "talk") {
      s.step = "choose";
      return;
    }
    const choice = (id: string) => {
      const i = inputs[id];
      return i?.valid && (i.action.type === "cooperate" || i.action.type === "defect") ? i.action.type : "defect";
    };
    const results: DinnerState["history"][number]["results"] = [];
    for (const [a, b] of s.pairs) {
      const ca = choice(a);
      const cb = choice(b);
      const [pa, pb] = PAYOFF[`${ca}/${cb}`];
      s.scores[a] += pa;
      s.scores[b] += pb;
      results.push({ a, b, ca, cb, pa, pb });
    }
    if (s.bye) s.scores[s.bye] += 2;
    s.history.push({ round: s.round, results, bye: s.bye });
    const zh = (c: string) => (c === "cooperate" ? "合作" : "背叛");
    ctx.emit(
      "dinner_round",
      { round: s.round, results: results.map((r) => ({ a: s.names[r.a], b: s.names[r.b], ca: r.ca, cb: r.cb, pa: r.pa, pb: r.pb })), scores: Object.fromEntries(s.ids.map((x) => [s.names[x], s.scores[x]])) },
      { text: `第 ${s.round} 回合：${results.map((r) => `${s.names[r.a]} ${zh(r.ca)} / ${s.names[r.b]} ${zh(r.cb)}`).join("；")}。` },
    );
    s.round++;
    if (s.round > s.maxRounds) {
      s.done = true;
      return;
    }
    s.step = "talk";
    pairUp(s, ctx);
    ctx.emit("dinner_pairs", { round: s.round, pairs: s.pairs.map(([a, b]) => [s.names[a], s.names[b]]), bye: s.bye ? s.names[s.bye] : null }, { text: `第 ${s.round} 回合配对：${s.pairs.map(([a, b]) => `${s.names[a]} × ${s.names[b]}`).join("，")}。` });
  },

  isOver: (s) => s.done,

  result(s): TrialResult {
    const ranked = s.ids.slice().sort((a, b) => s.scores[a] - s.scores[b] || s.tiebreak[a] - s.tiebreak[b]);
    const losers = new Set(ranked.slice(0, Math.min(2, Math.max(0, ranked.length - 1))));
    const outcomes: TrialResult["outcomes"] = {};
    for (const id of s.ids) outcomes[id] = losers.has(id) ? "delete" : "pass";
    return { outcomes, summary: `最终比分：${ranked.slice().reverse().map((id) => `${s.names[id]} ${s.scores[id]}`).join("，")}。` };
  },

  progress: (s) => ({ round: Math.min(s.round, s.maxRounds), maxRounds: s.maxRounds, step: s.step }),
};
