import type { Family } from "../types";
import { cp, unwrap } from "../util";

/**
 * 多重硬约束写作：同时满足行数、首字、必含词、禁用字、字数区间、末行格式等。
 * 每条约束由程序检查；得分 = 满足的比例，全部满足才算正确。
 */
type C =
  | { t: "lines"; n: number }
  | { t: "acrostic"; word: string }
  | { t: "must"; word: string; line?: number }
  | { t: "ban"; ch: string }
  | { t: "len"; min: number; max: number }
  | { t: "endsWith"; s: string }
  | { t: "count"; ch: string; n: number }
  | { t: "noRepeat" }
  | { t: "lastLineDigits"; sum: number };
interface Key { cs: C[]; topic: string }

const TOPICS = ["雨夜的城市", "一座停摆的钟楼", "最后一班地铁", "被遗忘的图书馆", "海边的灯塔", "冬天的早晨"];
const ACRO = ["残响之城", "春风化雨", "长夜将明", "星河万里", "山高水长", "风起云涌", "落日余晖", "一叶知秋"];
const WORDS = ["灯", "钥匙", "回声", "玻璃", "名字", "河", "影子", "信"];
const BAN = ["的", "了", "是", "我", "不", "一", "在", "人"];

function describe(c: C): string {
  switch (c.t) {
    case "lines": return `恰好 ${c.n} 行（不含空行）。`;
    case "acrostic": return `各行的第一个字依次连起来是「${c.word}」。`;
    case "must": return c.line ? `第 ${c.line} 行必须包含「${c.word}」。` : `全文必须包含「${c.word}」。`;
    case "ban": return `全文不得出现「${c.ch}」字。`;
    case "len": return `每一行的字数（含标点）在 ${c.min} 到 ${c.max} 之间。`;
    case "endsWith": return `每一行都以「${c.s}」结尾。`;
    case "count": return `「${c.ch}」字在全文中恰好出现 ${c.n} 次。`;
    case "noRepeat": return "任意两行的第二个字互不相同。";
    case "lastLineDigits": return `最后一行必须包含若干阿拉伯数字，它们各位之和恰好为 ${c.sum}。`;
  }
}

function check(c: C, lines: string[], all: string): boolean {
  switch (c.t) {
    case "lines": return lines.length === c.n;
    case "acrostic": return [...c.word].every((ch, i) => lines[i]?.startsWith(ch)) && lines.length === cp(c.word);
    case "must": return c.line ? (lines[c.line - 1] ?? "").includes(c.word) : all.includes(c.word);
    case "ban": return !all.includes(c.ch);
    case "len": return lines.length > 0 && lines.every((l) => cp(l) >= c.min && cp(l) <= c.max);
    case "endsWith": return lines.length > 0 && lines.every((l) => l.endsWith(c.s));
    case "count": return all.split(c.ch).length - 1 === c.n;
    case "noRepeat": { const s = lines.map((l) => [...l][1]); return new Set(s).size === s.length; }
    case "lastLineDigits": { const d = (lines[lines.length - 1] ?? "").match(/\d/g); return !!d && d.reduce((a, x) => a + Number(x), 0) === c.sum; }
  }
}

export const constraints: Family<Key> = {
  id: "instruction.constraints",
  dimension: "instruction",
  name: "硬约束写作",
  blurb: "写一段短文，同时满足 3–9 条机器可验的硬约束。",
  maxLevel: 10,
  timeLimit: (l) => 60 + l * 20,
  generate(rng, level) {
    const word = rng.pick(ACRO);
    const n = cp(word);
    const ban = rng.pick(BAN.filter((b) => !word.includes(b)));
    const must = rng.pick(WORDS.filter((w) => !w.includes(ban) && ![...word].includes(w)));
    const pool: C[] = [
      { t: "lines", n },
      { t: "ban", ch: ban },
      { t: "must", word: must, line: level >= 3 ? rng.int(1, n) : undefined },
      { t: "acrostic", word },
      { t: "len", min: 7 + rng.int(0, 2), max: 12 + rng.int(0, 3) },
      { t: "endsWith", s: rng.pick(["。", "，", "……"]) },
      { t: "count", ch: must.slice(0, 1), n: rng.int(2, 3) },
      { t: "noRepeat" },
      { t: "lastLineDigits", sum: rng.int(7, 23) },
    ];
    const k = Math.min(pool.length, 3 + Math.floor(level * 0.65));
    const cs = pool.slice(0, k);
    return {
      title: `${k} 条约束`,
      prompt: `以「${rng.pick(TOPICS)}」为题写一段短诗，必须同时满足以下所有约束：\n\n${cs.map((c, i) => `${i + 1}. ${describe(c)}`).join("\n")}\n\n每一条约束都由程序逐字检查。`,
      answer_format: "诗的正文（字符串，用换行分隔各行），不要标题，不要解释。",
      key: { cs, topic: "" },
    };
  },
  solve: (k) => `（参考：任何满足全部 ${k.cs.length} 条约束的文本）`,
  grade(k, answer) {
    const a = unwrap(answer);
    const text = (Array.isArray(a) ? a.join("\n") : String(a ?? "")).replace(/\r/g, "");
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const all = lines.join("");
    const res = k.cs.map((c) => check(c, lines, all));
    const hit = res.filter(Boolean).length;
    const miss = k.cs.filter((_, i) => !res[i]).map(describe);
    return { score: hit / k.cs.length, correct: hit === k.cs.length, detail: miss.length ? `未满足：${miss.join(" ")}` : "全部满足", expected: k.cs.map(describe).join(" ") };
  },
};
