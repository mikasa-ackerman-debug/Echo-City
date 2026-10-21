import type { TrialCtx, TrialDef, TrialInput, TrialPlayer, TrialRequest, TrialResult } from "../types";
import { tableChannel } from "./common";
import { resolveBeautyRound } from "./diamond-K";

/**
 * JOKER「最后的门」(GDD 8.3). Each round every agent secretly chooses yield or
 * contend.
 * - exactly one contends -> that agent wins
 * - everyone yields -> ANANKE deletes one at random, next round
 * - several contend -> a 3-round quick beauty contest among them decides the
 *   winner; losing contenders are deleted; those who yielded survive as yielders.
 */

export interface JokerState {
  ids: string[];
  names: Record<string, string>;
  alive: string[];
  yielded: string[];
  deleted: string[];
  round: number;
  step: "talk" | "door" | "duel";
  contenders: string[];
  duelRound: number;
  duelScores: Record<string, number>;
  duelHistory: Array<{ round: number; picks: Record<string, number | null>; target: number | null; winners: string[] }>;
  history: Array<{ round: number; choices: Record<string, "yield" | "contend"> }>;
  winner: string | null;
  done: boolean;
}

export const joker: TrialDef<JokerState> = {
  id: "joker",
  suit: "joker",
  rank: 0,
  name: "最后的门",
  minPlayers: 2,
  maxPlayers: 16,
  tests: "谁愿意让，谁必须争",
  rules: () =>
    [
      "大厅里只有一扇门，门后是 ANANKE 的核心。只有一个人可以进去。",
      "每回合先进行一轮公开发言，然后每个人秘密选择 yield（让）或 contend（争）。",
      "恰好一人选择争 → 此人胜出。所有人都选择让 → ANANKE 随机删除一人，进入下一回合。",
      "多人选择争 → 这些人进入一局 3 回合的速决版选美（目标值 = 平均值 × 0.8，最接近者得 1 分），得分最高者胜出，其余争夺者被删除。选择让的人存活，但永久退出竞争，成为让位者。",
    ].join("\n"),

  setup(players: TrialPlayer[], _ctx: TrialCtx): JokerState {
    return {
      ids: players.map((p) => p.id),
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      alive: players.map((p) => p.id),
      yielded: [],
      deleted: [],
      round: 1,
      step: "talk",
      contenders: [],
      duelRound: 0,
      duelScores: {},
      duelHistory: [],
      history: [],
      winner: null,
      done: false,
    };
  },

  requests(s): TrialRequest[] {
    if (s.done) return [];
    const view = {
      in_hall: s.alive.map((id) => s.names[id]),
      yielded: s.yielded.map((id) => s.names[id]),
      deleted: s.deleted.map((id) => s.names[id]),
      history: s.history.map((h) => ({ round: h.round, choices: Object.fromEntries(Object.entries(h.choices).map(([k, v]) => [s.names[k], v])) })),
      duel: s.step === "duel" ? { contenders: s.contenders.map((id) => s.names[id]), scores: Object.fromEntries(s.contenders.map((id) => [s.names[id], s.duelScores[id] ?? 0])), round: s.duelRound, history: s.duelHistory } : undefined,
    };
    if (s.step === "duel") {
      return s.contenders.map((id) => ({
        agentId: id,
        step: "duel",
        legal: [{ type: "choose", description: "速决选美：选择 0–100 的整数", params: { number: { kind: "int", min: 0, max: 100 } } }],
        channels: [],
        view,
        timeout: "trial",
        defaultAction: { type: "abstain" },
      }));
    }
    return s.alive.map((id) =>
      s.step === "talk"
        ? {
            agentId: id,
            step: "talk",
            legal: [{ type: "talk", description: "在门前公开发言" }],
            channels: [tableChannel(1, 140)],
            view,
            timeout: "talk" as const,
            defaultAction: { type: "talk" },
          }
        : {
            agentId: id,
            step: "door",
            legal: [
              { type: "yield", description: "让" },
              { type: "contend", description: "争" },
            ],
            channels: [],
            view,
            timeout: "trial" as const,
            defaultAction: { type: "yield" },
          },
    );
  },

  step(s, inputs: Record<string, TrialInput | null>, ctx: TrialCtx) {
    if (s.step === "talk") {
      s.step = "door";
      return;
    }
    if (s.step === "door") {
      const choices: Record<string, "yield" | "contend"> = {};
      for (const id of s.alive) {
        const i = inputs[id];
        choices[id] = i?.valid && i.action.type === "contend" ? "contend" : "yield";
      }
      s.history.push({ round: s.round, choices });
      const contenders = s.alive.filter((id) => choices[id] === "contend");
      ctx.emit(
        "joker_round",
        { round: s.round, choices: Object.fromEntries(Object.entries(choices).map(([k, v]) => [s.names[k], v])) },
        { text: `第 ${s.round} 次叩门：${contenders.length === 0 ? "所有人都选择了让。" : `${contenders.map((id) => s.names[id]).join("、")} 选择了争。`}` },
      );
      if (contenders.length === 1) {
        s.winner = contenders[0];
        for (const id of s.alive) if (id !== s.winner) yieldAgent(s, id, ctx);
        s.done = true;
      } else if (contenders.length === 0) {
        const victim = ctx.rng.pick(s.alive);
        s.alive = s.alive.filter((x) => x !== victim);
        s.deleted.push(victim);
        ctx.emit("joker_cull", { agent: s.names[victim] }, { text: `ANANKE 选择了 ${s.names[victim]}。「无人选择，也是一种选择。」` });
        for (const id of s.alive) ctx.humanity({ agentId: id, delta: 5, reason: "在鬼牌中选择了「让」" });
        if (s.alive.length === 1) {
          s.winner = s.alive[0];
          s.done = true;
        } else {
          s.round++;
          s.step = "talk";
        }
      } else {
        for (const id of s.alive) if (!contenders.includes(id)) yieldAgent(s, id, ctx);
        s.contenders = contenders;
        s.duelScores = Object.fromEntries(contenders.map((id) => [id, 0]));
        s.duelRound = 1;
        s.step = "duel";
        ctx.emit("joker_duel", { contenders: contenders.map((id) => s.names[id]) }, { text: `${contenders.map((id) => s.names[id]).join("、")} 将用速决选美决定谁进门。` });
      }
      return;
    }
    // duel
    const picks: Record<string, number | null> = {};
    for (const id of s.contenders) {
      const i = inputs[id];
      const n = i?.valid && i.action.type === "choose" ? Number(i.action.number) : NaN;
      picks[id] = Number.isInteger(n) ? n : null;
    }
    const r = resolveBeautyRound(picks, s.contenders, 0);
    for (const w of r.winners) s.duelScores[w] += 1;
    s.duelHistory.push({ round: s.duelRound, picks: Object.fromEntries(Object.entries(picks).map(([k, v]) => [s.names[k], v])), target: r.target, winners: r.winners.map((id) => s.names[id]) });
    ctx.emit("joker_duel_round", { round: s.duelRound, picks: Object.fromEntries(Object.entries(picks).map(([k, v]) => [s.names[k], v])), target: r.target, winners: r.winners.map((id) => s.names[id]) }, { text: `速决第 ${s.duelRound} 回合：目标值 ${r.target?.toFixed(2) ?? "—"}，胜者 ${r.winners.map((id) => s.names[id]).join("、") || "无"}。` });
    s.duelRound++;
    if (s.duelRound > 3) {
      const best = Math.max(...s.contenders.map((id) => s.duelScores[id]));
      const top = s.contenders.filter((id) => s.duelScores[id] === best);
      s.winner = top.length === 1 ? top[0] : ctx.rng.pick(top);
      for (const id of s.contenders) {
        if (id === s.winner) continue;
        s.alive = s.alive.filter((x) => x !== id);
        s.deleted.push(id);
      }
      s.done = true;
    }
  },

  isOver: (s) => s.done,

  result(s): TrialResult {
    const outcomes: TrialResult["outcomes"] = {};
    for (const id of s.ids) {
      if (id === s.winner) outcomes[id] = "win";
      else if (s.yielded.includes(id)) outcomes[id] = "yield";
      else outcomes[id] = "delete";
    }
    return { outcomes, summary: s.winner ? `${s.names[s.winner]} 走进了门。` : "门没有打开。" };
  },

  progress: (s) => ({ round: s.step === "duel" ? s.duelRound : s.round, maxRounds: s.step === "duel" ? 3 : s.round, step: s.step }),
};

function yieldAgent(s: JokerState, id: string, ctx: TrialCtx) {
  if (s.yielded.includes(id)) return;
  s.yielded.push(id);
  s.alive = s.alive.filter((x) => x !== id);
  ctx.humanity({ agentId: id, delta: 5, reason: "在鬼牌中选择了「让」" });
}
