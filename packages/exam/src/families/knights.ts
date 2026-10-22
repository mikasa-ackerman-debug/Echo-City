import type { Family } from "../types";
import { exact, LETTERS, asList } from "../util";

/**
 * 骑士与无赖：骑士只说真话，无赖只说假话。每个人发表一个关于他人的陈述。
 * 生成器保证在 2^n 种身份组合里恰好只有一种自洽。
 */
type Stmt =
  | { t: "is"; who: number; knight: boolean }
  | { t: "same"; a: number; b: number }
  | { t: "count"; k: number; scope: number[] }
  | { t: "imp"; a: number; b: number; bKnight: boolean }
  | { t: "or"; a: number; b: number }
  | { t: "atleast"; k: number };

interface Key { n: number; names: string[]; stmts: Stmt[]; truth: boolean[] }

function holds(s: Stmt, w: boolean[]): boolean {
  switch (s.t) {
    case "is": return w[s.who] === s.knight;
    case "same": return w[s.a] === w[s.b];
    case "count": return s.scope.filter((i) => w[i]).length === s.k;
    case "imp": return !w[s.a] || w[s.b] === s.bKnight;
    case "or": return w[s.a] || w[s.b];
    case "atleast": return w.filter(Boolean).length >= s.k;
  }
}

function say(s: Stmt, names: string[], self: number): string {
  const nm = (i: number) => (i === self ? "我" : names[i]);
  const kind = (b: boolean) => (b ? "骑士" : "无赖");
  switch (s.t) {
    case "is": return `${nm(s.who)}是${kind(s.knight)}。`;
    case "same": return `${nm(s.a)}和${nm(s.b)}是同一类人。`;
    case "count": return `${s.scope.map(nm).join("、")}之中，恰好有 ${s.k} 个骑士。`;
    case "imp": return `如果${nm(s.a)}是骑士，那么${nm(s.b)}是${kind(s.bKnight)}。`;
    case "or": return `${nm(s.a)}和${nm(s.b)}中至少有一个是骑士。`;
    case "atleast": return `这座岛上至少有 ${s.k} 个骑士。`;
  }
}

function solutions(n: number, stmts: Stmt[], limit = 2): boolean[][] {
  const out: boolean[][] = [];
  for (let m = 0; m < 1 << n; m++) {
    const w = Array.from({ length: n }, (_, i) => ((m >> i) & 1) === 1);
    if (stmts.every((s, i) => holds(s, w) === w[i])) {
      out.push(w);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export const knights: Family<Key> = {
  id: "logic.knights",
  dimension: "logic",
  name: "骑士与无赖",
  blurb: "骑士只说真话，无赖只说假话。从一圈互相指认里找出唯一自洽的世界。",
  maxLevel: 10,
  timeLimit: (l) => 60 + l * 15,
  generate(rng, level) {
    const n = Math.min(3 + Math.floor(level * 0.75), 11);
    const pool = [...LETTERS.slice(0, n)].map((c) => `居民 ${c}`);
    for (let attempt = 0; attempt < 400; attempt++) {
      const truth = Array.from({ length: n }, () => rng.chance(0.5));
      const kinds: Stmt["t"][] = level <= 2 ? ["is", "same"] : level <= 5 ? ["is", "same", "count", "imp"] : ["same", "count", "imp", "or", "atleast"];
      const stmts: Stmt[] = [];
      const draw = (i: number): Stmt => {
        const all = [...Array(n).keys()];
        const others = all.filter((j) => j !== i);
        const t = rng.pick(kinds);
        if (t === "is") return { t, who: rng.pick(others), knight: rng.chance(0.5) };
        if (t === "same") { const [a, b] = rng.sample(level >= 4 ? all : others, 2); return { t, a, b }; }
        if (t === "count") { const scope = rng.sample(all, rng.int(2, Math.min(5, n))).sort((a, b) => a - b); return { t, scope, k: rng.int(0, scope.length) }; }
        if (t === "imp") { const [a, b] = rng.sample(all, 2); return { t, a, b, bKnight: rng.chance(0.5) }; }
        if (t === "or") { const [a, b] = rng.sample(others, 2); return { t, a, b }; }
        return { t: "atleast", k: rng.int(1, n) };
      };
      // Each speaker's statement must be true iff the speaker is a knight under the hidden truth.
      for (let i = 0; i < n; i++) {
        let s = draw(i);
        for (let g = 0; g < 50 && holds(s, truth) !== truth[i]; g++) s = draw(i);
        stmts.push(s);
      }
      if (!stmts.every((s, i) => holds(s, truth) === truth[i])) continue;
      const sols = solutions(n, stmts);
      if (sols.length !== 1) continue;
      const lines = stmts.map((s, i) => `${pool[i]}：「${say(s, pool, i)}」`);
      return {
        title: `${n} 位居民`,
        prompt: `岛上住着两类人：骑士永远说真话，无赖永远说假话。每个人都是二者之一。你遇到了 ${n} 位居民，他们各说了一句话：\n\n${lines.join("\n")}\n\n已知只有一种身份分配能让所有陈述自洽。请找出所有骑士。`,
        answer_format: '骑士的字母列表（JSON 数组），例如 ["A","C"]；没有骑士则为 []。',
        key: { n, names: pool, stmts, truth },
      };
    }
    throw new Error("knights: generation failed");
  },
  solve: (k) => k.truth.map((t, i) => (t ? LETTERS[i] : null)).filter(Boolean),
  grade(k, answer) {
    const want = k.truth.map((t, i) => (t ? LETTERS[i] : "")).filter(Boolean);
    const got = [...new Set(asList(answer).map((x) => x.replace(/^居民\s*/, "").toUpperCase()))].sort();
    const ok = got.join() === [...want].sort().join();
    return exact(ok, JSON.stringify(want), ok ? "正确" : `给出 ${JSON.stringify(got)}`);
  },
};
