import type { Family } from "../types";
import { asText } from "../util";

/**
 * 规则归纳：一个字符串变换由若干基本操作串联而成。给出若干 输入→输出 例子，
 * 要求对新输入作答。生成器枚举所有不超过同样深度的组合，确认所有与例子一致的
 * 程序在新输入上给出同一个答案——答案因此唯一。
 */
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
type Op = { id: string; f: (s: string) => string };
const OPS: Op[] = [ // keep in sync with OPS_TEXT
  { id: "rev", f: (s) => [...s].reverse().join("") },
  ...[1, 2, 3].map((k) => ({ id: `rotl${k}`, f: (s: string) => s.slice(k % s.length) + s.slice(0, k % s.length) })),
  ...[1, 2, 3, 5].map((k) => ({ id: `shift${k}`, f: (s: string) => [...s].map((c) => ALPHA[(ALPHA.indexOf(c) + k) % 26]).join("") })),
  { id: "swap", f: (s) => { const a = [...s]; for (let i = 0; i + 1 < a.length; i += 2) [a[i], a[i + 1]] = [a[i + 1], a[i]]; return a.join(""); } },
  { id: "evensFirst", f: (s) => [...s].filter((_, i) => i % 2 === 0).join("") + [...s].filter((_, i) => i % 2 === 1).join("") },
  { id: "mirrorHalf", f: (s) => { const h = Math.floor(s.length / 2); return [...s.slice(0, h)].reverse().join("") + s.slice(h); } },
  { id: "atbash", f: (s) => [...s].map((c) => ALPHA[25 - ALPHA.indexOf(c)]).join("") },
];
const OPS_TEXT = [
  "反转：整串倒序。",
  "左移 k（k = 1、2、3）：循环左移 k 位，如 ABCDE 左移 2 → CDEAB。",
  "位移 k（k = 1、2、3、5）：每个字母在字母表中后移 k 位，Z 之后回到 A。",
  "两两交换：第 1、2 位互换，第 3、4 位互换……（奇数长度时最后一位不动）。",
  "奇偶重排：先依次取第 1、3、5…位，再依次取第 2、4、6…位。",
  "半反转：把前 ⌊长度/2⌋ 位倒序，其余不动。",
  "镜像替换：A↔Z、B↔Y、C↔X……",
];
const run = (prog: number[], s: string) => prog.reduce((x, i) => OPS[i].f(x), s);

function* programs(depth: number): Generator<number[]> {
  if (depth === 0) { yield []; return; }
  for (const p of programs(depth - 1)) { yield p; if (p.length === depth - 1) for (let i = 0; i < OPS.length; i++) yield [...p, i]; }
}
function allUpTo(depth: number): number[][] {
  const seen = new Set<string>(), out: number[][] = [];
  for (const p of programs(depth)) { const k = p.join(","); if (!seen.has(k)) { seen.add(k); out.push(p); } }
  return out;
}

interface Key { prog: number[]; query: string; answer: string }

export const rules: Family<Key> = {
  id: "logic.rules",
  dimension: "logic",
  name: "规则归纳",
  blurb: "几组输入输出，背后是一串叠加的变换。归纳它，然后作答。",
  maxLevel: 10,
  timeLimit: (l) => 60 + l * 20,
  generate(rng, level) {
    const depth = level <= 2 ? 1 : level <= 5 ? 2 : 3;
    const len = 5 + Math.min(level, 7);
    const word = () => Array.from({ length: len + rng.int(-1, 1) }, () => rng.pick([...ALPHA])).join("");
    const space = allUpTo(depth);
    for (let attempt = 0; attempt < 60; attempt++) {
      const prog = Array.from({ length: depth }, () => rng.int(0, OPS.length - 1));
      const query = word();
      const answer = run(prog, query);
      const examples: Array<[string, string]> = [];
      // Fewer examples at high levels: the examinee has to squeeze more out of each.
      const maxEx = level <= 3 ? 6 : level <= 7 ? 5 : 4;
      const minEx = 3;
      let alive = space;
      while (examples.length < maxEx) {
        const w = word();
        const out = run(prog, w);
        examples.push([w, out]);
        alive = alive.filter((p) => run(p, w) === out);
        if (examples.length >= minEx && alive.every((p) => run(p, query) === answer)) break;
      }
      if (!alive.every((p) => run(p, query) === answer)) continue;
      if (run(prog, query) === query) continue;
      return {
        title: `${examples.length} 个例子 · 深度 ${depth}`,
        prompt: `一个程序把大写字母串变换成另一个字母串。它由 1 到 ${depth} 个基本变换按固定顺序依次作用而成（同一种变换可以重复使用）。可用的基本变换只有这些：\n${OPS_TEXT.map((t) => `- ${t}`).join("\n")}\n\n下面是这个程序的行为：\n\n${examples.map(([a, b]) => `${a} → ${b}`).join("\n")}\n\n请给出：${query} → ?`,
        answer_format: "输出的字母串（只含大写字母）。",
        key: { prog, query, answer },
      };
    }
    throw new Error("rules: generation failed");
  },
  solve: (k) => k.answer,
  grade(k, answer) {
    const got = asText(answer).toUpperCase().replace(/[^A-Z]/g, "");
    const ok = got === k.answer;
    return { score: ok ? 1 : 0, correct: ok, detail: ok ? "正确" : `给出 ${got || "（空）"}`, expected: k.answer };
  },
};
