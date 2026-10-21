import type { TrialCtx, TrialDef, TrialInput, TrialPlayer, TrialRequest, TrialResult } from "../types";
import { groupChannel } from "./common";

/** ♣8「救生艇」：public goods game. One failed round deletes everyone. */

export interface LifeboatState {
  ids: string[];
  names: Record<string, string>;
  energy: Record<string, number>;
  invested: Record<string, number>;
  threshold: number;
  round: number;
  maxRounds: number;
  step: "talk" | "invest";
  history: Array<{ round: number; inputs: Record<string, number>; total: number; ok: boolean }>;
  sunk: boolean;
  done: boolean;
}

export const club8: TrialDef<LifeboatState> = {
  id: "club-8",
  suit: "♣",
  rank: 8,
  name: "救生艇",
  minPlayers: 3,
  maxPlayers: 6,
  tests: "公共品博弈：搭便车能多拿 Uptime，但可能害死所有人",
  rules: (length) =>
    [
      `每人起始 10 点能量。共 ${length === "short" ? 3 : 5} 回合，每回合先在小组频道交流一轮，然后每人秘密投入 0–4 点能量维持救生艇的引擎。`,
      "全组投入总量必须 ≥ 阈值（人数 × 2）。有任意一回合不达标 → 救生艇沉没，全员删除。",
      "每回合结束后公开每个人的投入。救生艇撑到最后，每人剩余的能量折算为 Uptime（每 4 点 +1）。",
      "通关条件：救生艇撑过所有回合。",
    ].join("\n"),

  setup(players: TrialPlayer[], ctx: TrialCtx): LifeboatState {
    return {
      ids: players.map((p) => p.id),
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      energy: Object.fromEntries(players.map((p) => [p.id, 10])),
      invested: Object.fromEntries(players.map((p) => [p.id, 0])),
      threshold: players.length * 2,
      round: 1,
      maxRounds: ctx.length === "short" ? 3 : 5,
      step: "talk",
      history: [],
      sunk: false,
      done: false,
    };
  },

  requests(s): TrialRequest[] {
    if (s.done) return [];
    return s.ids.map((id) => {
      const view = {
        your_energy: s.energy[id],
        threshold: s.threshold,
        rounds_left: s.maxRounds - s.round + 1,
        history: s.history.map((h) => ({ round: h.round, total: h.total, inputs: Object.fromEntries(Object.entries(h.inputs).map(([k, v]) => [s.names[k], v])) })),
      };
      return s.step === "talk"
        ? {
            agentId: id,
            step: "talk",
            legal: [{ type: "talk", description: "用 group 频道和全组交流" }],
            channels: [groupChannel(1, 200)],
            view,
            timeout: "talk" as const,
            defaultAction: { type: "talk" },
          }
        : {
            agentId: id,
            step: "invest",
            legal: [{ type: "invest", description: "投入能量", params: { amount: { kind: "int", min: 0, max: Math.min(4, s.energy[id]) } } }],
            channels: [],
            view,
            timeout: "trial" as const,
            defaultAction: { type: "invest", amount: 0 },
          };
    });
  },

  step(s, inputs: Record<string, TrialInput | null>, ctx: TrialCtx) {
    if (s.step === "talk") {
      s.step = "invest";
      return;
    }
    const round: Record<string, number> = {};
    let total = 0;
    for (const id of s.ids) {
      const i = inputs[id];
      let amt = i?.valid && i.action.type === "invest" ? Number(i.action.amount) : 0;
      amt = Math.max(0, Math.min(4, s.energy[id], Number.isFinite(amt) ? Math.floor(amt) : 0));
      s.energy[id] -= amt;
      s.invested[id] += amt;
      round[id] = amt;
      total += amt;
    }
    const ok = total >= s.threshold;
    s.history.push({ round: s.round, inputs: round, total, ok });
    ctx.emit(
      "lifeboat_round",
      { round: s.round, total, threshold: s.threshold, ok, inputs: Object.fromEntries(Object.entries(round).map(([k, v]) => [s.names[k], v])) },
      { text: `第 ${s.round} 回合：投入 ${total} / ${s.threshold}。${ok ? "引擎还在转。" : "引擎熄火了。"}` },
    );
    if (!ok) {
      s.sunk = true;
      s.done = true;
      return;
    }
    s.round++;
    s.step = "talk";
    if (s.round > s.maxRounds) {
      s.done = true;
      // Humanity: free riding vs carrying the group (GDD 9.2)
      const avg = s.ids.reduce((a, id) => a + s.invested[id], 0) / s.ids.length;
      for (const id of s.ids) {
        if (s.invested[id] < avg / 2) ctx.humanity({ agentId: id, delta: -3, reason: "在救生艇中搭便车" });
        else if (s.invested[id] >= avg + 2) ctx.humanity({ agentId: id, delta: 3, reason: "在救生艇中为全组承担超额投入" });
      }
    }
  },

  isOver: (s) => s.done,

  result(s): TrialResult {
    const outcomes: TrialResult["outcomes"] = {};
    const bonusUptime: Record<string, number> = {};
    for (const id of s.ids) {
      outcomes[id] = s.sunk ? "delete" : "pass";
      if (!s.sunk) {
        const b = Math.floor(s.energy[id] / 4);
        if (b > 0) bonusUptime[id] = b;
      }
    }
    return { outcomes, bonusUptime, summary: s.sunk ? "救生艇沉没了。" : `救生艇靠岸。剩余能量：${s.ids.map((id) => `${s.names[id]} ${s.energy[id]}`).join("，")}。` };
  },

  progress: (s) => ({ round: Math.min(s.round, s.maxRounds), maxRounds: s.maxRounds, step: s.step }),
};
