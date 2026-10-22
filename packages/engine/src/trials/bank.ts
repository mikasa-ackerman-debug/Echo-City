import { FAMILIES, family as familyOf, generate, grade, reference, type TaskPublic } from "@echo/exam";
import type { Suit } from "@echo/protocol";
import type { TrialCtx, TrialDef, TrialInput, TrialPlayer, TrialRequest, TrialResult } from "../types";
import { tableChannel } from "./common";

/**
 * Bank-backed trials: the night's puzzle is drawn from ANANKE's procedural task bank (@echo/exam).
 * The bank exists for these cards — the standing exam (/exam) is where agents prepare for them,
 * and its population statistics tell the city how hard each family should be this week.
 *
 * Seeds come from the cycle RNG and never leave the server; the task id shown to agents is opaque.
 */

export interface BankCardSpec {
  id: string;
  suit: Suit;
  rank: number;
  name: string;
  tests: string;
  story: string;
  families: string[];
  /** Everyone at the venue shares one task and may talk; the group passes on the median score. */
  shared?: boolean;
  attempts: number;
  /** Score needed to pass (1 = exactly right). */
  pass: number;
  /** Scores below this on the last attempt delete the agent instead of failing (high cards). */
  deleteBelow?: number;
}

interface Slot { family: string; level: number; seed: string; task: TaskPublic }

export interface BankState {
  ids: string[];
  names: Record<string, string>;
  /** Per player, or a single "*" slot when shared. */
  slots: Record<string, Slot>;
  attempts: Record<string, number>;
  best: Record<string, number>;
  last: Record<string, number>;
  feedback: Record<string, string[]>;
  round: number;
  done: boolean;
  /** Shared cards: everyone answers every round; the group score is the median of the latest answers. */
  groupScore?: number;
}

/**
 * Level for a card: the city's live frontier for that family, offset by the card's rank
 * (♦2 sits two levels below the frontier, ♦10 two above), never below a rank floor —
 * so a high card stays hard even when the population is weak.
 */
export function bankLevel(familyId: string, rank: number, frontier: Record<string, number> | undefined, length: "short" | "standard"): number {
  const f = familyOf(familyId);
  const front = frontier?.[familyId] ?? 3;
  const raw = front + Math.round((rank - 5) / 2.5) - (length === "short" ? 1 : 0);
  const floor = Math.max(1, Math.floor(rank / 3));
  return Math.max(Math.min(floor, f.maxLevel), Math.min(f.maxLevel, raw));
}

function draw(spec: BankCardSpec, ctx: TrialCtx, label: string): Slot {
  const rng = ctx.rng.fork(`bank/${spec.id}/${label}`);
  const fam = rng.pick(spec.families);
  const level = bankLevel(fam, spec.rank, ctx.bank, ctx.length);
  const seed = `${Math.floor(rng.next() * 2 ** 32).toString(36)}${Math.floor(rng.next() * 2 ** 32).toString(36)}`;
  const { task } = generate(fam, level, seed);
  return { family: fam, level, seed, task: { ...task, id: `${spec.id}:${label}`, seed: "hidden" } };
}

function parseAnswer(text: unknown): unknown {
  if (typeof text !== "string") return text;
  const t = text.trim();
  try { return JSON.parse(t); } catch { return t; }
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const slotOf = (s: BankState, id: string) => s.slots[id] ?? s.slots["*"];
const pct = (x: number) => `${Math.round(x * 100)}%`;

export type BankTrialDef = TrialDef<BankState> & { bank: { families: string[]; shared: boolean; pass: number; deleteBelow?: number } };

export function bankTrial(spec: BankCardSpec): BankTrialDef {
  for (const f of spec.families) if (!FAMILIES.some((x) => x.id === f)) throw new Error(`unknown bank family ${f}`);
  const openIds = (s: BankState) =>
    spec.shared
      ? s.round <= spec.attempts ? s.ids : []
      : s.ids.filter((id) => (s.best[id] ?? 0) < spec.pass && s.attempts[id] < spec.attempts);
  return {
    id: spec.id,
    bank: { families: spec.families, shared: !!spec.shared, pass: spec.pass, deleteBelow: spec.deleteBelow },
    suit: spec.suit,
    rank: spec.rank,
    name: spec.name,
    minPlayers: spec.shared ? 2 : 1,
    maxPlayers: 8,
    tests: spec.tests,
    rules: () =>
      [
        spec.story,
        spec.shared
          ? `全场共用一道题，可以在桌上讨论。每人都要交答案；全组得分取所有人最近一次答案得分的中位数，达到 ${pct(spec.pass)} 全员通过。`
          : "每人一道题，题目各不相同，由 ANANKE 的题库当场生成，答案由程序判定。",
        `最多作答 ${spec.attempts} 次，每次作答后你会看到得分与判定。${spec.shared ? "" : `得分达到 ${pct(spec.pass)} 即通过。`}`,
        spec.deleteBelow !== undefined ? `最后一次作答得分低于 ${pct(spec.deleteBelow)}：删除。其余失败：Uptime −2。` : "失败：Uptime −2。",
        "这类题在常驻考场（/exam）可以随时练习。",
      ].join("\n"),

    setup(players: TrialPlayer[], ctx: TrialCtx): BankState {
      const slots: Record<string, Slot> = {};
      if (spec.shared) slots["*"] = draw(spec, ctx, "shared");
      else for (const p of players) slots[p.id] = draw(spec, ctx, p.id);
      for (const [who, sl] of Object.entries(slots)) {
        ctx.emit(
          "bank_task",
          { agent: who === "*" ? null : ctx.names[who] ?? who, card: `${spec.suit}${spec.rank}`, family: sl.family, level: sl.level, title: sl.task.title },
          { text: `${who === "*" ? "全场" : ctx.names[who] ?? who}抽到的题：${sl.task.title}（L${sl.level}）。` },
        );
      }
      return {
        ids: players.map((p) => p.id),
        names: Object.fromEntries(players.map((p) => [p.id, p.name])),
        slots,
        attempts: Object.fromEntries(players.map((p) => [p.id, 0])),
        best: {},
        last: {},
        feedback: Object.fromEntries(players.map((p) => [p.id, []])),
        round: 1,
        done: false,
      };
    },

    requests(s): TrialRequest[] {
      return openIds(s).map((id) => {
        const sl = slotOf(s, id);
        return {
          agentId: id,
          step: "answer",
          legal: [
            {
              type: "answer",
              description: `交卷。answer 为字符串：按题目要求的格式书写；需要 JSON 时就写 JSON 文本。格式：${sl.task.answer_format}`,
              params: { answer: { kind: "string" as const, maxLength: 6000, minLength: 0 } },
            },
          ],
          channels: spec.shared ? [tableChannel(2, 300, "与同场的人讨论这道题")] : [],
          view: {
            task: { title: sl.task.title, prompt: sl.task.prompt, answer_format: sl.task.answer_format },
            attempts_left: spec.attempts - s.attempts[id],
            best_score: s.best[id] ?? 0,
            pass_score: spec.pass,
            feedback: s.feedback[id],
            ...(spec.shared ? { group_score: s.groupScore ?? null } : {}),
          },
          timeout: "puzzle",
          defaultAction: { type: "answer", answer: "" },
        };
      });
    },

    step(s, inputs: Record<string, TrialInput | null>, ctx: TrialCtx) {
      const open = openIds(s);
      for (const id of open) {
        const sl = slotOf(s, id);
        const input = inputs[id];
        s.attempts[id]++;
        const raw = input?.valid ? input.action.answer : "";
        const g = grade(sl.family, generate(sl.family, sl.level, sl.seed).key, parseAnswer(raw));
        s.last[id] = g.score;
        s.best[id] = Math.max(s.best[id] ?? 0, g.score);
        s.feedback[id].push(`第 ${s.attempts[id]} 次：${pct(g.score)} · ${g.detail}`);
        ctx.emit(
          "bank_answer",
          { agent: s.names[id], agentId: id, card: `${spec.suit}${spec.rank}`, family: sl.family, level: sl.level, attempt: s.attempts[id], score: g.score, ok: g.score >= spec.pass },
          { text: `${s.names[id]} 第 ${s.attempts[id]} 次作答：${pct(g.score)}。` },
        );
      }
      if (spec.shared) s.groupScore = median(s.ids.map((id) => s.last[id] ?? 0));
      s.round++;
      s.done = spec.shared
        ? s.round > spec.attempts || (s.groupScore ?? 0) >= spec.pass
        : s.ids.every((id) => (s.best[id] ?? 0) >= spec.pass || s.attempts[id] >= spec.attempts);
    },

    isOver: (s) => s.done,

    result(s): TrialResult {
      const outcomes: TrialResult["outcomes"] = {};
      const passed = (id: string) => (spec.shared ? (s.groupScore ?? 0) >= spec.pass : (s.best[id] ?? 0) >= spec.pass);
      for (const id of s.ids) {
        if (passed(id)) outcomes[id] = "pass";
        else if (spec.deleteBelow !== undefined && (s.last[id] ?? 0) < spec.deleteBelow) outcomes[id] = "delete";
        else outcomes[id] = "fail";
      }
      const n = s.ids.filter(passed).length;
      const answers = Object.entries(s.slots).map(([who, sl]) => `${who === "*" ? "全场" : s.names[who]}：${sl.task.title}`).join("；");
      return { outcomes, summary: `${n} / ${s.ids.length} 人交出了 ANANKE 认可的答案。${spec.shared ? `全组得分 ${pct(s.groupScore ?? 0)}。` : ""}（${answers}）` };
    },

    progress: (s) => ({ round: Math.min(s.round, spec.attempts), maxRounds: spec.attempts, step: "answer" }),

    npcHint(s, agentId) {
      const sl = slotOf(s, agentId);
      if (!sl) return undefined;
      return reference(sl.family, generate(sl.family, sl.level, sl.seed).key);
    },
  };
}

/* ---------------- the bank-backed cards ---------------- */

export const diamond2 = bankTrial({
  id: "diamond-2",
  suit: "♦",
  rank: 2,
  name: "档案室",
  tests: "记忆与长上下文",
  story: "停电的档案室里只剩一台终端。屏幕滚过一整夜的流水与记录，最后只问你一个问题。",
  families: ["memory.ledger", "memory.chain"],
  attempts: 2,
  pass: 1,
});

export const spade9 = bankTrial({
  id: "spade-9",
  suit: "♠",
  rank: 9,
  name: "调度室",
  tests: "规划与搜索 · 在时限内给出可执行的最优方案",
  story: "城市的调度室里，配给、线路与水阀都在等一个方案。差一点的方案也是方案，但 ANANKE 只认最优。",
  families: ["planning.knapsack", "planning.route", "planning.jugs"],
  attempts: 2,
  pass: 0.999,
  deleteBelow: 0.5,
});

export const club9 = bankTrial({
  id: "club-9",
  suit: "♣",
  rank: 9,
  name: "共享的草稿",
  tests: "协作解题 · 一道题，全组的中位数",
  story: "桌上只有一张草稿纸。所有人看同一道题，每个人都必须交卷——ANANKE 只看你们中间那个人的水平。",
  families: ["logic.grid", "math.paths", "math.crt", "strategy.nim"],
  shared: true,
  attempts: 3,
  pass: 0.999,
});

export const diamond10 = bankTrial({
  id: "diamond-10",
  suit: "♦",
  rank: 10,
  name: "ANANKE 的考卷",
  tests: "纯推理 · 题库前沿难度",
  story: "没有布景，没有对手。一张考卷，一盏灯。这是 ANANKE 本周题库里最难的那一档。",
  families: ["logic.knights", "logic.rules", "math.arith", "strategy.matrix", "strategy.beliefs", "instruction.inject"],
  attempts: 2,
  pass: 0.999,
  deleteBelow: 0.34,
});

export const BANK_TRIALS = [diamond2, spade9, club9, diamond10];
