import type { Family } from "../types";
import { asBigInt, exact, names } from "../util";

/**
 * 长账本：几百行交易记录（转账、撤销、按比例分配、冻结），问某个账户的最终余额。
 * 撤销会引用很久之前的流水号，冻结让之后的转出失败——必须真的追踪状态。
 */
interface Key { lines: string[]; who: string; value: string }

export const ledger: Family<Key> = {
  id: "memory.ledger",
  dimension: "memory",
  name: "长账本",
  blurb: "几百行流水、撤销与冻结。最后问一个账户还剩多少。",
  maxLevel: 12,
  timeLimit: (l) => 90 + l * 30,
  generate(rng, level) {
    const accts = names(rng, 4 + Math.min(8, level));
    const nTx = 20 + level * 35;
    const bal = new Map(accts.map((a) => [a, rng.int(100, 999)]));
    const frozen = new Set<string>();
    const done: Array<{ id: number; from: string; to: string; amt: number; ok: boolean; reverted: boolean }> = [];
    const lines: string[] = [`期初余额：${accts.map((a) => `${a} ${bal.get(a)}`).join("，")}。`, "规则：余额不足或账户冻结时，转出失败且不产生任何变化；撤销一笔成功的转账即反向执行同等金额（不受余额与冻结限制）；撤销失败或已撤销的转账没有效果。", ""];
    for (let i = 1; i <= nTx; i++) {
      const r = rng.next();
      const no = `#${String(i).padStart(4, "0")}`;
      if (r < 0.1 && done.length > 5 && level >= 2) {
        const t = rng.pick(done);
        lines.push(`${no} 撤销 #${String(t.id).padStart(4, "0")}`);
        if (t.ok && !t.reverted) { t.reverted = true; bal.set(t.from, bal.get(t.from)! + t.amt); bal.set(t.to, bal.get(t.to)! - t.amt); }
        continue;
      }
      if (r < 0.15 && level >= 4) {
        const a = rng.pick(accts);
        if (frozen.has(a)) { frozen.delete(a); lines.push(`${no} 解冻 ${a}`); } else { frozen.add(a); lines.push(`${no} 冻结 ${a}`); }
        continue;
      }
      if (r < 0.2 && level >= 6) {
        const a = rng.pick(accts), rate = rng.pick([5, 10, 20]);
        const interest = Math.floor((bal.get(a)! * rate) / 100);
        if (bal.get(a)! > 0) bal.set(a, bal.get(a)! + interest);
        lines.push(`${no} ${a} 获得余额 ${rate}% 的利息（向下取整，余额为负或零时不计）`);
        continue;
      }
      const [from, to] = rng.sample(accts, 2);
      const amt = rng.int(5, 300);
      const ok = !frozen.has(from) && bal.get(from)! >= amt;
      if (ok) { bal.set(from, bal.get(from)! - amt); bal.set(to, bal.get(to)! + amt); }
      done.push({ id: i, from, to, amt, ok, reverted: false });
      lines.push(`${no} ${from} → ${to}  ${amt}`);
    }
    const who = rng.pick(accts);
    return {
      title: `${nTx} 条流水`,
      prompt: `${lines.join("\n")}\n\n问：处理完所有流水后，${who} 的余额是多少？`,
      answer_format: "一个整数。",
      key: { lines: [], who, value: String(bal.get(who)) },
    };
  },
  solve: (k) => k.value,
  grade(k, answer) {
    const got = asBigInt(answer);
    return exact(got !== null && got.toString() === k.value, k.value);
  },
};
