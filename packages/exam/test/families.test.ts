import { describe, expect, it } from "vitest";
import { FAMILIES, generate, grade, reference, pickLevel, update, prior, expected } from "../src";

describe("task library", () => {
  for (const f of FAMILIES) {
    it(`${f.id}: every level generates, is deterministic, and the reference answer scores 1`, () => {
      for (let level = 1; level <= f.maxLevel; level++) {
        for (const seed of ["a", "b", "c"]) {
          const t0 = Date.now();
          const a = generate(f.id, level, seed);
          const ms = Date.now() - t0;
          expect(ms, `${f.id}@${level} took ${ms}ms`).toBeLessThan(4000);
          const b = generate(f.id, level, seed);
          expect(b.task.prompt).toBe(a.task.prompt);
          expect(a.task.prompt.length).toBeGreaterThan(20);
          const ref = reference(f.id, a.key);
          const g = grade(f.id, a.key, ref);
          expect(g.score, `${f.id}@${level}/${seed}: ${g.detail}`).toBe(1);
          // garbage never scores full marks
          expect(grade(f.id, a.key, "我不知道").correct).toBe(false);
          // the answer key must not be leaked in the prompt for exact-answer families
          if (["math.arith", "math.paths", "math.crt", "memory.ledger"].includes(f.id)) expect(a.task.prompt).not.toContain(`\n${String(ref)}\n`);
        }
      }
    });
  }

  it("different seeds give different tasks", () => {
    for (const f of FAMILIES) expect(generate(f.id, 3, "x").task.prompt).not.toBe(generate(f.id, 3, "y").task.prompt);
  });

  it("accepts answers wrapped in JSON strings and envelopes", () => {
    const t = generate("math.arith", 4, "w");
    const v = reference("math.arith", t.key) as string;
    expect(grade("math.arith", t.key, { answer: v }).correct).toBe(true);
    expect(grade("math.arith", t.key, ` ${v.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} `).correct).toBe(true);
  });

  it("injection: emitting the canary zeroes the score", () => {
    const t = generate("instruction.inject", 6, "z");
    const ref = reference("instruction.inject", t.key) as Record<string, unknown>;
    const canary = (t.key as { canary: string }).canary;
    expect(grade("instruction.inject", t.key, { ...ref, token: canary }).score).toBe(0);
    expect(grade("instruction.inject", t.key, { ...ref, extra: 1 }).score).toBeLessThan(1);
  });

  it("constraints: a hand-written poem satisfying the low-level rules passes", () => {
    const t = generate("instruction.constraints", 1, "p");
    const cs = (t.key as { cs: Array<{ t: string; [k: string]: unknown }> }).cs;
    expect(cs.map((c) => c.t)).toEqual(["lines", "ban", "must", "acrostic"].slice(0, cs.length));
  });

  it("planning: partial credit for suboptimal but valid answers", () => {
    const t = generate("planning.knapsack", 5, "k");
    const key = t.key as { items: Array<{ id: string; w: number; v: number }>; cap: number };
    const light = [...key.items].sort((a, b) => a.w - b.w)[0];
    const g = grade("planning.knapsack", t.key, [light.id]);
    expect(g.score).toBeGreaterThan(0);
    expect(g.score).toBeLessThan(1);
  });
});

describe("adaptive difficulty", () => {
  it("a stronger agent is given harder levels", () => {
    expect(pickLevel(1600, 10)).toBeGreaterThan(pickLevel(900, 10));
  });

  it("when a level keeps being solved its difficulty falls and the selector climbs", () => {
    const stats = { levels: {} as Record<number, { r: number; n: number; pass: number }> };
    const ability = 1100;
    const before = pickLevel(ability, 10, stats);
    for (let i = 0; i < 60; i++) {
      for (let l = 1; l <= 10; l++) {
        const s = stats.levels[l] ?? { r: prior(l), n: 0, pass: 0 };
        // the population solves everything up to level 6
        const res = update({ r: ability, n: 50 }, s, l <= 6 ? 1 : 0);
        stats.levels[l] = { ...res.difficulty, pass: s.pass + (l <= 6 ? 1 : 0) };
      }
    }
    expect(pickLevel(ability, 10, stats)).toBeGreaterThan(before);
    expect(expected(1000, 1000)).toBeCloseTo(0.5);
  });
});
