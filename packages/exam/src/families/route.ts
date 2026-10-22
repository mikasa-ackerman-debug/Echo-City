import type { Family } from "../types";
import { asList } from "../util";

/** 巡回路线（TSP）：从仓库出发访问所有站点再回来。Held–Karp 求出最优；按 最优/你的长度 给分。 */
interface Key { names: string[]; d: number[][]; best: number; tour: string[] }

export const route: Family<Key> = {
  id: "planning.route",
  dimension: "planning",
  name: "巡回路线",
  blurb: "访问每一个站点再回到起点。最短的那条路只有一条。",
  maxLevel: 10,
  timeLimit: (l) => 60 + l * 25,
  generate(rng, level) {
    const n = Math.min(4 + level, 13);
    const names = ["仓库", ...Array.from({ length: n - 1 }, (_, i) => `站${String.fromCharCode(65 + i)}`)];
    const pts = names.map(() => [rng.int(0, 99), rng.int(0, 99)]);
    const d = pts.map((p) => pts.map((q) => Math.round(Math.hypot(p[0] - q[0], p[1] - q[1]))));
    // Held–Karp
    const N = 1 << (n - 1);
    const dp = Array.from({ length: N }, () => new Float64Array(n).fill(Infinity));
    const par = Array.from({ length: N }, () => new Int8Array(n).fill(-1));
    for (let j = 1; j < n; j++) dp[1 << (j - 1)][j] = d[0][j];
    for (let m = 1; m < N; m++) for (let j = 1; j < n; j++) {
      if (!(m & (1 << (j - 1))) || dp[m][j] === Infinity) continue;
      for (let k = 1; k < n; k++) {
        if (m & (1 << (k - 1))) continue;
        const nm = m | (1 << (k - 1)), v = dp[m][j] + d[j][k];
        if (v < dp[nm][k]) { dp[nm][k] = v; par[nm][k] = j; }
      }
    }
    let best = Infinity, last = 1;
    for (let j = 1; j < n; j++) if (dp[N - 1][j] + d[j][0] < best) { best = dp[N - 1][j] + d[j][0]; last = j; }
    const tour: number[] = [];
    for (let m = N - 1, j = last; j > 0;) { tour.unshift(j); const p = par[m][j]; m &= ~(1 << (j - 1)); j = p; }
    const table = names.map((a, i) => `${a.padEnd(3, "　")} ${d[i].map((x) => String(x).padStart(4)).join("")}`);
    return {
      title: `${n} 个地点`,
      prompt: `一辆车从「仓库」出发，必须恰好访问每个站点一次，最后回到仓库。下表是任意两点之间的距离（对称）：\n\n${"".padEnd(4, "　")}${names.map((x) => x.slice(-1).padStart(4)).join("")}\n${table.join("\n")}\n\n（列头按顺序对应：${names.join("、")}）\n\n请给出总距离最短的访问顺序。`,
      answer_format: `站点访问顺序的 JSON 数组（不含仓库），例如 ${JSON.stringify(names.slice(1, 4))}…`,
      key: { names, d, best, tour: tour.map((i) => names[i]) },
    };
  },
  solve: (k) => k.tour,
  grade(k, answer) {
    const seq = asList(answer).map((x) => x.trim()).filter((x) => x !== "仓库");
    const idx = seq.map((x) => k.names.findIndex((n) => n === x || n === `站${x.toUpperCase()}` || n.slice(-1) === x.toUpperCase()));
    const expected = `${JSON.stringify(k.tour)}（长度 ${k.best}）`;
    if (idx.some((i) => i <= 0) || new Set(idx).size !== k.names.length - 1 || idx.length !== k.names.length - 1) return { score: 0, correct: false, detail: "路线必须恰好包含每个站点一次", expected };
    let len = k.d[0][idx[0]] + k.d[idx[idx.length - 1]][0];
    for (let i = 0; i + 1 < idx.length; i++) len += k.d[idx[i]][idx[i + 1]];
    return { score: k.best / len, correct: len === k.best, detail: `长度 ${len} / 最优 ${k.best}`, expected };
  },
};
