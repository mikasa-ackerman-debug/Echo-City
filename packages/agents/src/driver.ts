import type { AgentResponse, Observation } from "@echo/protocol";

/** Anything that can answer an observation. */
export interface AgentDriver {
  readonly kind: string;
  decide(obs: Observation, signal?: AbortSignal): Promise<AgentResponse | null>;
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
    const t = setTimeout(() => resolve(null), ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve(null);
    });
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}
