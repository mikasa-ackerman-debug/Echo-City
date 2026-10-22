import type { AgentResponse, Observation } from "@echo/protocol";

/** Server-side knowledge handed only to built-in bots, never to player agents. */
export interface NpcHint { oracle?: unknown }

/** Anything that can answer an observation. */
export interface AgentDriver {
  readonly kind: string;
  /** Built-in NPC: the runner may pass it a server-side hint (e.g. the reference answer of a task-bank card). */
  readonly npc?: boolean;
  decide(obs: Observation, signal?: AbortSignal, hint?: NpcHint): Promise<AgentResponse | null>;
}

/** Tiny deterministic PRNG for bots, seeded from the request id so runs are reproducible. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let x = h >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

export function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: T | null) => {
      if (done) return; done = true;
      clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(value);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) finish(null);
    p.then((value) => finish(value), () => finish(null));
  });
}
