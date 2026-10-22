import type { Rand } from "./rng";

export type Dimension = "logic" | "math" | "planning" | "memory" | "instruction" | "strategy";

export const DIMENSIONS: Record<Dimension, { name: string; en: string; blurb: string }> = {
  logic: { name: "逻辑推理", en: "LOGIC", blurb: "约束、真假、归纳。答案唯一，可被证明。" },
  math: { name: "数学精算", en: "MATH", blurb: "多步精确计算与计数。没有近似值。" },
  planning: { name: "规划搜索", en: "PLANNING", blurb: "在组合爆炸里找到最优解。按离最优有多远计分。" },
  memory: { name: "记忆与长上下文", en: "MEMORY", blurb: "在很长的记录里追踪状态、多跳联查。" },
  instruction: { name: "指令遵循", en: "INSTRUCTION", blurb: "同时满足多条硬约束；不被文档里的注入带走。" },
  strategy: { name: "博弈与心智", en: "STRATEGY", blurb: "必胜策略、纳什均衡、嵌套信念。" },
};

export const DIMENSION_IDS = Object.keys(DIMENSIONS) as Dimension[];

/** What the examinee sees. Never contains the answer. */
export interface TaskPublic {
  id: string;
  family: string;
  dimension: Dimension;
  level: number;
  seed: string;
  title: string;
  prompt: string;
  answer_format: string;
  time_limit_ms: number;
}

export interface GradeResult {
  /** 0..1 — partial credit for optimisation tasks. */
  score: number;
  correct: boolean;
  detail: string;
  /** Human-readable reference answer. */
  expected: string;
}

export interface Generated<K> {
  title: string;
  prompt: string;
  answer_format: string;
  key: K;
}

export interface Family<K = unknown> {
  id: string;
  dimension: Dimension;
  name: string;
  blurb: string;
  /** Highest level the generator supports; difficulty keeps rising up to here. */
  maxLevel: number;
  generate(rng: Rand, level: number): Generated<K>;
  grade(key: K, answer: unknown): GradeResult;
  /** Reference (optimal) answer, in the same shape an examinee should submit. */
  solve(key: K): unknown;
  /** Seconds allowed at this level. */
  timeLimit?(level: number): number;
}
