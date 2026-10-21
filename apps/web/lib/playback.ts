import type { CycleEvent } from "@echo/engine";

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

export function mineContext(events: CycleEvent[], ids: string[]) {
  const identities = new Set(ids);
  for (const e of events) if (e.type === "cycle_start") {
    for (const a of (e.data as any).agents ?? []) if (identities.has(a.id)) identities.add(a.name);
  }
  const venues = new Set<string>();
  for (const e of events) if (e.type === "trial_start") {
    const d = e.data as any;
    if ((d.players ?? []).some((p: string) => identities.has(p))) venues.add(d.venue ?? e.venue);
  }
  return { identities, venues };
}

export function touchesMine(e: CycleEvent, context: ReturnType<typeof mineContext>): boolean {
  const d = e.data as any;
  if (["cycle_start", "dawn", "cycle_end"].includes(e.type)) return true;
  if (e.owners?.some((id) => context.identities.has(id))) return true;
  if (context.venues.has(e.venue ?? d?.venue)) return true;
  return [d?.id, d?.agentId, d?.agent, d?.from, d?.to, d?.by, d?.target, ...(d?.players ?? [])]
    .some((id) => typeof id === "string" && context.identities.has(id));
}

export function nextCursor(events: CycleEvent[], cursor: number, mine?: ReturnType<typeof mineContext>): number {
  let next = Math.min(events.length, cursor + 1);
  while (mine && next < events.length && !touchesMine(events[next - 1], mine)) next++;
  return next;
}

/** Never stringify trial state: delivered reveals may still contain full secrets. */
export function eventText(e: CycleEvent): string {
  const d = e.data as any;
  if (e.type === "trial_reveal") return "试炼揭晓 · 已收到结算信息";
  if (typeof e.text === "string" && e.text) return e.text;
  if (["thought", "whisper", "host_whisper", "trial_message"].includes(e.type) && typeof d?.text === "string") {
    const speaker = d.agent ?? d.from ?? d.host;
    return `${speaker ? `${speaker}：` : ""}${d.text}`;
  }
  if (e.type === "whisper_meta") return `${d?.from ?? "Agent"} 向 ${d?.to ?? "Agent"} 低语`;
  return "";
}

export function cycleHumanities(events: CycleEvent[]): Record<string, number> {
  const end = [...events].reverse().find((e) => e.type === "cycle_end");
  return Object.fromEntries(((end?.data as any)?.agents ?? [])
    .filter((a: any) => typeof a.humanity === "number").map((a: any) => [a.id, a.humanity]));
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
