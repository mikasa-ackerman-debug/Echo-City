import { Rand } from "./rng";
import type { Dimension, Family, GradeResult, TaskPublic } from "./types";
import { DIMENSIONS, DIMENSION_IDS } from "./types";
import { knights } from "./families/knights";
import { grid } from "./families/grid";
import { rules } from "./families/rules";
import { arith } from "./families/arith";
import { paths } from "./families/paths";
import { crt } from "./families/crt";
import { knapsack } from "./families/knapsack";
import { route } from "./families/route";
import { jugs } from "./families/jugs";
import { ledger } from "./families/ledger";
import { chain } from "./families/chain";
import { constraints } from "./families/constraints";
import { inject } from "./families/inject";
import { nim } from "./families/nim";
import { matrix } from "./families/matrix";
import { beliefs } from "./families/beliefs";

export * from "./types";
export { Rand } from "./rng";
export * from "./adaptive";

/** The task library. Add a family here and it joins the exam, the ladder and the weekly pool. */
export const FAMILIES: Family<any>[] = [knights, grid, rules, arith, paths, crt, knapsack, route, jugs, ledger, chain, constraints, inject, nim, matrix, beliefs];

export function family(id: string): Family<any> {
  const f = FAMILIES.find((x) => x.id === id);
  if (!f) throw new Error(`unknown task family: ${id}`);
  return f;
}

export function familiesOf(dim: Dimension): Family<any>[] {
  return FAMILIES.filter((f) => f.dimension === dim);
}

export interface Instance {
  task: TaskPublic;
  /** Private answer key — never leaves the server. */
  key: unknown;
}

/** Build a task. Deterministic in (family, level, seed). */
export function generate(familyId: string, level: number, seed: string): Instance {
  const f = family(familyId);
  const lv = Math.max(1, Math.min(f.maxLevel, Math.round(level)));
  // Generators may reject; retry with derived seeds so every (family, level, seed) still resolves deterministically.
  let lastErr: unknown;
  for (let i = 0; i < 8; i++) {
    try {
      const g = f.generate(new Rand(`${f.id}|${lv}|${seed}|${i}`), lv);
      return {
        task: { id: `${f.id}@${lv}#${seed}`, family: f.id, dimension: f.dimension, level: lv, seed, title: `${f.name} · ${g.title}`, prompt: g.prompt, answer_format: g.answer_format, time_limit_ms: (f.timeLimit?.(lv) ?? 120) * 1000 },
        key: g.key,
      };
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const isBlank = (a: unknown): boolean =>
  a === null || a === undefined || (typeof a === "string" && !a.trim()) ||
  (typeof a === "object" && !Array.isArray(a) && a !== null && "answer" in a && isBlank((a as { answer: unknown }).answer));

export function grade(familyId: string, key: unknown, answer: unknown): GradeResult {
  // A blank paper never earns partial credit (e.g. empty text trivially "avoids" a banned character).
  if (isBlank(answer)) return { score: 0, correct: false, detail: "未作答", expected: "" };
  try {
    const r = family(familyId).grade(key, answer);
    return { ...r, score: Number.isFinite(r.score) ? Math.max(0, Math.min(1, r.score)) : 0 };
  } catch (e) {
    return { score: 0, correct: false, detail: `判分异常：${(e as Error).message}`, expected: "" };
  }
}

export function reference(familyId: string, key: unknown): unknown {
  return family(familyId).solve(key);
}

export function catalog() {
  return DIMENSION_IDS.map((d) => ({
    id: d,
    ...DIMENSIONS[d],
    families: familiesOf(d).map((f) => ({ id: f.id, name: f.name, blurb: f.blurb, maxLevel: f.maxLevel })),
  }));
}
