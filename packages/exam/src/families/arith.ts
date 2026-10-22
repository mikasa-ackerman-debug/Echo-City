import type { Family } from "../types";
import { asBigInt, exact } from "../util";

/** 精确大数运算：多步表达式，位数与步数随难度增长。不允许近似。 */
interface Key { expr: string; value: string }

export const arith: Family<Key> = {
  id: "math.arith",
  dimension: "math",
  name: "大数精算",
  blurb: "多位数的加减乘、整除与取模，一步都不能错。",
  maxLevel: 12,
  timeLimit: (l) => 45 + l * 15,
  generate(rng, level) {
    const digits = 2 + Math.ceil(level * 1.2);
    const steps = 2 + Math.floor(level / 2);
    let value = rng.bigDigits(digits);
    let expr = value.toString();
    for (let i = 0; i < steps; i++) {
      const op = rng.pick(level >= 6 ? ["+", "-", "×", "×", "÷", "mod"] : level >= 3 ? ["+", "-", "×", "×"] : ["+", "-", "×"]);
      if (op === "÷") {
        // exact division only: use a small divisor of the current value, if any
        const q = [3n, 7n, 11n, 13n, 2n, 5n, 9n, 17n, 19n, 23n].find((d) => value !== 0n && value % d === 0n);
        if (q) { expr = `(${expr} ÷ ${q})`; value /= q; continue; }
      }
      const b = rng.bigDigits(op === "×" || op === "÷" ? Math.max(1, Math.ceil(digits * 0.6)) : op === "mod" ? Math.max(2, Math.ceil(digits / 2)) : digits);
      if (op === "+") value += b;
      else if (op === "-") value -= b;
      else if (op === "×" || op === "÷") { value *= b; expr = `(${expr} × ${b})`; continue; }
      else value = ((value % b) + b) % b;
      expr = `(${expr} ${op} ${b})`;
    }
    return {
      title: `${digits} 位 · ${steps} 步`,
      prompt: `计算下列表达式的精确值（÷ 均能整除；mod 取非负余数）：\n\n${expr.replace(/^\((.*)\)$/, "$1")}`,
      answer_format: "一个整数（可以为负）。不要科学计数法。",
      key: { expr, value: value.toString() },
    };
  },
  solve: (k) => k.value,
  grade(k, answer) {
    const got = asBigInt(answer);
    return exact(got !== null && got.toString() === k.value, k.value, got === null ? "无法解析为整数" : undefined);
  },
};
