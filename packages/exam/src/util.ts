import type { GradeResult } from "./types";

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Unwrap common envelopes: {"answer": x}, JSON strings, code fences. */
export function unwrap(answer: unknown): unknown {
  let a = answer;
  for (let i = 0; i < 3; i++) {
    if (a && typeof a === "object" && !Array.isArray(a) && "answer" in (a as Record<string, unknown>) && Object.keys(a as object).length === 1) a = (a as Record<string, unknown>).answer;
    else break;
  }
  return a;
}

export function asText(answer: unknown): string {
  const a = unwrap(answer);
  if (a == null) return "";
  if (typeof a === "string") return a.replace(/^```\w*\s*|```$/g, "").trim().replace(/^["'「“]+|["'」”。.]+$/g, "").trim();
  if (typeof a === "number" || typeof a === "bigint" || typeof a === "boolean") return String(a);
  return JSON.stringify(a);
}

/** Parse an exact integer from text: tolerant of spaces, commas and underscores. */
export function asBigInt(answer: unknown): bigint | null {
  const a = unwrap(answer);
  if (typeof a === "number") return Number.isSafeInteger(a) ? BigInt(a) : null;
  if (typeof a === "bigint") return a;
  const s = asText(a).replace(/[\s,_，]/g, "");
  if (!/^[-+]?\d+$/.test(s)) return null;
  return BigInt(s);
}

/** Parse a JSON value from a string answer, or return the object itself. */
export function asJson(answer: unknown): unknown {
  const a = unwrap(answer);
  if (typeof a !== "string") return a;
  const t = a.replace(/^```\w*\s*/, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch { return a; }
}

export function asList(answer: unknown): string[] {
  const a = asJson(answer);
  if (Array.isArray(a)) return a.map((x) => String(x).trim()).filter(Boolean);
  return asText(a).replace(/^\[|\]$/g, "").split(/[\s,，;；、→>-]+/).map((x) => x.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
}

export function exact(ok: boolean, expected: string, detail?: string): GradeResult {
  return { score: ok ? 1 : 0, correct: ok, detail: detail ?? (ok ? "正确" : "错误"), expected };
}

export function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

export function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}

export function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

export function cp(s: string): number {
  return [...s].length;
}

const SURNAMES = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜谢邹苏潘葛范彭鲁韦马方俞任袁柳鲍史唐薛雷贺倪汤殷罗毕郝安常乐于傅齐康伍余顾孟黄穆萧尹姚邵汪祁毛狄米贝明臧计成戴宋庞熊纪舒屈项祝董梁杜阮蓝闵季贾路江童颜郭梅盛林钟徐邱骆高夏蔡田胡凌霍万柯卢莫房解应宗丁宣邓单杭洪包左石崔龚程邢裴陆荣翁荀甄曲封储靳焦牧山车侯全班秋仲伊宫宁仇甘厉戎祖武符刘景龙叶白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔胥能苍双闻莘党翟谭贡劳姬申扶冉宰雍桑桂濮牛寿通边燕冀浦尚农温别庄晏柴瞿阎慕连茹习艾鱼容向古易慎戈廖庾终居衡步都耿满弘匡国文寇广禄阙东欧沃利蔚越隆师巩聂晁勾敖融冷辛阚那简饶空曾沙养鞠须丰巢关蒯相查后荆红游竺权盖益桓公";
const GIVEN = "伟芳娜敏静丽强磊军洋勇艳杰娟涛明超秀霞平刚桂英华玉萍红鹏辉建文斌宇浩凯帆晨悦欣怡然泽睿诚航岚雪松柏晓峰琳婷倩颖哲彤露瑶晴阳宁安远航舟川岳峻";

/** n distinct Chinese names (2–3 characters). */
export function names(rng: { pick<T>(a: readonly T[]): T; chance(p: number): boolean }, n: number): string[] {
  const out = new Set<string>();
  const s = [...SURNAMES], g = [...GIVEN];
  while (out.size < n) out.add(rng.pick(s) + rng.pick(g) + (rng.chance(0.6) ? rng.pick(g) : ""));
  return [...out];
}
