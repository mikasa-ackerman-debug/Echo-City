import type { Phase } from "@echo/protocol";
import { Rng } from "./rng";
import type { CycleEvent, CycleState, Emit, AgentState, DeleteReason, HumanityChange, Visibility } from "./types";
import { ANANKE } from "./narrator";

/** Mutable working context used while advancing a cycle. */
export interface K {
  s: CycleState;
  rng: Rng;
  events: CycleEvent[];
  emit: (type: string, data: Record<string, unknown>, opts?: { text?: string; vis?: Visibility; owners?: string[]; venue?: string; phase?: Phase }) => void;
}

export function makeK(s: CycleState): K {
  const rng = new Rng([...s.rng] as CycleState["rng"]);
  const events: CycleEvent[] = [];
  const k: K = {
    s,
    rng,
    events,
    emit(type, data, opts = {}) {
      s.seq++;
      const ev: CycleEvent = { seq: s.seq, night: s.night, phase: opts.phase ?? s.phase, type, data, vis: opts.vis ?? "public" };
      if (opts.text) ev.text = opts.text;
      if (opts.venue) ev.venue = opts.venue;
      if (opts.owners) ev.owners = opts.owners;
      events.push(ev);
    },
  };
  return k;
}

export function venueEmit(k: K, venue: string): Emit {
  return (type, data, opts = {}) => k.emit(type, data, { ...opts, venue });
}

export const alive = (s: CycleState) => s.order.filter((id) => s.agents[id].status === "alive");
export const nameOf = (s: CycleState, id: string) => s.agents[id]?.name ?? id;

export function adjustHumanity(k: K, ch: HumanityChange) {
  const a = k.s.agents[ch.agentId];
  if (!a || a.status !== "alive") return;
  let delta = ch.delta;
  if (delta > 0) {
    const category = ch.reason.startsWith("赠予") ? "gift" : ch.reason.startsWith("如实告知") ? "truth" : ch.reason.startsWith("履行了契约") ? "pact" : undefined;
    if (category) {
      const budgets = { gift: [5, 10], truth: [2, 6], pact: [3, 6] };
      const [daily, lifetime] = budgets[category];
      const rewards = a.humanityRewards ??= {};
      const key = `${category}:${k.s.night}`;
      delta = Math.min(delta, daily - (rewards[key] ?? 0), lifetime - (rewards[category] ?? 0));
      if (delta <= 0) return;
      rewards[key] = (rewards[key] ?? 0) + delta;
      rewards[category] = (rewards[category] ?? 0) + delta;
    }
  }
  const before = a.humanity;
  a.humanity = Math.max(0, Math.min(100, a.humanity + delta));
  a.humanityLog.push({ night: k.s.night, delta: a.humanity - before, reason: ch.reason });
  k.emit("humanity", { agent: a.name, id: a.id, delta: a.humanity - before, reason: ch.reason, value: a.humanity }, { vis: "after_cycle" });
}

export function deleteAgent(k: K, id: string, reason: DeleteReason, card?: string) {
  const a = k.s.agents[id];
  if (!a || a.status !== "alive") return;
  a.status = "deleted";
  if (k.s.winner === id) k.s.winner = undefined;
  k.s.deathCounter++;
  const remaining = a.host.memories.map((m, i) => ({ m, i })).filter((x) => !a.pawned.includes(x.i));
  const epitaph = remaining.length ? k.rng.pick(remaining).m : undefined;
  a.deletion = { night: k.s.night, reason, card, epitaph, order: k.s.deathCounter };
  a.registeredVenue = undefined;
  for (const p of k.s.pacts) if ((p.a === id || p.b === id) && (p.status === "active" || p.status === "proposed")) p.status = "expired";
  k.emit(
    "agent_deleted",
    {
      agent: a.name,
      id,
      reason,
      card: card ?? null,
      last_words: a.lastWords || null,
      epitaph: epitaph ?? null,
      host: a.host.name,
      alive: alive(k.s).length,
      order: k.s.deathCounter,
    },
    { text: ANANKE.deleted(a.name) },
  );
}

export function addUptime(k: K, a: AgentState, delta: number, reason: string, card?: string) {
  if (a.status !== "alive" || delta === 0) return;
  a.uptime += delta;
  k.emit("uptime", { agent: a.name, id: a.id, delta, value: a.uptime, reason }, { owners: [a.id], vis: reason === "patch" ? "after_night" : "public" });
  if (a.uptime <= 0) deleteAgent(k, a.id, reason === "trial_fail" ? "trial" : "uptime", card);
}
