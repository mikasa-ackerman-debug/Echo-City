import type { AgentDriver } from "@echo/agents";
import { withTimeout } from "@echo/agents";
import type { AgentResponse } from "@echo/protocol";
import { advance, buildObservation, createCycle, npcHint, type CycleConfig, type CycleEvent, type CycleState, type RosterEntry, type TimeoutClass } from "@echo/engine";

export interface RunHooks {
  /** Called after every engine advance with the new events. */
  onEvents?: (events: CycleEvent[], state: CycleState) => void | Promise<void>;
  /** Provide host whispers at the end of each night. Return agentId -> text. */
  whispers?: (state: CycleState, agents: string[]) => Promise<Record<string, string>> | Record<string, string>;
  /** Called after each save point so callers can persist state. */
  onState?: (state: CycleState) => void | Promise<void>;
  /** Multiply engine timeouts (e.g. 0.01 for bot sims). */
  timeoutScale?: number;
  /**
   * per-agent 超时倍率（优先于 timeoutScale）。按 (agentId, 超时类别, 引擎基准毫秒) 返回倍率，
   * 例如 MCP agent 的 spade 5s → 120s 即返回 24。引擎规则与 obs.deadline_ms 不变。
   */
  scaleFor?: TimeoutScaleFn;
  signal?: AbortSignal;
  /** Awaited before every engine advance; use it to pace a live cycle to the wall clock. */
  pace?: (state: CycleState, moment: "before_input" | "before_advance") => Promise<void>;
}

export interface RunOptions {
  id: string;
  seed: string;
  roster: RosterEntry[];
  drivers: Record<string, AgentDriver>;
  config?: Partial<CycleConfig>;
}

export interface RunResult {
  state: CycleState;
  events: CycleEvent[];
  steps: number;
}

/** per-agent 超时倍率函数：返回值乘以引擎基准超时即为该 agent 本次的实际 deadline。 */
export type TimeoutScaleFn = (agentId: string, timeout: TimeoutClass, baseMs: number) => number;

/** Ask every waiting agent in parallel, enforcing per-request deadlines. */
export async function collectResponses(state: CycleState, drivers: Record<string, AgentDriver>, timeoutScale: number | TimeoutScaleFn = 1, signal?: AbortSignal): Promise<Record<string, AgentResponse | null>> {
  if (state.waiting.kind !== "agents") return {};
  const out: Record<string, AgentResponse | null> = {};
  await Promise.all(
    state.waiting.requests.map(async (r) => {
      const driver = drivers[r.agentId];
      if (!driver) {
        out[r.agentId] = null;
        return;
      }
      const base = state.config.timeoutsMs[r.timeout];
      const scale = typeof timeoutScale === "function" ? timeoutScale(r.agentId, r.timeout, base) : timeoutScale;
      const deadline = Math.max(50, Math.round(base * (Number.isFinite(scale) && scale > 0 ? scale : 1)));
      const obs = buildObservation(state, r.agentId, base);
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal?.addEventListener("abort", onAbort);
      if (signal?.aborted) ctrl.abort();
      try {
        // The oracle is attached only for built-in NPCs; player drivers (MCP/webhook/LLM) never see it.
        const ctx = driver.npc ? { deadlineMs: deadline, timeout: r.timeout, oracle: npcHint(state, r.agentId) } : { deadlineMs: deadline, timeout: r.timeout };
        out[r.agentId] = await withTimeout(Promise.resolve().then(() => driver.decide(obs, ctrl.signal, ctx)), deadline, signal);
      } finally {
        ctrl.abort();
        signal?.removeEventListener("abort", onAbort);
      }
    }),
  );
  return out;
}

/** Drive a cycle from creation to the end. */
export async function runCycle(opts: RunOptions, hooks: RunHooks = {}): Promise<RunResult> {
  const state = createCycle({ id: opts.id, seed: opts.seed, roster: opts.roster, config: opts.config });
  await hooks.onState?.(state); // initial snapshot before pacing or network IO
  return continueCycle(state, opts.drivers, hooks);
}

export async function continueCycle(initial: CycleState, drivers: Record<string, AgentDriver>, hooks: RunHooks = {}): Promise<RunResult> {
  let state = initial;
  const all: CycleEvent[] = [];
  let steps = 0;
  if (state.stage === "ended") return { state, events: all, steps };
  // Resuming a state that is already waiting: collect input before advancing.
  await hooks.pace?.(state, "before_input");
  let input: Parameters<typeof advance>[1] = await gather(state, drivers, hooks);
  while (true) {
    if (hooks.signal?.aborted) throw new Error("aborted");
    await hooks.pace?.(state, "before_advance");
    const r = advance(state, input);
    state = r.state;
    all.push(...r.events);
    steps++;
    if (r.events.length) await hooks.onEvents?.(r.events, state);
    await hooks.onState?.(state);
    if (state.waiting.kind === "done") break;
    await hooks.pace?.(state, "before_input");
    input = await gather(state, drivers, hooks);
  }
  return { state, events: all, steps };
}

async function gather(state: CycleState, drivers: Record<string, AgentDriver>, hooks: RunHooks): Promise<Parameters<typeof advance>[1]> {
  if (state.waiting.kind === "host") {
    const whispers = hooks.whispers ? await hooks.whispers(state, state.waiting.agents) : {};
    return { whispers };
  }
  if (state.waiting.kind === "agents") return { responses: await collectResponses(state, drivers, hooks.scaleFor ?? hooks.timeoutScale ?? 1, hooks.signal) };
  return {};
}
