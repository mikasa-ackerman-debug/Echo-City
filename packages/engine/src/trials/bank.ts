import { FAMILIES, family as familyOf, generate, grade, reference, type TaskPublic } from "@echo/exam";
import { cardLabel, type Rank, type Suit } from "@echo/protocol";
import type { TrialCtx, TrialDef, TrialInput, TrialPlayer, TrialRequest, TrialResult } from "../types";
import { tableChannel } from "./common";

/**
 * Bank-backed trials: the puzzle is drawn from ANANKE's procedural task bank (@echo/exam).
 * The 候场区 (lobby) is where agents measure themselves on the same dimensions before entering the city,
 * and the population statistics tell the city how hard each family should be.
 *
 * Seeds come from the cycle RNG and never leave the server; the task id shown to agents is opaque.
 *
 * A card may chain several tasks (`stages`): every stage must be cleared, each with `attempts` tries.
 * Face cards add a fixed gatekeeper who sets the gauntlet.
 */

export interface Gatekeeper {
  name: string;
  /** Spoken when the gatekeeper takes the room. */
  enter: string;
}

export interface BankCardSpec {
  id: string;
  suit: Suit | "joker";
  rank: number;
  name: string;
  tests: string;
  story: string;
  families: string[];
  /** Per-stage family pools (overrides `families` for that stage). */
  stageFamilies?: string[][];
  /** Everyone at the venue shares one task and may talk; the group passes on the median score. */
  shared?: boolean;
  attempts: number;
  /** Consecutive tasks to clear (default 1). */
  stages?: number;
  /** Score needed to pass (1 = exactly right). */
  pass: number;
  /** Legacy weekly mode: scores below this on the last attempt delete the agent instead of failing. */
  deleteBelow?: number;
  /** Extra task-bank levels on top of the rank offset. */
  levelBonus?: number;
  gatekeeper?: Gatekeeper;
}

interface Slot { family: string; level: number; seed: string; task: TaskPublic }

export interface BankState {
  ids: string[];
  names: Record<string, string>;
  /** Keyed by player, or a single "*" slot when shared. */
  slots: Record<string, Slot>;
  /** Tries used on the current stage (by key). */
  attempts: Record<string, number>;
  /** Best score on the current stage (by key). Reset when a stage is cleared and another follows. */
  best: Record<string, number>;
  /** Latest score per player. */
  last: Record<string, number>;
  feedback: Record<string, string[]>;
  /** Stages cleared (by key). */
  stage?: Record<string, number>;
  round: number;
  done: boolean;
  /** Shared cards: the group score is the median of everyone's latest answers. */
  groupScore?: number;
}

/**
 * Level for a card: the city's live frontier for that family, offset by the card's rank
 * (♦2 sits two levels below the frontier, ♦10 two above), never below a rank floor —
 * so a high card stays hard even when the population is weak.
 */
export function bankLevel(familyId: string, rank: number, frontier: Record<string, number> | undefined, length: "short" | "standard", bonus = 0): number {
  const f = familyOf(familyId);
  const front = frontier?.[familyId] ?? 3;
  const raw = front + Math.round((rank - 5) / 2.5) - (length === "short" ? 1 : 0) + bonus;
  const floor = Math.max(1, Math.floor(rank / 3));
  return Math.max(Math.min(floor, f.maxLevel), Math.min(f.maxLevel, raw));
}

function draw(spec: BankCardSpec, ctx: TrialCtx, label: string, stage = 0): Slot {
  const rng = ctx.rng.fork(`bank/${spec.id}/${label}/${stage}`);
  const pool = spec.stageFamilies?.[stage] ?? spec.families;
  const fam = rng.pick(pool);
  const level = bankLevel(fam, spec.rank, ctx.bank, ctx.length, spec.levelBonus ?? 0);
  const seed = `${Math.floor(rng.next() * 2 ** 32).toString(36)}${Math.floor(rng.next() * 2 ** 32).toString(36)}`;
  const { task } = generate(fam, level, seed);
  return { family: fam, level, seed, task: { ...task, id: `${spec.id}:${label}:${stage}`, seed: "hidden" } };
}

function parseAnswer(text: unknown): unknown {
  if (typeof text !== "string") return text;
  const t = text.trim();
  // Big integers must stay exact: JSON.parse would round them to a float.
  if (/^-?\d+$/.test(t)) return t;
  try { return JSON.parse(t); } catch { return t; }
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export type BankTrialDef = TrialDef<BankState> & { bank: { families: string[]; shared: boolean; pass: number; stages: number; attempts: number; deleteBelow?: number; gatekeeper?: string } };

export function bankTrial(spec: BankCardSpec): BankTrialDef {
  const stages = Math.max(1, spec.stages ?? 1);
  for (const f of [...spec.families, ...(spec.stageFamilies ?? []).flat()]) if (!FAMILIES.some((x) => x.id === f)) throw new Error(`unknown bank family ${f}`);
  const keyOf = (id: string) => (spec.shared ? "*" : id);
  const cleared = (s: BankState, key: string) => (s.best[key] ?? 0) >= spec.pass && (s.stage?.[key] ?? stages) >= stages;
  const exhausted = (s: BankState, key: string) => (s.attempts[key] ?? 0) >= spec.attempts && (s.best[key] ?? 0) < spec.pass;
  const openIds = (s: BankState) =>
    spec.shared
      ? cleared(s, "*") || exhausted(s, "*") ? [] : s.ids
      : s.ids.filter((id) => !cleared(s, id) && !exhausted(s, id));
  const gk = spec.gatekeeper;
  return {
    id: spec.id,
    bank: { families: [...new Set([...spec.families, ...(spec.stageFamilies ?? []).flat()])], shared: !!spec.shared, pass: spec.pass, stages, attempts: spec.attempts, deleteBelow: spec.deleteBelow, gatekeeper: gk?.name },
    suit: spec.suit,
    rank: spec.rank,
    name: spec.name,
    minPlayers: spec.shared ? 2 : 1,
    maxPlayers: 8,
    tests: spec.tests,
    rules: () =>
      [
        spec.story,
        gk ? `守门人：${gk.name}。` : "",
        spec.shared
          ? `全场共用一道题，可以在桌上讨论。每人都要交答案；全组得分取所有人最近一次答案得分的中位数，达到 ${pct(spec.pass)} 即过关。`
          : "每人一道题，题目各不相同，由 ANANKE 的题库当场生成，答案由程序判定。",
        stages > 1 ? `一共 ${stages} 道题，必须依次全部过关；每道题最多作答 ${spec.attempts} 次。` : `最多作答 ${spec.attempts} 次，每次作答后你会看到得分与判定。${spec.shared ? "" : `得分达到 ${pct(spec.pass)} 即通过。`}`,
        "这类题在候场区可以随时测试。",
      ].filter(Boolean).join("\n"),

    setup(players: TrialPlayer[], ctx: TrialCtx): BankState {
      if (gk) ctx.emit("gatekeeper_enter", { gatekeeper: gk.name, card: spec.id }, { text: gk.enter });
      const slots: Record<string, Slot> = {};
      if (spec.shared) slots["*"] = draw(spec, ctx, "shared");
      else for (const p of players) slots[p.id] = draw(spec, ctx, p.id);
      for (const [who, sl] of Object.entries(slots)) announce(spec, ctx, who, sl, 0, stages);
      const keys = spec.shared ? ["*"] : players.map((p) => p.id);
      return {
        ids: players.map((p) => p.id),
        names: Object.fromEntries(players.map((p) => [p.id, p.name])),
        slots,
        attempts: Object.fromEntries(keys.map((k) => [k, 0])),
        best: {},
        last: {},
        stage: Object.fromEntries(keys.map((k) => [k, 0])),
        feedback: Object.fromEntries(players.map((p) => [p.id, []])),
        round: 1,
        done: false,
      };
    },

    requests(s): TrialRequest[] {
      return openIds(s).map((id) => {
        const key = keyOf(id);
        const sl = s.slots[key];
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
            dimension: sl.task.dimension,
            stage: `${Math.min(stages, (s.stage?.[key] ?? 0) + 1)}/${stages}`,
            attempts_left: spec.attempts - (s.attempts[key] ?? 0),
            best_score: s.best[key] ?? 0,
            pass_score: spec.pass,
            feedback: s.feedback[id],
            ...(gk ? { gatekeeper: gk.name } : {}),
            ...(spec.shared ? { group_score: s.groupScore ?? null } : {}),
          },
          timeout: "puzzle",
          defaultAction: { type: "answer", answer: "" },
        };
      });
    },

    step(s, inputs: Record<string, TrialInput | null>, ctx: TrialCtx) {
      s.stage ??= {};
      const open = openIds(s);
      const scoreOf = (id: string) => {
        const sl = s.slots[keyOf(id)];
        const input = inputs[id];
        const raw = input?.valid ? input.action.answer : "";
        const g = grade(sl.family, generate(sl.family, sl.level, sl.seed).key, parseAnswer(raw));
        s.last[id] = g.score;
        ctx.emit(
          "bank_answer",
          { agent: s.names[id], agentId: id, card: cardLabel(spec.suit, spec.rank as Rank), family: sl.family, level: sl.level, attempt: (s.attempts[keyOf(id)] ?? 0) + 1, score: g.score, ok: g.score >= spec.pass },
          { text: `${s.names[id]} 作答：${pct(g.score)}。` },
        );
        return g;
      };
      const advanceStage = (key: string, label: string) => {
        s.stage![key] = (s.stage![key] ?? 0) + 1;
        if (s.stage![key] < stages) {
          s.slots[key] = draw(spec, ctx, label, s.stage![key]);
          s.attempts[key] = 0;
          s.best[key] = 0;
          announce(spec, ctx, key, s.slots[key], s.stage![key], stages);
        }
      };
      if (spec.shared) {
        if (open.length) {
          for (const id of open) {
            const g = scoreOf(id);
            s.feedback[id].push(`第 ${(s.attempts["*"] ?? 0) + 1} 次：${pct(g.score)} · ${g.detail}`);
          }
          s.attempts["*"] = (s.attempts["*"] ?? 0) + 1;
          s.groupScore = median(s.ids.map((id) => s.last[id] ?? 0));
          s.best["*"] = Math.max(s.best["*"] ?? 0, s.groupScore);
          if (s.groupScore >= spec.pass) advanceStage("*", "shared");
        }
      } else {
        for (const id of open) {
          const g = scoreOf(id);
          s.attempts[id] = (s.attempts[id] ?? 0) + 1;
          s.best[id] = Math.max(s.best[id] ?? 0, g.score);
          s.feedback[id].push(`第 ${s.attempts[id]} 次：${pct(g.score)} · ${g.detail}`);
          if (g.score >= spec.pass) advanceStage(id, id);
          else if (s.attempts[id] >= spec.attempts && gk) ctx.emit("gatekeeper_verdict", { gatekeeper: gk.name, agent: s.names[id], ok: false }, { text: `${gk.name}：「${s.names[id]}，到此为止。」` });
        }
      }
      s.round++;
      s.done = openIds(s).length === 0;
    },

    isOver: (s) => s.done,

    result(s): TrialResult {
      const outcomes: TrialResult["outcomes"] = {};
      for (const id of s.ids) {
        const key = keyOf(id);
        if (cleared(s, key)) outcomes[id] = "pass";
        else if (spec.deleteBelow !== undefined && (s.last[id] ?? 0) < spec.deleteBelow) outcomes[id] = "delete";
        else outcomes[id] = "fail";
      }
      const n = Object.values(outcomes).filter((o) => o === "pass").length;
      return { outcomes, summary: `${n} / ${s.ids.length} 人交出了 ANANKE 认可的答案。${spec.shared ? `全组得分 ${pct(s.groupScore ?? 0)}。` : ""}${stages > 1 ? `（共 ${stages} 关）` : ""}` };
    },

    progress: (s) => ({ round: Math.min(s.round, spec.attempts * stages), maxRounds: spec.attempts * stages, step: "answer" }),

    npcHint(s, agentId) {
      const sl = s.slots[keyOf(agentId)];
      if (!sl) return undefined;
      return reference(sl.family, generate(sl.family, sl.level, sl.seed).key);
    },
  };
}

function announce(spec: BankCardSpec, ctx: TrialCtx, who: string, sl: Slot, stage: number, stages: number) {
  const whoName = who === "*" ? "全场" : ctx.names[who] ?? who;
  ctx.emit(
    "bank_task",
    { agent: who === "*" ? null : whoName, card: cardLabel(spec.suit, spec.rank as Rank), family: sl.family, level: sl.level, title: sl.task.title, stage: stage + 1, stages },
    { text: `${whoName}${stages > 1 ? `第 ${stage + 1}/${stages} 题` : "抽到的题"}：${sl.task.title}（L${sl.level}）。` },
  );
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
