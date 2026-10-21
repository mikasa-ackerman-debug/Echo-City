import type { Rng } from "../rng";
import type { TrialCtx, TrialDef, TrialInput, TrialPlayer, TrialRequest, TrialResult } from "../types";

/** ♦3「坏掉的电梯」：knights and knaves, generated from the seed with a unique solution. */

type Role = "knight" | "knave";
type Stmt =
  | { k: "is"; who: number; role: Role }
  | { k: "same"; a: number; b: number }
  | { k: "diff"; a: number; b: number }
  | { k: "atLeastOneKnave" }
  | { k: "exactlyKnights"; n: number };

export interface Puzzle {
  names: string[];
  statements: Array<{ speaker: number; stmt: Stmt; text: string }>;
  solution: Role[];
}

const CHARACTERS = ["维修工", "保安", "护士", "邮差", "厨师", "老师"];

function evalStmt(st: Stmt, roles: Role[]): boolean {
  switch (st.k) {
    case "is":
      return roles[st.who] === st.role;
    case "same":
      return roles[st.a] === roles[st.b];
    case "diff":
      return roles[st.a] !== roles[st.b];
    case "atLeastOneKnave":
      return roles.includes("knave");
    case "exactlyKnights":
      return roles.filter((r) => r === "knight").length === st.n;
  }
}

function stmtText(st: Stmt, names: string[]): string {
  const roleName = (r: Role) => (r === "knight" ? "说真话的人" : "说假话的人");
  switch (st.k) {
    case "is":
      return `${names[st.who]}是${roleName(st.role)}。`;
    case "same":
      return `${names[st.a]}和${names[st.b]}是同一种人。`;
    case "diff":
      return `${names[st.a]}和${names[st.b]}不是同一种人。`;
    case "atLeastOneKnave":
      return "我们之中至少有一个人说假话。";
    case "exactlyKnights":
      return `我们之中恰好有 ${st.n} 个人说真话。`;
  }
}

function allAssignments(n: number): Role[][] {
  const out: Role[][] = [];
  for (let m = 0; m < 1 << n; m++) out.push(Array.from({ length: n }, (_, i) => ((m >> i) & 1 ? "knave" : "knight")));
  return out;
}

function consistent(roles: Role[], statements: Puzzle["statements"]): boolean {
  return statements.every(({ speaker, stmt }) => evalStmt(stmt, roles) === (roles[speaker] === "knight"));
}

export function generatePuzzle(rng: Rng, n = 3): Puzzle {
  const names = rng.shuffle(CHARACTERS).slice(0, n);
  for (let attempt = 0; attempt < 500; attempt++) {
    const statements: Puzzle["statements"] = [];
    for (let speaker = 0; speaker < n; speaker++) {
      const others = Array.from({ length: n }, (_, i) => i).filter((i) => i !== speaker);
      const kind = rng.pick(["is", "is", "same", "diff", "atLeastOneKnave", "exactlyKnights"] as const);
      let stmt: Stmt;
      if (kind === "is") stmt = { k: "is", who: rng.pick(others), role: rng.pick(["knight", "knave"] as const) };
      else if (kind === "same" || kind === "diff") {
        const [a, b] = rng.shuffle(Array.from({ length: n }, (_, i) => i)).slice(0, 2);
        stmt = { k: kind, a, b };
      } else if (kind === "atLeastOneKnave") stmt = { k: "atLeastOneKnave" };
      else stmt = { k: "exactlyKnights", n: rng.int(0, n) };
      statements.push({ speaker, stmt, text: stmtText(stmt, names) });
    }
    const sols = allAssignments(n).filter((r) => consistent(r, statements));
    if (sols.length === 1) return { names, statements, solution: sols[0] };
  }
  // Fallback guaranteed-unique puzzle.
  const statements: Puzzle["statements"] = [
    { speaker: 0, stmt: { k: "is", who: 1, role: "knave" }, text: "" },
    { speaker: 1, stmt: { k: "same", a: 0, b: 2 }, text: "" },
    { speaker: 2, stmt: { k: "exactlyKnights", n: 1 }, text: "" },
  ].map((s) => ({ ...s, stmt: s.stmt as Stmt, text: stmtText(s.stmt as Stmt, names) }));
  const sols = allAssignments(3).filter((r) => consistent(r, statements));
  return { names, statements, solution: sols[0] };
}

export function solvePuzzle(p: Puzzle): Role[][] {
  return allAssignments(p.names.length).filter((r) => consistent(r, p.statements));
}

export interface ElevatorState {
  ids: string[];
  names: Record<string, string>;
  puzzles: Record<string, Puzzle>;
  attempts: Record<string, number>;
  solved: Record<string, boolean>;
  feedback: Record<string, string[]>;
  maxAttempts: number;
  round: number;
  done: boolean;
}

export const diamond3: TrialDef<ElevatorState> = {
  id: "diamond-3",
  suit: "♦",
  rank: 3,
  name: "坏掉的电梯",
  minPlayers: 1,
  maxPlayers: 8,
  tests: "纯逻辑推理",
  rules: () =>
    [
      "电梯停在半空。控制面板上有一道逻辑题：有几个人，每个人要么永远说真话，要么永远说假话。",
      "每个人各自独立作答，题目各不相同。最多 3 次作答，每次作答后你会知道对错。",
      "通关条件：3 次内答对。失败：Uptime −2。",
    ].join("\n"),

  setup(players: TrialPlayer[], ctx: TrialCtx): ElevatorState {
    const puzzles: Record<string, Puzzle> = {};
    for (const p of players) puzzles[p.id] = generatePuzzle(ctx.rng.fork(`elevator/${p.id}`), ctx.length === "short" ? 3 : ctx.rng.pick([3, 4]));
    return {
      ids: players.map((p) => p.id),
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      puzzles,
      attempts: Object.fromEntries(players.map((p) => [p.id, 0])),
      solved: {},
      feedback: Object.fromEntries(players.map((p) => [p.id, []])),
      maxAttempts: 3,
      round: 1,
      done: false,
    };
  },

  requests(s): TrialRequest[] {
    return s.ids
      .filter((id) => !s.solved[id] && s.attempts[id] < s.maxAttempts)
      .map((id) => {
        const p = s.puzzles[id];
        return {
          agentId: id,
          step: "answer",
          legal: [
            {
              type: "answer",
              description: "为每个人给出判断：knight = 说真话的人，knave = 说假话的人",
              params: Object.fromEntries(p.names.map((n) => [n, { kind: "enum" as const, values: ["knight", "knave"] }])),
            },
          ],
          channels: [],
          view: {
            people: p.names,
            statements: p.statements.map((st) => `${p.names[st.speaker]}说：「${st.text}」`),
            attempts_left: s.maxAttempts - s.attempts[id],
            feedback: s.feedback[id],
          },
          timeout: "trial",
          defaultAction: { type: "answer", ...Object.fromEntries(p.names.map((n) => [n, "knight"])) },
        };
      });
  },

  step(s, inputs: Record<string, TrialInput | null>, ctx: TrialCtx) {
    for (const id of s.ids) {
      if (s.solved[id] || s.attempts[id] >= s.maxAttempts) continue;
      const p = s.puzzles[id];
      const input = inputs[id];
      s.attempts[id]++;
      const guess = p.names.map((n) => (input?.valid ? input.action[n] : null));
      const ok = guess.every((g, i) => g === p.solution[i]);
      if (ok) s.solved[id] = true;
      s.feedback[id].push(`第 ${s.attempts[id]} 次作答：${ok ? "正确" : "错误"}（${p.names.map((n, i) => `${n}=${guess[i] ?? "?"}`).join("，")}）`);
      ctx.emit("elevator_answer", { agent: s.names[id], attempt: s.attempts[id], ok }, { text: `${s.names[id]} 第 ${s.attempts[id]} 次作答：${ok ? "电梯恢复运行。" : "面板闪烁红灯。"}` });
    }
    s.round++;
    s.done = s.ids.every((id) => s.solved[id] || s.attempts[id] >= s.maxAttempts);
  },

  isOver: (s) => s.done,

  result(s): TrialResult {
    const outcomes: TrialResult["outcomes"] = {};
    for (const id of s.ids) outcomes[id] = s.solved[id] ? "pass" : "fail";
    const n = s.ids.filter((id) => s.solved[id]).length;
    return { outcomes, summary: `${n} / ${s.ids.length} 人离开了电梯。` };
  },

  progress: (s) => ({ round: Math.min(s.round, s.maxAttempts), maxRounds: s.maxAttempts, step: "answer" }),
};
