import type { Family } from "../types";
import { asBigInt, exact, gcd, isPrime } from "../util";

/** 同余方程组（中国剩余定理），高阶附带一个模幂步骤。 */
interface Key { mods: string[]; rems: string[]; value: string; pow?: { base: string; exp: string } }

function modpow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n; b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}

export const crt: Family<Key> = {
  id: "math.crt",
  dimension: "math",
  name: "同余与模幂",
  blurb: "一组同余条件，求最小的非负解。高阶的余数本身要先算一次模幂。",
  maxLevel: 10,
  timeLimit: (l) => 60 + l * 20,
  generate(rng, level) {
    const k = 2 + Math.min(4, Math.floor(level / 2));
    const lim = 10 + level * 25;
    const primes = Array.from({ length: lim }, (_, i) => i + 2).filter(isPrime);
    const mods: bigint[] = [];
    while (mods.length < k) {
      const m = BigInt(level >= 5 && rng.chance(0.5) ? rng.pick(primes) ** 1 * rng.int(1, 3) : rng.pick(primes));
      if (m > 1n && mods.every((x) => gcd(x, m) === 1n)) mods.push(m);
    }
    const M = mods.reduce((a, b) => a * b, 1n);
    const x = BigInt(rng.int(0, Number(M > 9007199254740991n ? 9007199254740991n : M) - 1)) % M;
    const rems = mods.map((m) => x % m);
    let pow: Key["pow"];
    let lines = mods.map((m, i) => `x ≡ ${rems[i]} (mod ${m})`);
    if (level >= 6) {
      // Replace the first remainder with a modular power the examinee must evaluate.
      const m = mods[0];
      let base = 0n, exp = 0n;
      for (let g = 0; g < 200; g++) { base = BigInt(rng.int(2, 999)); exp = BigInt(rng.int(100, 10 ** Math.min(9, level))); if (modpow(base, exp, m) === rems[0]) break; }
      if (modpow(base, exp, m) === rems[0]) { pow = { base: base.toString(), exp: exp.toString() }; lines[0] = `x ≡ ${base}^${exp} (mod ${m})`; }
    }
    return {
      title: `${k} 个同余式`,
      prompt: `求满足下列所有条件的最小非负整数 x：\n\n${lines.join("\n")}`,
      answer_format: "一个非负整数。",
      key: { mods: mods.map(String), rems: rems.map(String), value: x.toString(), pow },
    };
  },
  solve: (k) => k.value,
  grade(k, answer) {
    const got = asBigInt(answer);
    return exact(got !== null && got.toString() === k.value, k.value, got === null ? "无法解析为整数" : undefined);
  },
};
