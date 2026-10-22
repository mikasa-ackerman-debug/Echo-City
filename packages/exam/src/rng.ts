/** Deterministic PRNG (cyrb128 → sfc32). Same seed ⇒ same task, on server and in the browser. */
export class Rand {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < seed.length; i++) {
      const k = seed.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    this.a = (h1 ^ h2 ^ h3 ^ h4) >>> 0;
    this.b = (h2 ^ h1) >>> 0;
    this.c = (h3 ^ h1) >>> 0;
    this.d = (h4 ^ h1) >>> 0;
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Float in [0, 1). */
  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    const t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const r = (t + this.d) | 0;
    this.c = (this.c + r) | 0;
    return (r >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** Random BigInt with exactly `digits` decimal digits (digits ≥ 1). */
  bigDigits(digits: number): bigint {
    let s = String(this.int(1, 9));
    for (let i = 1; i < digits; i++) s += String(this.int(0, 9));
    return BigInt(s);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  sample<T>(arr: readonly T[], k: number): T[] {
    return this.shuffle(arr).slice(0, k);
  }
}
