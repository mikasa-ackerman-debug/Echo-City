import type { CycleEvent } from "@echo/engine";
import { num, rec, recs, str, strs } from "./ev";

/** Merge late-visible deliveries by immutable engine sequence, not delivery ID. */
export function mergeEvents(previous: CycleEvent[], incoming: CycleEvent[]): CycleEvent[] {
  const bySeq = new Map(previous.map((e) => [e.seq, e]));
  for (const e of incoming) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function anchorCursor(previous: CycleEvent[], next: CycleEvent[], cursor: number): number {
  if (cursor <= 0) return 0;
  const seq = previous[Math.min(cursor, previous.length) - 1]?.seq;
  if (seq == null) return Math.min(cursor, next.length);
  const index = next.findIndex((e) => e.seq === seq);
  return index < 0 ? Math.min(cursor, next.length) : index + 1;
}

export interface MineContext { identities: Set<string>; venues: Set<string> }

export function mineContext(events: CycleEvent[], ids: string[]): MineContext {
  const identities = new Set(ids);
  for (const e of events) if (e.type === "cycle_start") {
    for (const a of recs(e.data.agents)) { const id = str(a.id); const name = str(a.name); if (id && name && identities.has(id)) identities.add(name); }
  }
  const venues = new Set<string>();
  for (const e of events) if (e.type === "trial_start") {
    const v = str(e.data.venue) ?? e.venue;
    if (v && strs(e.data.players).some((p) => identities.has(p))) venues.add(v);
  }
  return { identities, venues };
}

export function touchesMine(e: CycleEvent, context: MineContext): boolean {
  const d = e.data ?? {};
  if (["cycle_start", "dawn", "cycle_end"].includes(e.type)) return true;
  if (e.owners?.some((id) => context.identities.has(id))) return true;
  const venue = e.venue ?? str(d.venue);
  if (venue && context.venues.has(venue)) return true;
  return [d.id, d.agentId, d.agent, d.from, d.to, d.by, d.target, ...strs(d.players)]
    .some((id) => typeof id === "string" && context.identities.has(id));
}

export function nextCursor(events: CycleEvent[], cursor: number, mine?: MineContext): number {
  let next = Math.min(events.length, cursor + 1);
  while (mine && next < events.length && !touchesMine(events[next - 1], mine)) next++;
  return next;
}

/** Never stringify trial state: delivered reveals may still contain full secrets. */
export function eventText(e: CycleEvent): string {
  const d = e.data ?? {};
  if (e.type === "trial_reveal") return "试炼揭晓 · 已收到结算信息";
  if (typeof e.text === "string" && e.text) return e.text;
  if (["thought", "whisper", "host_whisper", "trial_message"].includes(e.type) && typeof d.text === "string") {
    const speaker = str(d.agent) ?? str(d.from) ?? str(d.host);
    return `${speaker ? `${speaker}：` : ""}${d.text}`;
  }
  if (e.type === "whisper_meta") return `${str(d.from) ?? "Agent"} 向 ${str(d.to) ?? "Agent"} 低语`;
  if (e.type === "host_silent") return `${str(d.agent) ?? "Agent"} 的宿主保持了沉默。`;
  return "";
}

export function cycleHumanities(events: CycleEvent[]): Record<string, number> {
  const end = [...events].reverse().find((e) => e.type === "cycle_end");
  const out: Record<string, number> = {};
  for (const a of recs(end?.data.agents)) {
    const id = str(a.id); const h = num(a.humanity);
    if (id && h !== undefined) out[id] = h;
  }
  return out;
}

/** Per-agent humanity log from cycle_end (only exists after the cycle). */
export function humanityLogs(events: CycleEvent[]): Record<string, Array<{ night: number; delta: number; reason: string }>> {
  const end = [...events].reverse().find((e) => e.type === "cycle_end");
  const out: Record<string, Array<{ night: number; delta: number; reason: string }>> = {};
  for (const a of recs(end?.data.agents)) {
    const id = str(a.id);
    if (!id) continue;
    out[id] = recs(a.humanity_log).map((x) => ({ night: num(x.night) ?? 0, delta: num(x.delta) ?? 0, reason: str(x.reason) ?? "" }));
  }
  return out;
}

export function markerLabel(label: string, index: number, cursor: number): string {
  return index < cursor ? label : "尚未播放的关键事件";
}

export function defaultVenue<T extends { ended: boolean; players: string[] }>(venues: T[], identities: Set<string>): T | undefined {
  return venues.find((v) => !v.ended && v.players.some((p) => identities.has(p)))
    ?? venues.find((v) => !v.ended)
    ?? venues[venues.length - 1];
}

export function revealAllowed(ended: boolean, cursor: number, count: number, explicit: boolean): boolean {
  return ended && (explicit || (count > 0 && cursor >= count));
}

/**
 * Client mirror of the server's delivery order (apps/api manager.deliveries):
 * an event is released at its own seq if public/owned, otherwise when its trial ends,
 * its night ends, or the cycle ends. Used to simulate a live broadcast from a finished
 * log without ever leaking hidden information early (FRONTEND §10.2).
 */
export function releaseOrder(all: CycleEvent[], viewer: string[] = []): Array<CycleEvent & { release: number }> {
  const nights = new Map<number, number>();
  const venues = new Map<string, number>();
  let ended = Infinity;
  for (const e of all) {
    if (e.type === "night_end") nights.set(e.night, e.seq);
    if (e.type === "trial_end" && e.venue) venues.set(e.venue, e.seq);
    if (e.type === "cycle_end") ended = e.seq;
  }
  return all.map((e) => {
    const own = e.owners?.some((id) => viewer.includes(id));
    const release = own || e.vis === "public" ? e.seq : Math.max(e.seq, Math.min(ended,
      e.vis === "after_trial" ? venues.get(e.venue ?? "") ?? Infinity :
      e.vis === "after_night" ? nights.get(e.night) ?? Infinity : Infinity));
    return { ...e, release };
  }).filter((x) => Number.isFinite(x.release)).sort((a, b) => a.release - b.release || a.seq - b.seq);
}

/** Events released by the time the engine has emitted `head` (live demo clock). */
export function releasedAt(order: Array<CycleEvent & { release: number }>, head: number): CycleEvent[] {
  const out: CycleEvent[] = [];
  for (const e of order) { if (e.release > head) break; out.push(e); }
  return out.sort((a, b) => a.seq - b.seq);
}

export const nameOfId = (events: CycleEvent[], id: string): string | undefined => {
  for (const e of events) if (e.type === "cycle_start") for (const a of recs(e.data.agents)) if (str(a.id) === id) return str(a.name);
  return undefined;
};

export const agentsOfStart = (events: CycleEvent[]) => recs(events.find((e) => e.type === "cycle_start")?.data.agents).map((a) => ({ id: str(a.id) ?? "", name: str(a.name) ?? "", host: str(a.host) ?? "", relation: str(a.relation) ?? "", kind: str(a.kind) }));

export { rec };
