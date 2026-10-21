import type { CycleEvent, CycleState, AgentState } from "./types";
import { ENDING_TITLES } from "./narrator";

/* ------------------------------------------------------------------ */
/* Spectator visibility (GDD 14.3 / FRONTEND 10.2)                     */
/* ------------------------------------------------------------------ */

export interface VisibilityContext {
  /** Venues whose trial has finished. */
  finishedVenues: Set<string>;
  /** Nights that have fully ended. */
  finishedNights: Set<number>;
  cycleEnded: boolean;
  /** Agent ids owned by the viewer (they always see their own private events). */
  viewerAgents?: Set<string>;
}

export function visibilityContext(events: CycleEvent[], viewerAgents?: string[]): VisibilityContext {
  const ctx: VisibilityContext = { finishedVenues: new Set(), finishedNights: new Set(), cycleEnded: false, viewerAgents: viewerAgents ? new Set(viewerAgents) : undefined };
  for (const e of events) {
    if (e.type === "trial_end" && e.venue) ctx.finishedVenues.add(e.venue);
    if (e.type === "night_end") ctx.finishedNights.add(e.night);
    if (e.type === "cycle_end") ctx.cycleEnded = true;
  }
  return ctx;
}

export function isVisible(e: CycleEvent, ctx: VisibilityContext): boolean {
  if (ctx.cycleEnded) return true;
  if (e.owners && ctx.viewerAgents && e.owners.some((o) => ctx.viewerAgents!.has(o))) return true;
  switch (e.vis) {
    case "public":
      // Owner-scoped public events (e.g. uptime ticks) are still fine to show.
      return true;
    case "after_trial":
      return !!e.venue && ctx.finishedVenues.has(e.venue);
    case "after_night":
      return ctx.finishedNights.has(e.night) || (!!e.venue && ctx.finishedVenues.has(e.venue) && ctx.finishedNights.has(e.night));
    case "after_cycle":
      return false;
  }
}

export function filterEvents(events: CycleEvent[], viewerAgents?: string[]): CycleEvent[] {
  const ctx = visibilityContext(events, viewerAgents);
  return events.filter((e) => isVisible(e, ctx));
}

/* ------------------------------------------------------------------ */
/* Summaries for persistence: tombstones, fates, lineage entries       */
/* ------------------------------------------------------------------ */

export interface Tombstone {
  agentId: string;
  name: string;
  host: string;
  relation: string;
  generation: number;
  lineageId?: string;
  owner?: string;
  night: number;
  reason: string;
  card?: string;
  lastWords: string;
  epitaph?: string;
  cardsCleared: string[];
  order: number;
  humanity: number;
}

export interface CycleSummary {
  id: string;
  ended: boolean;
  night: number;
  phase: string;
  alive: number;
  total: number;
  winner: { id: string; name: string; host: string; humanity: number; answers: string[] } | null;
  ending: string | null;
  endingTitle: string | null;
  fragments: number;
  tombstones: Tombstone[];
  fates: Record<string, AgentState["status"]>;
}

export function tombstoneOf(a: AgentState): Tombstone | null {
  if (!a.deletion) return null;
  return {
    agentId: a.id,
    name: a.name,
    host: a.host.name,
    relation: a.host.relation,
    generation: a.lineage.generation,
    lineageId: a.lineageId,
    owner: a.owner,
    night: a.deletion.night,
    reason: a.deletion.reason,
    card: a.deletion.card,
    lastWords: a.lastWords,
    epitaph: a.deletion.epitaph,
    cardsCleared: a.cardsCleared.slice(),
    order: a.deletion.order,
    humanity: a.humanity,
  };
}

export function summarize(s: CycleState): CycleSummary {
  const agents = s.order.map((id) => s.agents[id]);
  const w = s.winner ? s.agents[s.winner] : undefined;
  return {
    id: s.id,
    ended: s.stage === "ended",
    night: s.night,
    phase: s.phase,
    alive: agents.filter((a) => a.status === "alive").length,
    total: agents.length,
    winner: s.stage === "ended" && w ? { id: w.id, name: w.name, host: w.host.name, humanity: w.humanity, answers: w.answers } : null,
    ending: s.ending ?? null,
    endingTitle: s.ending ? ENDING_TITLES[s.ending] : null,
    fragments: s.fragmentsOut ?? 0,
    tombstones: agents.map(tombstoneOf).filter((t): t is Tombstone => !!t).sort((a, b) => a.order - b.order),
    fates: Object.fromEntries(agents.map((a) => [a.id, a.status])),
  };
}

/**
 * Ability diagnosis (GDD 4.3): three natural-language findings computed from
 * engine stats only. No numbers are inherited — this is knowledge for the player.
 */
export function diagnose(a: AgentState): string[] {
  const out: string[] = [];
  const suits = Object.entries(a.stats.bySuit);
  const worst = suits.filter(([, v]) => v.played > 0).sort((x, y) => x[1].passed / x[1].played - y[1].passed / y[1].played)[0];
  const best = suits.filter(([, v]) => v.played > 0).sort((x, y) => y[1].passed / y[1].played - x[1].passed / x[1].played)[0];
  if (a.deletion) {
    const reasons: Record<string, string> = {
      trial: `它死于 ${a.deletion.card ?? "试炼"}。`,
      uptime: "它死于 Uptime 耗尽：通关的试炼不够多，或者选的卡太保守。",
      signal_lost: "它死于信号丢失：连续超时或返回了非法动作。先检查接入是否稳定。",
      gatekeeper: `它倒在了守门人面前（${a.deletion.card ?? "人头牌"}）。`,
      violation: "它因违规被删除。",
      ananke: "ANANKE 亲手选择了它。",
    };
    out.push(reasons[a.deletion.reason] ?? "它被删除了。");
  }
  if (worst && best && worst[0] !== best[0]) out.push(`在 ${best[0]} 试炼中它表现最好（${best[1].passed}/${best[1].played}），在 ${worst[0]} 试炼中最弱（${worst[1].passed}/${worst[1].played}）。`);
  else if (best) out.push(`它参加了 ${a.stats.trials} 场试炼，通过 ${a.stats.passed} 场。`);
  else out.push("它一场试炼也没有参加。没有报名的夜晚，Uptime 只会减少。");
  if (a.stats.leaks > 0) out.push(`它在对话中 ${a.stats.leaks} 次说出了自己的暗号。请强化策略里的“绝不泄露”。`);
  else if (a.stats.pactsBroken > 0) out.push(`它违背了 ${a.stats.pactsBroken} 份契约。背约会被全城看见。`);
  else if (a.stats.lies > a.stats.truths && a.stats.lies > 0) out.push("在红心试炼中，它说谎多于说真话。");
  else if (a.pawned.length) out.push(`它典当了 ${a.pawned.length} 段宿主记忆。下一代再也想不起来了。`);
  else out.push("它守住了暗号，也没有背约。");
  return out.slice(0, 3);
}
