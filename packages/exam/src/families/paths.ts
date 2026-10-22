import type { Family } from "../types";
import { asBigInt, exact } from "../util";

/** 组合计数：带障碍和必经点的网格路径数（只能向右/向下）。答案可能非常大。 */
interface Key { w: number; h: number; blocked: string[]; via: string | null; value: string }

function countPaths(w: number, h: number, blocked: Set<string>, from: [number, number], to: [number, number]): bigint {
  const dp: bigint[][] = Array.from({ length: h }, () => Array(w).fill(0n));
  for (let y = from[1]; y <= to[1]; y++) for (let x = from[0]; x <= to[0]; x++) {
    if (blocked.has(`${x},${y}`)) continue;
    if (x === from[0] && y === from[1]) { dp[y][x] = 1n; continue; }
    dp[y][x] = (x > from[0] ? dp[y][x - 1] : 0n) + (y > from[1] ? dp[y - 1][x] : 0n);
  }
  return dp[to[1]][to[0]];
}

export const paths: Family<Key> = {
  id: "math.paths",
  dimension: "math",
  name: "路径计数",
  blurb: "网格、障碍、必经点。数清楚所有只向右或向下的走法。",
  maxLevel: 12,
  timeLimit: (l) => 60 + l * 20,
  generate(rng, level) {
    const w = 3 + level, h = 3 + Math.ceil(level * 0.8);
    for (let attempt = 0; attempt < 50; attempt++) {
      const nb = Math.floor(w * h * (0.06 + level * 0.008));
      const blocked = new Set<string>();
      while (blocked.size < nb) { const x = rng.int(0, w - 1), y = rng.int(0, h - 1); if ((x || y) && (x !== w - 1 || y !== h - 1)) blocked.add(`${x},${y}`); }
      let via: [number, number] | null = null;
      if (level >= 4) { const x = rng.int(1, w - 2), y = rng.int(1, h - 2); if (!blocked.has(`${x},${y}`)) via = [x, y]; }
      const value = via ? countPaths(w, h, blocked, [0, 0], via) * countPaths(w, h, blocked, via, [w - 1, h - 1]) : countPaths(w, h, blocked, [0, 0], [w - 1, h - 1]);
      if (value === 0n) continue;
      const rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (x === 0 && y === 0 ? "S" : x === w - 1 && y === h - 1 ? "E" : via && via[0] === x && via[1] === y ? "V" : blocked.has(`${x},${y}`) ? "#" : ".")).join(""));
      return {
        title: `${w}×${h} 网格`,
        prompt: `下面是一个 ${w} 列 × ${h} 行的网格。S 是起点（左上），E 是终点（右下），# 是障碍不可经过${via ? "，V 是必须经过的格子" : ""}。每一步只能向右或向下移动一格。\n\n${rows.join("\n")}\n\n从 S 到 E 共有多少条不同的路径？`,
        answer_format: "一个精确的整数。",
        key: { w, h, blocked: [...blocked], via: via ? via.join(",") : null, value: value.toString() },
      };
    }
    throw new Error("paths: generation failed");
  },
  solve: (k) => k.value,
  grade(k, answer) {
    const got = asBigInt(answer);
    return exact(got !== null && got.toString() === k.value, k.value, got === null ? "无法解析为整数" : undefined);
  },
};
