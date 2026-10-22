import type { Family } from "../types";
import { asText, names } from "../util";

/**
 * 嵌套信念：几个人在房间进出，物品被挪来挪去，有人偷看、有人被告知（告知可能是假的）。
 * 问「A 认为 B 认为 C 认为物品在哪」。用显式的信念模型模拟求解。
 */
interface Key { answer: string }
const BOXES = ["红盒子", "蓝抽屉", "书架", "花瓶", "保险柜", "床底", "鞋柜"];

export const beliefs: Family<Key> = {
  id: "strategy.beliefs",
  dimension: "strategy",
  name: "嵌套信念",
  blurb: "谁在场、谁偷看、谁撒谎。推出「A 以为 B 以为」的那一层。",
  maxLevel: 10,
  timeLimit: (l) => 60 + l * 20,
  generate(rng, level) {
    const n = Math.min(3 + Math.floor(level / 3), 6);
    const ppl = names(rng, n);
    const boxes = rng.sample(BOXES, 3 + Math.min(3, Math.floor(level / 3)));
    const depth = Math.min(1 + Math.floor((level + 1) / 3), 4);
    // belief[path] where path = chain of names "A>B>C" : where the innermost thinks the item is.
    // We track for every ordered chain up to `depth` (repetition allowed only non-adjacent).
    const present = new Set(ppl);
    const chains: string[][] = [];
    const build = (pre: string[]) => { if (pre.length) chains.push(pre); if (pre.length === depth) return; for (const p of ppl) if (p !== pre[pre.length - 1]) build([...pre, p]); };
    build([]);
    let loc = rng.pick(boxes);
    const bel = new Map(chains.map((c) => [c.join(">"), loc]));
    const events: string[] = [`${ppl.join("、")}都在房间里。一枚戒指放在${loc}里，所有人都看见了。`];
    // A chain's belief updates on an event if every member of the chain observed it
    // (and each knows the previous ones observed it — public-in-room semantics).
    const steps = 3 + level;
    for (let s = 0; s < steps; s++) {
      const r = rng.next();
      const inside = ppl.filter((p) => present.has(p));
      const outside = ppl.filter((p) => !present.has(p));
      if (r < 0.3 && inside.length > 1) { const p = rng.pick(inside); present.delete(p); events.push(`${p}离开了房间。`); continue; }
      if (r < 0.5 && outside.length) { const p = rng.pick(outside); present.add(p); events.push(`${p}回到了房间。`); continue; }
      if (r < 0.62 && level >= 4 && outside.length) {
        // peek: an outsider secretly watches the next move; nobody knows they watched.
        const spy = rng.pick(outside), mover = rng.pick(inside);
        const to = rng.pick(boxes.filter((b) => b !== loc));
        events.push(`${mover}把戒指从${loc}挪到了${to}。（${spy}在门外从窗缝偷偷看见了，没有人知道这一点。）`);
        loc = to;
        for (const c of chains) {
          const key = c.join(">");
          // in-room people believe it and believe other in-room people saw it; spy knows only for himself
          if (c.every((p) => present.has(p))) bel.set(key, to);
          else if (c[c.length - 1] === spy && c.slice(0, -1).length === 0) bel.set(key, to);
          else if (c[0] === spy && c.slice(1).every((p) => present.has(p))) bel.set(key, to);
        }
        continue;
      }
      if (r < 0.75 && level >= 6 && outside.length) {
        const teller = rng.pick(inside), told = rng.pick(outside);
        const lie = rng.chance(0.5);
        const said = lie ? rng.pick(boxes.filter((b) => b !== loc)) : loc;
        events.push(`${teller}给不在场的${told}发消息：「戒指现在在${said}。」${told}相信了。${lie ? "（这是假的。）" : ""}`);
        for (const c of chains) if (c[0] === told && c.length === 1) bel.set(c.join(">"), said);
        // teller knows told now thinks `said`
        for (const c of chains) if (c.length === 2 && c[0] === teller && c[1] === told) bel.set(c.join(">"), said);
        continue;
      }
      const mover = rng.pick(inside);
      const to = rng.pick(boxes.filter((b) => b !== loc));
      events.push(`${mover}把戒指从${loc}挪到了${to}。`);
      loc = to;
      for (const c of chains) if (c.every((p) => present.has(p))) bel.set(c.join(">"), to);
    }
    const target = rng.pick(chains.filter((c) => c.length === depth));
    const answer = bel.get(target.join(">"))!;
    const phrase = target.map((p) => `${p}认为`).join("");
    return {
      title: `${n} 人 · ${depth} 层`,
      prompt: `${events.map((e, i) => `${i + 1}. ${e}`).join("\n")}\n\n约定：在房间里的人能看到房间里发生的一切，也知道同在房间里的其他人看到了；离开的人看不到发生了什么。被偷看、被私信这类事情，只有当事人知道。私信只改变收信人自己的认知，以及发信人对「收信人怎么想」的判断。没人看到新情况时，每个人（以及每一层「某人以为某人以为」）都维持原来的认知。\n\n问：${phrase}戒指在哪里？`,
      answer_format: `一个位置名：${boxes.join(" / ")}`,
      key: { answer },
    };
  },
  solve: (k) => k.answer,
  grade(k, answer) {
    const got = asText(answer);
    const ok = got === k.answer || (got.includes(k.answer) && got.length <= k.answer.length + 3);
    return { score: ok ? 1 : 0, correct: ok, detail: ok ? "正确" : `给出 ${got || "（空）"}`, expected: k.answer };
  },
};
