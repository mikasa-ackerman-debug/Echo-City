import type { AgentDriver } from "@echo/agents";
import { withTimeout } from "@echo/agents";
import type { AgentResponse } from "@echo/protocol";
import { advance, buildObservation, createCycle, type CycleConfig, type CycleEvent, type CycleState, type RosterEntry } from "@echo/engine";

export interface RunHooks {
  /** Called after every engine advance with the new events. */
  onEvents?: (events: CycleEvent[], state: CycleState) => void | Promise<void>;
  /** Provide host whispers at the end of each night. Return agentId -> text. */
  whispers?: (state: CycleState, agents: string[]) => Promise<Record<string, string>> | Record<string, string>;
  /** Called after each save point so callers can persist state. */
  onState?: (state: CycleState) => void | Promise<void>;
  /** Multiply engine timeouts (e.g. 0.01 for bot sims). */
  timeoutScale?: number;
  signal?: AbortSignal;
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

/** Ask every waiting agent in parallel, enforcing per-request deadlines. */
export async function collectResponses(state: CycleState, drivers: Record<string, AgentDriver>, timeoutScale = 1, signal?: AbortSignal): Promise<Record<string, AgentResponse | null>> {
  if (state.waiting.kind !== "agents") return {};
  const out: Record<string, AgentResponse | null> = {};
  await Promise.all(
    state.waiting.requests.map(async (r) => {
      const driver = drivers[r.agentId];
      if (!driver) {
        out[r.agentId] = null;
        return;
      }
      const deadline = Math.max(50, Math.round(state.config.timeoutsMs[r.timeout] * timeoutScale));
      const obs = buildObservation(state, r.agentId, state.config.timeoutsMs[r.timeout]);
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal?.addEventListener("abort", onAbort);
      const res = await withTimeout(driver.decide(obs, ctrl.signal), deadline, signal);
      if (res === null) ctrl.abort();
      signal?.removeEventListener("abort", onAbort);
      out[r.agentId] = res;
    }),
  );
  return out;
}

/** Drive a cycle from creation to the end. */
export async function runCycle(opts: RunOptions, hooks: RunHooks = {}): Promise<RunResult> {
  let state = createCycle({ id: opts.id, seed: opts.seed, roster: opts.roster, config: opts.config });
  return continueCycle(state, opts.drivers, hooks);
}

export async function continueCycle(initial: CycleState, drivers: Record<string, AgentDriver>, hooks: RunHooks = {}): Promise<RunResult> {
  let state = initial;
  const all: CycleEvent[] = [];
  let steps = 0;
  let input: Parameters<typeof advance>[1] = {};
  while (true) {
    if (hooks.signal?.aborted) throw new Error("aborted");
    const r = advance(state, input);
    state = r.state;
    all.push(...r.events);
    steps++;
    if (r.events.length) await hooks.onEvents?.(r.events, state);
    await hooks.onState?.(state);
    if (state.waiting.kind === "done") break;
    if (state.waiting.kind === "host") {
      const whispers = hooks.whispers ? await hooks.whispers(state, state.waiting.agents) : {};
      input = { whispers };
    } else {
      input = { responses: await collectResponses(state, drivers, hooks.timeoutScale ?? 1, hooks.signal) };
    }
  }
  return { state, events: all, steps };
}
