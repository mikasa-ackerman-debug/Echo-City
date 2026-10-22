import type { Family } from "../types";
import { asText, names } from "../util";

/**
 * 多跳联查：一大堆关系事实（上级、同城、借书、更名）散落在噪声里，部分事实会被
 * 后面的「更正」覆盖。问题需要串起 k 跳。
 */
interface Key { answer: string }
const RELS = [
  { id: "boss", say: (a: string, b: string) => `${a}的直属上级是${b}。`, edge: "上级", def: "X 的上级" },
  { id: "mentor", say: (a: string, b: string) => `${a}的导师是${b}。`, edge: "导师", def: "X 的导师" },
  { id: "neighbor", say: (a: string, b: string) => `${a}住在${b}的楼上。`, edge: "楼下", def: "X 住在其楼上的那个人" },
  { id: "lent", say: (a: string, b: string) => `${a}最近把伞借给了${b}。`, edge: "借伞", def: "X 把伞借给的人" },
] as const;
const NOISE = ["今天下了雨。", "城东的面包店换了招牌。", "地铁二号线晚点了七分钟。", "图书馆延长了开放时间。", "有人在广场上弹吉他。", "会议改到了周四。", "打印机又卡纸了。", "停车场新划了车位。"];

export const chain: Family<Key> = {
  id: "memory.chain",
  dimension: "memory",
  name: "多跳联查",
  blurb: "事实散落在长文里，有的被更正过。把 k 跳串起来。",
  maxLevel: 12,
  timeLimit: (l) => 60 + l * 25,
  generate(rng, level) {
    const n = 10 + level * 6;
    const people = names(rng, n);
    const rels = RELS.slice(0, Math.min(RELS.length, 1 + Math.ceil(level / 3)));
    const facts = new Map<string, string>();
    const lines: string[] = [];
    const fact = (r: number, a: string) => `${rels[r].id}:${a}`;
    for (let i = 0; i < n * rels.length * 0.8; i++) {
      const r = rng.int(0, rels.length - 1), a = rng.pick(people), b = rng.pick(people.filter((p) => p !== a));
      if (facts.has(fact(r, a))) {
        if (level < 3) continue;
        facts.set(fact(r, a), b);
        lines.push(`【更正】此前关于${a}的记录有误：${rels[r].say(a, b)}`);
      } else { facts.set(fact(r, a), b); lines.push(rels[r].say(a, b)); }
      if (rng.chance(0.15 + level * 0.03)) lines.push(rng.pick(NOISE));
    }
    const hops = Math.min(2 + Math.floor(level / 2), 8);
    for (let attempt = 0; attempt < 500; attempt++) {
      let cur = rng.pick(people);
      const start = cur, path: number[] = [];
      for (let h = 0; h < hops; h++) {
        const opts = rels.map((_, r) => r).filter((r) => facts.has(fact(r, cur)));
        if (!opts.length) break;
        const r = rng.pick(opts); path.push(r); cur = facts.get(fact(r, cur))!;
      }
      if (path.length !== hops) continue;
      const used = [...new Set(path)].map((r) => `「${rels[r].edge}」= ${rels[r].def}`).join("；");
      return {
        title: `${lines.length} 条记录 · ${hops} 跳`,
        prompt: `以下是一份按时间顺序记录的事实。后面的【更正】会覆盖前面关于同一个人、同一种关系的说法；每个人在每种关系上只有一个当前值。\n\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\n从 ${start} 出发，依次沿着 ${path.map((r) => rels[r].edge).join(" → ")} 走，最后到达的是谁？\n（${used}）`,
        answer_format: "一个人名。",
        key: { answer: cur },
      };
    }
    throw new Error("chain: generation failed");
  },
  solve: (k) => k.answer,
  grade(k, answer) {
    const got = asText(answer);
    const ok = got === k.answer || got.includes(k.answer) && got.length <= k.answer.length + 2;
    return { score: ok ? 1 : 0, correct: ok, detail: ok ? "正确" : `给出 ${got || "（空）"}`, expected: k.answer };
  },
};
