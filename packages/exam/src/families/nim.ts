import type { Family } from "../types";
import { asJson, asList, unwrap } from "../util";

/**
 * 取子博弈：若干堆石子，每次从一堆里取走「允许集合」中的某个数量，取走最后一颗者胜。
 * 用 Sprague–Grundy 求解；给出一步必胜着法（让对手处于必败态）。生成器只出先手必胜的局面。
 */
interface Key { piles: number[]; allowed: number[]; winning: Array<[number, number]> }

function grundy(max: number, allowed: number[]): number[] {
  const g = Array(max + 1).fill(0);
  for (let n = 1; n <= max; n++) {
    const s = new Set(allowed.filter((a) => a <= n).map((a) => g[n - a]));
    let m = 0; while (s.has(m)) m++;
    g[n] = m;
  }
  return g;
}

export const nim: Family<Key> = {
  id: "strategy.nim",
  dimension: "strategy",
  name: "取子博弈",
  blurb: "几堆石子、受限的取法。找到让对手必败的那一步。",
  maxLevel: 10,
  timeLimit: (l) => 60 + l * 15,
  generate(rng, level) {
    const k = 2 + Math.min(4, Math.floor(level / 2));
    const maxPile = 6 + level * 5;
    for (let attempt = 0; attempt < 300; attempt++) {
      const allowed = level <= 2 ? [1, 2, 3] : [...new Set([1, ...rng.sample([2, 3, 4, 5, 6, 7, 8], rng.int(1, 2 + Math.floor(level / 3)))])].sort((a, b) => a - b);
      const g = grundy(maxPile, allowed);
      const piles = Array.from({ length: k }, () => rng.int(3, maxPile));
      const x = piles.reduce((a, p) => a ^ g[p], 0);
      if (x === 0) continue;
      const winning: Array<[number, number]> = [];
      piles.forEach((p, i) => allowed.forEach((a) => { if (a <= p && (x ^ g[p] ^ g[p - a]) === 0) winning.push([i + 1, a]); }));
      // Hard levels: only accept positions with a single winning move.
      if (level >= 6 && winning.length !== 1) continue;
      if (!winning.length) continue;
      return {
        title: `${k} 堆 · 取法 {${allowed.join(",")}}`,
        prompt: `桌上有 ${k} 堆石子：${piles.map((p, i) => `第 ${i + 1} 堆 ${p} 颗`).join("，")}。\n两人轮流行动，每次选一堆，从中取走 ${allowed.join(" 或 ")} 颗（不能超过该堆剩余数量）。无法行动的一方输（即取走最后一颗的人赢）。\n\n现在轮到你。请给出一步能保证你最终获胜的着法。`,
        answer_format: '{"pile": 堆的编号(从1开始), "take": 取走的数量}',
        key: { piles, allowed, winning },
      };
    }
    throw new Error("nim: generation failed");
  },
  solve: (k) => ({ pile: k.winning[0][0], take: k.winning[0][1] }),
  grade(k, answer) {
    const a = asJson(unwrap(answer));
    let pile: number, take: number;
    if (a && typeof a === "object" && !Array.isArray(a)) { pile = Number((a as Record<string, unknown>).pile); take = Number((a as Record<string, unknown>).take); }
    else { const l = asList(a).map(Number); [pile, take] = [l[0], l[1]]; }
    const ok = k.winning.some(([p, t]) => p === pile && t === take);
    return { score: ok ? 1 : 0, correct: ok, detail: ok ? "必胜着法" : `第 ${pile} 堆取 ${take} 不是必胜着法`, expected: k.winning.map(([p, t]) => `第${p}堆取${t}`).join(" 或 ") };
  },
};
