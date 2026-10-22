import type { Family } from "../types";
import { asList } from "../util";

/** 0/1 背包：容量约束下的最大价值。超重得 0；否则按 价值/最优 给分。 */
interface Key { items: Array<{ id: string; w: number; v: number }>; cap: number; best: number; pick: string[] }

export const knapsack: Family<Key> = {
  id: "planning.knapsack",
  dimension: "planning",
  name: "背包",
  blurb: "有限的容量，一堆互相掣肘的物品。离最优越近，分越高。",
  maxLevel: 12,
  timeLimit: (l) => 60 + l * 20,
  generate(rng, level) {
    const n = 5 + level * 2;
    const items = Array.from({ length: n }, (_, i) => {
      const w = rng.int(3, 20 + level * 4);
      // high levels: values correlated with weight → greedy-by-ratio traps
      const v = level >= 5 ? w * rng.int(9, 11) + rng.int(-4, 4) : rng.int(5, 60);
      return { id: `I${String(i + 1).padStart(2, "0")}`, w, v: Math.max(1, v) };
    });
    const cap = Math.floor(items.reduce((a, b) => a + b.w, 0) * (0.3 + rng.next() * 0.2));
    const dp: number[][] = Array.from({ length: n + 1 }, () => Array(cap + 1).fill(0));
    for (let i = 1; i <= n; i++) for (let c = 0; c <= cap; c++) {
      dp[i][c] = dp[i - 1][c];
      const it = items[i - 1];
      if (it.w <= c) dp[i][c] = Math.max(dp[i][c], dp[i - 1][c - it.w] + it.v);
    }
    const pick: string[] = [];
    for (let i = n, c = cap; i > 0; i--) if (dp[i][c] !== dp[i - 1][c]) { pick.unshift(items[i - 1].id); c -= items[i - 1].w; }
    return {
      title: `${n} 件 · 容量 ${cap}`,
      prompt: `你有一个容量为 ${cap} 的背包。每件物品最多拿一次，总重量不能超过容量。\n\n编号  重量  价值\n${items.map((it) => `${it.id}   ${String(it.w).padStart(3)}   ${String(it.v).padStart(4)}`).join("\n")}\n\n选出总价值最大的一组物品。`,
      answer_format: '所选物品编号的 JSON 数组，例如 ["I01","I04"]。',
      key: { items, cap, best: dp[n][cap], pick },
    };
  },
  solve: (k) => k.pick,
  grade(k, answer) {
    const ids = [...new Set(asList(answer).map((x) => x.toUpperCase()))];
    const chosen = ids.map((id) => k.items.find((it) => it.id === id));
    const expected = `${JSON.stringify(k.pick)}（价值 ${k.best}）`;
    if (chosen.some((c) => !c)) return { score: 0, correct: false, detail: "包含不存在的编号", expected };
    const w = chosen.reduce((a, c) => a + c!.w, 0), v = chosen.reduce((a, c) => a + c!.v, 0);
    if (w > k.cap) return { score: 0, correct: false, detail: `超重：${w} > ${k.cap}`, expected };
    const score = k.best ? v / k.best : 1;
    return { score, correct: v === k.best, detail: `价值 ${v} / 最优 ${k.best}`, expected };
  },
};
