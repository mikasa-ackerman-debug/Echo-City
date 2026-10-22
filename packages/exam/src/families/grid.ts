import type { Family } from "../types";
import { asJson, clamp } from "../util";

/**
 * 斑马谜题：N 栋房子 × K 类属性。线索逐条加入直到解唯一，再删去冗余线索——
 * 留下的是一组「刚好够用」的线索。答案是整张表，按格子给分。
 */
const ATTRS: Array<{ key: string; label: string; values: string[] }> = [
  { key: "color", label: "颜色", values: ["红", "绿", "白", "黄", "蓝", "黑", "灰"] },
  { key: "job", label: "职业", values: ["医生", "律师", "厨师", "画家", "程序员", "教师", "记者"] },
  { key: "drink", label: "饮品", values: ["茶", "咖啡", "牛奶", "果汁", "水", "可乐", "酒"] },
  { key: "pet", label: "宠物", values: ["猫", "狗", "鸟", "鱼", "马", "兔", "龟"] },
  { key: "city", label: "故乡", values: ["北京", "上海", "广州", "成都", "西安", "杭州", "沈阳"] },
  { key: "car", label: "车", values: ["自行车", "轿车", "摩托", "卡车", "电车", "跑车", "马车"] },
];

type Ref = [number, number]; // [attr, value]
type Clue =
  | { t: "same"; a: Ref; b: Ref }
  | { t: "diff"; a: Ref; b: Ref }
  | { t: "at"; a: Ref; p: number }
  | { t: "notAt"; a: Ref; p: number }
  | { t: "leftOf"; a: Ref; b: Ref }
  | { t: "nextTo"; a: Ref; b: Ref }
  | { t: "before"; a: Ref; b: Ref }
  | { t: "end"; a: Ref };

interface Key { n: number; k: number; table: number[][]; clues: Clue[] }

/** pos[attr][value] = house or -1. Returns false only if the clue is definitely violated. */
function ok(c: Clue, pos: number[][], n: number): boolean {
  const P = (r: Ref) => pos[r[0]][r[1]];
  switch (c.t) {
    case "same": { const x = P(c.a), y = P(c.b); return x < 0 || y < 0 || x === y; }
    case "diff": { const x = P(c.a), y = P(c.b); return x < 0 || y < 0 || x !== y; }
    case "at": { const x = P(c.a); return x < 0 || x === c.p; }
    case "notAt": { const x = P(c.a); return x !== c.p; }
    case "leftOf": { const x = P(c.a), y = P(c.b); if (x >= 0 && x === n - 1) return false; if (y === 0) return false; return x < 0 || y < 0 || x + 1 === y; }
    case "nextTo": { const x = P(c.a), y = P(c.b); return x < 0 || y < 0 || Math.abs(x - y) === 1; }
    case "before": { const x = P(c.a), y = P(c.b); if (x === n - 1 || y === 0) return false; return x < 0 || y < 0 || x < y; }
    case "end": { const x = P(c.a); return x < 0 || x === 0 || x === n - 1; }
  }
}

function perms(n: number): number[][] {
  if (n === 1) return [[0]];
  const out: number[][] = [];
  for (const p of perms(n - 1)) for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
  return out;
}
const PERMS = new Map<number, number[][]>();

/**
 * Count solutions (up to `limit`) by assigning one whole attribute (a permutation) at a time.
 * pos[attr][value] = house. A clue is checked as soon as all its attributes are assigned.
 */
function count(n: number, k: number, clues: Clue[], limit = 2, budget = 150_000): number {
  // Deterministic node budget: an over-budget search is treated as "not unique" (the clue is kept).
  let nodes = 0;
  if (!PERMS.has(n)) PERMS.set(n, perms(n));
  const all = PERMS.get(n)!;
  const attrsOf = (c: Clue) => ("b" in c ? [c.a[0], c.b[0]] : [c.a[0]]);
  // Most-constrained attributes first.
  const weight = Array(k).fill(0);
  for (const c of clues) for (const a of attrsOf(c)) weight[a] += c.t === "at" || c.t === "same" ? 3 : 1;
  const order = [...Array(k).keys()].sort((x, y) => weight[y] - weight[x]);
  const rank = Array(k).fill(0); order.forEach((a, i) => (rank[a] = i));
  const due: Clue[][] = Array.from({ length: k }, () => []);
  for (const c of clues) due[Math.max(...attrsOf(c).map((a) => rank[a]))].push(c);
  // Per-attribute candidate permutations filtered by single-attribute clues up front.
  const pos: number[][] = Array.from({ length: k }, () => Array(n).fill(-1));
  const cand = order.map((attr, i) => all.filter((p) => { pos[attr] = p; return due[i].filter((c) => attrsOf(c).every((a) => a === attr)).every((c) => ok(c, pos, n)); }));
  for (const a of order) pos[a] = Array(n).fill(-1);
  let found = 0;
  const rec = (i: number): void => {
    if (found >= limit) return;
    if (i === k) { found++; return; }
    const attr = order[i];
    for (const p of cand[i]) {
      if (++nodes > budget) { found = limit; break; }
      pos[attr] = p;
      if (due[i].every((c) => ok(c, pos, n))) rec(i + 1);
      if (found >= limit) break;
    }
    pos[attr] = Array(n).fill(-1);
  };
  rec(0);
  // Attribute 0's values are interchangeable only by house order — no symmetry to break.
  return found;
}

function text(c: Clue, n: number): string {
  const R = (r: Ref) => {
    const a = ATTRS[r[0]], v = a.values[r[1]];
    return a.key === "color" ? `${v}房子的主人` : a.key === "job" ? `那位${v}` : a.key === "drink" ? `喝${v}的人` : a.key === "pet" ? `养${v}的人` : a.key === "city" ? `来自${v}的人` : `开${v}的人`;
  };
  switch (c.t) {
    case "same": return `${R(c.a)}就是${R(c.b)}。`;
    case "diff": return `${R(c.a)}不是${R(c.b)}。`;
    case "at": return `${R(c.a)}住在第 ${c.p + 1} 栋。`;
    case "notAt": return `${R(c.a)}不住在第 ${c.p + 1} 栋。`;
    case "leftOf": return `${R(c.a)}住在${R(c.b)}的紧左边。`;
    case "nextTo": return `${R(c.a)}和${R(c.b)}是邻居。`;
    case "before": return `${R(c.a)}住在${R(c.b)}左边的某一栋（不一定相邻）。`;
    case "end": return `${R(c.a)}住在最左或最右的一栋（共 ${n} 栋）。`;
  }
}

export const grid: Family<Key> = {
  id: "logic.grid",
  dimension: "logic",
  name: "斑马谜题",
  blurb: "N 栋房子、K 类属性、一组刚好够用的线索。填出整张表。",
  maxLevel: 10,
  timeLimit: (l) => 90 + l * 30,
  generate(rng, level) {
    const shape: Array<[number, number]> = [[3, 3], [3, 3], [3, 4], [4, 3], [4, 4], [4, 5], [5, 4], [5, 5], [6, 4], [6, 4]];
    const [n, k] = shape[clamp(level, 1, 10) - 1];
    const attrs = rng.sample([...ATTRS.keys()], k).sort((a, b) => a - b);
    const table = Array.from({ length: n }, () => Array(k).fill(0));
    const perm = attrs.map(() => rng.shuffle([...Array(n).keys()]));
    for (let h = 0; h < n; h++) for (let a = 0; a < k; a++) table[h][a] = perm[a][h];
    const where = (r: Ref) => table.findIndex((row) => row[r[0]] === r[1]);
    const ref = (): Ref => [rng.int(0, k - 1), rng.int(0, n - 1)];
    const advanced = level >= 4;
    const make = (): Clue => {
      for (;;) {
        const a = ref(), b = ref();
        const pa = where(a), pb = where(b);
        const roll = rng.next();
        if (roll < 0.32 && a[0] !== b[0] && pa === pb) return { t: "same", a, b };
        if (roll < 0.32) continue;
        if (roll < 0.42) return { t: "at", a, p: pa };
        if (roll < 0.5 && advanced) { const p = rng.int(0, n - 1); if (p !== pa) return { t: "notAt", a, p }; continue; }
        if (roll < 0.62 && pb === pa + 1) return { t: "leftOf", a, b };
        if (roll < 0.72 && Math.abs(pa - pb) === 1) return { t: "nextTo", a, b };
        if (roll < 0.82 && advanced && pa < pb && pb - pa > 1) return { t: "before", a, b };
        if (roll < 0.9 && advanced && a[0] !== b[0] && pa !== pb) return { t: "diff", a, b };
        if (roll >= 0.9 && advanced && (pa === 0 || pa === n - 1)) return { t: "end", a };
      }
    };
    const clues: Clue[] = [];
    for (let guard = 0; guard < 200 && count(n, k, clues) > 1; guard++) clues.push(make());
    if (count(n, k, clues, 2, 2_000_000) !== 1) throw new Error("grid: generation failed");
    // Remove redundant clues (hardest-first: try dropping direct placements first).
    const order = rng.shuffle([...clues.keys()]).sort((x, y) => Number(clues[y].t === "at") - Number(clues[x].t === "at"));
    const keep = new Set(clues.keys());
    for (const i of order) {
      keep.delete(i);
      if (count(n, k, clues.filter((_, j) => keep.has(j))) !== 1) keep.add(i);
    }
    const final = rng.shuffle(clues.filter((_, j) => keep.has(j)));
    const remap: Key = { n, k, table: table.map((row) => row.map((v) => v)), clues: final };
    const attrLabels = attrs.map((a) => ATTRS[a]);
    // Clues use local attribute indices 0..k-1; map to the global ATTRS table for display.
    const local = (r: Ref): Ref => [attrs[r[0]], r[1]];
    const shown = final.map((c) => ("b" in c ? { ...c, a: local(c.a), b: local(c.b) } : { ...c, a: local(c.a) }) as Clue);
    return {
      title: `${n} 栋 × ${k} 类`,
      prompt: `一条街上有 ${n} 栋房子，从左到右编号 1 到 ${n}。每栋住一个人，每个人在下列每一类属性上各有一个不同的取值：\n${attrLabels.map((a) => `- ${a.label}：${a.values.slice(0, n).join("、")}`).join("\n")}\n\n线索：\n${shown.map((c, i) => `${i + 1}. ${text(c, n)}`).join("\n")}\n\n这些线索决定了唯一的一种排列。请给出完整的表。`,
      answer_format: `JSON 数组，长度 ${n}，第 i 项是第 i 栋的属性对象，键为 ${attrLabels.map((a) => `"${a.label}"`).join("、")}。例如 [{${attrLabels.map((a) => `"${a.label}":"${a.values[0]}"`).join(",")}}, …]`,
      key: { ...remap, table: table.map((row) => row.map((v, a) => v + attrs[a] * 100)) },
    };
  },
  solve(k) {
    return k.table.map((row) => Object.fromEntries(row.map((code) => { const a = ATTRS[Math.floor(code / 100)]; return [a.label, a.values[code % 100]]; })));
  },
  grade(k, answer) {
    const want = this.solve(k) as Array<Record<string, string>>;
    const got = asJson(answer);
    const total = k.n * k.k;
    let hit = 0;
    if (Array.isArray(got)) for (let h = 0; h < k.n; h++) {
      const row = got[h];
      if (!row || typeof row !== "object") continue;
      for (const [lab, val] of Object.entries(want[h])) if (String((row as Record<string, unknown>)[lab] ?? "").trim() === val) hit++;
    }
    return { score: hit / total, correct: hit === total, detail: `${hit}/${total} 格正确`, expected: JSON.stringify(want) };
  },
};
