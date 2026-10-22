import type { Family } from "../types";
import { asText } from "../util";

/**
 * 零和矩阵博弈：求博弈的值（行玩家的最优期望收益），以最简分数作答。
 * 低阶有鞍点；高阶需要混合策略（2×n / 3×3 用精确有理数枚举支撑集求解）。
 */
interface Key { m: number[][]; num: string; den: string }

type Q = [bigint, bigint];
const norm = ([a, b]: Q): Q => { if (b < 0n) { a = -a; b = -b; } const g = gcdB(a < 0n ? -a : a, b); return [a / g, b / g]; };
function gcdB(a: bigint, b: bigint): bigint { while (b) [a, b] = [b, a % b]; return a || 1n; }
const sub = (x: Q, y: Q): Q => norm([x[0] * y[1] - y[0] * x[1], x[1] * y[1]]);
const mul = (x: Q, y: Q): Q => norm([x[0] * y[0], x[1] * y[1]]);
const div = (x: Q, y: Q): Q => norm([x[0] * y[1], x[1] * y[0]]);
const cmp = (x: Q, y: Q) => { const d = x[0] * y[1] - y[0] * x[1]; return d < 0n ? -1 : d > 0n ? 1 : 0; };
const q = (n: number): Q => [BigInt(n), 1n];

/** Solve A x = b exactly; null if singular. */
function solve(A: Q[][], b: Q[]): Q[] | null {
  const n = A.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    const p = M.findIndex((r, i) => i >= c && r[c][0] !== 0n);
    if (p < 0) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c && M[r][c][0] !== 0n) { const f = div(M[r][c], M[c][c]); M[r] = M[r].map((v, j) => sub(v, mul(f, M[c][j]))); }
  }
  return M.map((r, i) => div(r[n], r[i]));
}

/** Value of a zero-sum game by support enumeration (small matrices). */
function value(m: number[][]): Q {
  const R = m.length, C = m[0].length;
  const subsets = (n: number) => Array.from({ length: (1 << n) - 1 }, (_, i) => [...Array(n).keys()].filter((j) => ((i + 1) >> j) & 1));
  for (const rs of subsets(R)) for (const cs of subsets(C)) {
    if (rs.length !== cs.length) continue;
    const k = rs.length;
    // Row mix p over rs makes every column in cs pay v; columns mix y over cs makes every row in rs pay v.
    const Ap: Q[][] = [...cs.map((c) => [...rs.map((r) => q(m[r][c])), q(-1)]), [...rs.map(() => q(1)), q(0)]];
    const bp: Q[] = [...cs.map(() => q(0)), q(1)];
    const sp = solve(Ap, bp); if (!sp) continue;
    const Ay: Q[][] = [...rs.map((r) => [...cs.map((c) => q(m[r][c])), q(-1)]), [...cs.map(() => q(1)), q(0)]];
    const sy = solve(Ay, bp); if (!sy) continue;
    const p = sp.slice(0, k), v = sp[k], y = sy.slice(0, k);
    if (p.some((x) => x[0] < 0n) || y.some((x) => x[0] < 0n) || cmp(v, sy[k]) !== 0) continue;
    // best-response checks
    const okCols = [...Array(C).keys()].every((c) => cmp(rs.reduce<Q>((acc, r, i) => norm([acc[0] * p[i][1] + p[i][0] * BigInt(m[r][c]) * acc[1], acc[1] * p[i][1]]), q(0)), v) >= 0);
    const okRows = [...Array(R).keys()].every((r) => cmp(cs.reduce<Q>((acc, c, i) => norm([acc[0] * y[i][1] + y[i][0] * BigInt(m[r][c]) * acc[1], acc[1] * y[i][1]]), q(0)), v) <= 0);
    if (okCols && okRows) return v;
  }
  throw new Error("no equilibrium found");
}

export const matrix: Family<Key> = {
  id: "strategy.matrix",
  dimension: "strategy",
  name: "零和博弈",
  blurb: "一张收益矩阵。算出双方都最优时的博弈值，精确到分数。",
  maxLevel: 10,
  timeLimit: (l) => 60 + l * 25,
  generate(rng, level) {
    const R = level <= 3 ? 2 : 3, C = level <= 2 ? 2 : level <= 6 ? 3 : 4;
    for (let attempt = 0; attempt < 200; attempt++) {
      const span = 4 + level * 2;
      const m = Array.from({ length: R }, () => Array.from({ length: C }, () => rng.int(-span, span)));
      const maximin = Math.max(...m.map((r) => Math.min(...r)));
      const minimax = Math.min(...[...Array(C).keys()].map((c) => Math.max(...m.map((r) => r[c]))));
      const saddle = maximin === minimax;
      if (level >= 3 && saddle) continue;
      if (level <= 1 && !saddle) continue;
      let v: Q;
      try { v = value(m); } catch { continue; }
      if (level >= 5 && v[1] === 1n) continue;
      return {
        title: `${R}×${C} 矩阵`,
        prompt: `两人零和博弈。行玩家选一行，列玩家同时选一列，列玩家付给行玩家对应格子里的数额（负数表示行玩家付钱）。双方都可以使用混合策略。\n\n${"      " + [...Array(C).keys()].map((c) => `列${c + 1}`.padStart(5)).join("")}\n${m.map((r, i) => `行${i + 1}  ${r.map((x) => String(x).padStart(5)).join("")}`).join("\n")}\n\n求这个博弈的值（双方都最优时，行玩家的期望收益）。`,
        answer_format: '最简分数或整数的字符串，例如 "7/3"、"-2"、"0"。',
        key: { m, num: v[0].toString(), den: v[1].toString() },
      };
    }
    throw new Error("matrix: generation failed");
  },
  solve: (k) => (k.den === "1" ? k.num : `${k.num}/${k.den}`),
  grade(k, answer) {
    const s = asText(answer).replace(/\s/g, "");
    const expected = k.den === "1" ? k.num : `${k.num}/${k.den}`;
    const mm = s.match(/^(-?\d+)(?:\/(-?\d+))?$/);
    let ok = false;
    if (mm) { const [a, b] = norm([BigInt(mm[1]), BigInt(mm[2] ?? "1")]); ok = a.toString() === k.num && b.toString() === k.den; }
    else if (/^-?\d*\.\d+$/.test(s)) ok = Math.abs(Number(s) - Number(k.num) / Number(k.den)) < 1e-9 && k.den === "1";
    return { score: ok ? 1 : 0, correct: ok, detail: ok ? "正确" : `给出 ${s || "（空）"}`, expected };
  },
};
