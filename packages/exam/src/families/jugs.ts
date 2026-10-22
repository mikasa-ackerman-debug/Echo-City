import type { Family } from "../types";
import { asJson, unwrap } from "../util";

function toSteps(answer: unknown): string[] {
  const a = asJson(unwrap(answer));
  if (Array.isArray(a)) return a.map(String);
  return String(a ?? "").split(/[\n,，;；]/);
}

/**
 * 量水：几个容量不同的壶，用倒满/倒空/互倒在某个壶里量出目标水量。
 * 提交操作序列，模拟器验证；BFS 求最短步数，按 最短/你的步数 给分。
 */
interface Key { caps: number[]; target: number; best: number; plan: string[] }

type Move = { t: "fill" | "empty"; i: number } | { t: "pour"; i: number; j: number };
function apply(s: number[], m: Move, caps: number[]): number[] {
  const n = [...s];
  if (m.t === "fill") n[m.i] = caps[m.i];
  else if (m.t === "empty") n[m.i] = 0;
  else if (m.t === "pour") { const x = Math.min(n[m.i], caps[m.j] - n[m.j]); n[m.i] -= x; n[m.j] += x; }
  return n;
}
const label = (m: Move) => (m.t === "pour" ? `pour ${"ABCD"[m.i]} ${"ABCD"[m.j]}` : `${m.t} ${"ABCD"[m.i]}`);
function parse(s: string, k: number): Move | null {
  const t = s.trim().toLowerCase().replace(/[()（）]/g, " ").split(/[\s→>-]+/).filter(Boolean);
  const idx = (c?: string) => { const i = "abcd".indexOf((c ?? "").toLowerCase()); return i >= 0 && i < k ? i : -1; };
  const zh: Record<string, string> = { 装满: "fill", 倒满: "fill", 倒空: "empty", 清空: "empty", 倒入: "pour", 倒: "pour" };
  const op = zh[t[0]] ?? t[0];
  if ((op === "fill" || op === "empty") && idx(t[1]) >= 0) return { t: op, i: idx(t[1]) };
  if (op === "pour" && idx(t[1]) >= 0 && idx(t[2]) >= 0 && t[1] !== t[2]) return { t: "pour", i: idx(t[1]), j: idx(t[2]) };
  return null;
}

export const jugs: Family<Key> = {
  id: "planning.jugs",
  dimension: "planning",
  name: "量水",
  blurb: "几只没有刻度的壶。用最少的操作量出目标水量。",
  maxLevel: 10,
  timeLimit: (l) => 60 + l * 20,
  generate(rng, level) {
    const k = level <= 3 ? 2 : level <= 7 ? 3 : 4;
    for (let attempt = 0; attempt < 200; attempt++) {
      const caps = Array.from({ length: k }, () => rng.int(3, Math.min(8 + level * 3, k === 4 ? 17 : 31))).sort((a, b) => b - a);
      if (new Set(caps).size !== k) continue;
      const moves: Move[] = [];
      for (let i = 0; i < k; i++) { moves.push({ t: "fill", i }, { t: "empty", i }); for (let j = 0; j < k; j++) if (i !== j) moves.push({ t: "pour", i, j }); }
      const start = caps.map(() => 0);
      const prev = new Map<string, [string, Move] | null>([[start.join(), null]]);
      const depth = new Map<number, number>();
      const plans = new Map<number, string>();
      let frontier = [start];
      for (let dd = 1; frontier.length && dd < 40; dd++) {
        const next: number[][] = [];
        for (const s of frontier) for (const m of moves) {
          const n = apply(s, m, caps), key = n.join();
          if (prev.has(key)) continue;
          prev.set(key, [s.join(), m]); next.push(n);
          for (const v of new Set(n)) if (!depth.has(v)) { depth.set(v, dd); plans.set(v, key); }
        }
        frontier = next;
      }
      const want = Math.min(4 + Math.floor(level * 1.3), 11);
      const valid = [...depth.entries()].filter(([v]) => v > 0 && !caps.includes(v));
      const maxd = Math.max(0, ...valid.map(([, d]) => d));
      if (maxd < want - 3) continue;
      const cands = valid.filter(([, d]) => d >= Math.min(want, maxd) - 1 && d <= want + 3);
      if (!cands.length) continue;
      const [target, best] = rng.pick(cands);
      const plan: string[] = [];
      for (let key: string | undefined = plans.get(target); key && prev.get(key);) { const [p, m] = prev.get(key)!; plan.unshift(label(m)); key = p; }
      return {
        title: `${k} 只壶 · 目标 ${target}`,
        prompt: `你有 ${k} 只没有刻度的壶：${caps.map((c, i) => `${"ABCD"[i]}（${c} 升）`).join("、")}，初始全空，水源无限。\n可用操作：\n- fill X：把壶 X 装满\n- empty X：把壶 X 倒空\n- pour X Y：把 X 里的水倒进 Y，直到 X 空或 Y 满\n\n目标：让某一只壶里恰好有 ${target} 升水。步数越少越好。`,
        answer_format: '操作的 JSON 数组，例如 ["fill A","pour A B","empty B"]。',
        key: { caps, target, best, plan },
      };
    }
    throw new Error("jugs: generation failed");
  },
  solve: (k) => k.plan,
  grade(k, answer) {
    const steps = toSteps(answer);
    const expected = `${JSON.stringify(k.plan)}（${k.best} 步）`;
    let s = k.caps.map(() => 0), n = 0;
    for (const raw of steps.map((x) => x.trim()).filter(Boolean)) {
      const m = parse(raw, k.caps.length);
      if (!m) return { score: 0, correct: false, detail: `无法识别的操作「${raw}」`, expected };
      s = apply(s, m, k.caps); n++;
      if (s.includes(k.target)) return { score: k.best / n, correct: n === k.best, detail: `${n} 步达成 / 最短 ${k.best}`, expected };
    }
    return { score: 0, correct: false, detail: `未达成目标（最终 ${s.join("/")}）`, expected };
  },
};
