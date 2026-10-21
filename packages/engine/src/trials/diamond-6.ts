import type { TrialCtx, TrialDef, TrialInput, TrialPlayer, TrialRequest, TrialResult } from "../types";

/** ♦6「密码走廊」：shared Mastermind. Every guess and its feedback is public. */

export function scoreGuess(secret: string, guess: string): { exact: number; partial: number } {
  let exact = 0;
  const sc: Record<string, number> = {};
  const gc: Record<string, number> = {};
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) exact++;
    else {
      sc[secret[i]] = (sc[secret[i]] ?? 0) + 1;
      gc[guess[i]] = (gc[guess[i]] ?? 0) + 1;
    }
  }
  let partial = 0;
  for (const d of Object.keys(gc)) partial += Math.min(gc[d], sc[d] ?? 0);
  return { exact, partial };
}

export interface CorridorState {
  ids: string[];
  names: Record<string, string>;
  secret: string;
  length: number;
  round: number;
  maxRounds: number;
  guesses: Array<{ round: number; agent: string; guess: string; exact: number; partial: number }>;
  solved: Record<string, number>; // agent -> round solved
  firstSolver: string | null;
  done: boolean;
}

export const diamond6: TrialDef<CorridorState> = {
  id: "diamond-6",
  suit: "♦",
  rank: 6,
  name: "密码走廊",
  minPlayers: 2,
  maxPlayers: 6,
  tests: "信息论推理；你的每一次猜测都在帮别人缩小范围",
  rules: (length) =>
    [
      `所有人共同破解同一个 ${length === "short" ? 4 : 5} 位数字密码（每位 0–9，可重复）。`,
      `每回合每人猜 1 次。每次猜测返回：位置和数字都正确的个数（exact）、数字正确但位置错误的个数（partial）。所有人的猜测与反馈对所有人公开。`,
      `共 ${length === "short" ? 6 : 8} 回合。通关条件：自己猜中密码。第一个猜中的人额外 Uptime +1（同回合猜中的都算第一）。失败：删除。`,
    ].join("\n"),

  setup(players: TrialPlayer[], ctx: TrialCtx): CorridorState {
    const length = ctx.length === "short" ? 4 : 5;
    let secret = "";
    for (let i = 0; i < length; i++) secret += String(ctx.rng.int(0, 9));
    return {
      ids: players.map((p) => p.id),
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      secret,
      length,
      round: 1,
      maxRounds: ctx.length === "short" ? 6 : 8,
      guesses: [],
      solved: {},
      firstSolver: null,
      done: false,
    };
  },

  requests(s): TrialRequest[] {
    const view = {
      length: s.length,
      guesses: s.guesses.map((g) => ({ round: g.round, agent: s.names[g.agent], guess: g.guess, exact: g.exact, partial: g.partial })),
      solved: Object.keys(s.solved).map((id) => s.names[id]),
    };
    return s.ids
      .filter((id) => s.solved[id] === undefined)
      .map((id) => ({
        agentId: id,
        step: "guess",
        legal: [
          {
            type: "guess",
            description: `猜一个 ${s.length} 位数字串，例如 "${"0123456789".slice(0, s.length)}"`,
            params: { code: { kind: "string", maxLength: s.length, minLength: s.length } },
          },
        ],
        channels: [],
        view,
        timeout: "trial",
        defaultAction: { type: "guess", code: "0".repeat(s.length) },
      }));
  },

  step(s, inputs: Record<string, TrialInput | null>, ctx: TrialCtx) {
    const solvedNow: string[] = [];
    for (const id of s.ids) {
      if (s.solved[id] !== undefined) continue;
      const input = inputs[id];
      let code = input?.valid && input.action.type === "guess" ? String(input.action.code) : "";
      if (!new RegExp(`^\\d{${s.length}}$`).test(code)) code = "0".repeat(s.length);
      const { exact, partial } = scoreGuess(s.secret, code);
      s.guesses.push({ round: s.round, agent: id, guess: code, exact, partial });
      if (exact === s.length) {
        s.solved[id] = s.round;
        solvedNow.push(id);
      }
    }
    ctx.emit(
      "corridor_round",
      { round: s.round, guesses: s.guesses.filter((g) => g.round === s.round).map((g) => ({ agent: s.names[g.agent], guess: g.guess, exact: g.exact, partial: g.partial })) },
      { text: `第 ${s.round} 回合：${solvedNow.length ? `${solvedNow.map((id) => s.names[id]).join("、")} 打开了门。` : "所有的门都还锁着。"}` },
    );
    if (!s.firstSolver && solvedNow.length) s.firstSolver = solvedNow.join(",");
    s.round++;
    if (s.round > s.maxRounds || s.ids.every((id) => s.solved[id] !== undefined)) s.done = true;
  },

  isOver: (s) => s.done,

  result(s): TrialResult {
    const outcomes: TrialResult["outcomes"] = {};
    for (const id of s.ids) outcomes[id] = s.solved[id] !== undefined ? "pass" : "delete";
    const bonusUptime: Record<string, number> = {};
    for (const id of (s.firstSolver ?? "").split(",").filter(Boolean)) bonusUptime[id] = 1;
    return { outcomes, bonusUptime, summary: `密码是 ${s.secret}。` };
  },

  progress: (s) => ({ round: Math.min(s.round, s.maxRounds), maxRounds: s.maxRounds, step: "guess" }),
};
