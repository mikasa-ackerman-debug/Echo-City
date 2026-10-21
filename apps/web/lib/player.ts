import type { CycleEvent } from "@echo/engine";

/**
 * Pure replay reducer: everything a page shows is derived from (events, cursor).
 * The same code powers live (cursor = end) and replay (cursor anywhere).
 */

export interface AgentLite {
  id: string;
  name: string;
  host: string;
  status: "alive" | "deleted" | "ascended" | "returned" | "archived";
  uptime: number | null;
  location?: string;
  lastWords?: string;
  epitaph?: string;
  deletedNight?: number;
  card?: string;
  reason?: string;
}

export interface VenueLite {
  id: string;
  district: string;
  card?: string;
  name?: string;
  trial?: string;
  players: string[];
  night: number;
  ended: boolean;
  outcomes?: Record<string, string>;
  rules?: string;
  /** Latest round-type event in this venue, rendered by the stage. */
  last?: CycleEvent;
  rounds: CycleEvent[];
  messages: CycleEvent[];
}

export interface View {
  night: number;
  phase: string;
  agents: Record<string, AgentLite>;
  order: string[];
  venues: VenueLite[];
  narrator: string;
  ending?: { title: string; winner: string | null; text: string };
  amendment?: string;
  districts: string[];
  map: Record<string, string[]>;
}

const ROUND_TYPES = new Set(["beauty_round", "collar_declare", "dinner_round", "lifeboat_round", "corridor_round", "elevator_answer", "hound_round", "joker_round", "joker_duel_round", "vote_execute", "vote_none", "greenhouse_round", "rule_added"]);

export function deriveView(events: CycleEvent[], cursor = events.length): View {
  const v: View = { night: 0, phase: "dawn", agents: {}, order: [], venues: [], narrator: "", districts: [], map: {} };
  const byName = (name: string) => Object.values(v.agents).find((a) => a.name === name);
  for (let i = 0; i < Math.min(cursor, events.length); i++) {
    const e = events[i];
    const d = e.data as any;
    v.night = e.night;
    v.phase = e.phase;
    switch (e.type) {
      case "cycle_start":
        v.districts = d.districts;
        v.map = d.map;
        for (const a of d.agents) {
          v.agents[a.id] = { id: a.id, name: a.name, host: a.host, status: "alive", uptime: a.uptime ?? null, location: a.location };
          v.order.push(a.id);
        }
        v.amendment = d.amendment?.text ?? v.amendment;
        v.narrator = e.text ?? "";
        break;
      case "amendment":
        v.amendment = d.text;
        break;
      case "uptime": {
        const a = v.agents[d.id];
        if (a) a.uptime = d.value;
        break;
      }
      case "move": {
        const a = byName(d.agent);
        if (a) a.location = d.to;
        break;
      }
      case "agent_deleted": {
        const a = v.agents[d.id];
        if (a) Object.assign(a, { status: "deleted", lastWords: d.last_words ?? undefined, epitaph: d.epitaph ?? undefined, deletedNight: e.night, card: d.card ?? undefined, reason: d.reason });
        v.narrator = e.text ?? v.narrator;
        break;
      }
      case "trial_start":
        v.venues.push({ id: d.venue, district: d.district, card: d.card, name: d.name, trial: d.trial, players: d.players, night: e.night, ended: false, rules: (d.rules as string) ?? "", rounds: [], messages: [] });
        v.narrator = e.text ?? v.narrator;
        break;
      case "trial_end": {
        const ven = v.venues.find((x) => x.id === d.venue);
        if (ven) Object.assign(ven, { ended: true, outcomes: d.outcomes });
        v.narrator = e.text ?? v.narrator;
        break;
      }
      case "trial_message":
      case "collar_claim": {
        const ven = v.venues.find((x) => x.id === e.venue);
        ven?.messages.push(e);
        break;
      }
      case "cycle_end":
        v.ending = { title: d.ending_title, winner: d.winner?.name ?? null, text: e.text ?? "" };
        for (const a of d.agents ?? []) if (v.agents[a.id]) v.agents[a.id].status = a.status;
        v.narrator = e.text ?? "";
        break;
      case "dawn":
      case "finale":
      case "venues_lit":
      case "quiet_night":
      case "inquiry_question":
      case "joker_cull":
      case "whisper_open":
        v.narrator = e.text ?? v.narrator;
        break;
    }
    if (ROUND_TYPES.has(e.type) && e.venue) {
      const ven = v.venues.find((x) => x.id === e.venue);
      if (ven) {
        ven.rounds.push(e);
        if (e.type !== "rule_added") ven.last = e;
      }
    }
  }
  return v;
}

/** Key moments for timeline ticks (FRONTEND 6.4). */
export function markers(events: CycleEvent[]): Array<{ index: number; glyph: string; label: string }> {
  const out: Array<{ index: number; glyph: string; label: string }> = [];
  events.forEach((e, index) => {
    const d = e.data as any;
    if (e.type === "agent_deleted") out.push({ index, glyph: "✝", label: d.agent });
    else if (e.type === "pact_broken") out.push({ index, glyph: "⚡", label: `${d.by} 背约` });
    else if (e.type === "rule_added") out.push({ index, glyph: "⟲", label: "规则追加" });
    else if (e.type === "host_whisper") out.push({ index, glyph: "✦", label: "低语" });
    else if (e.type === "cycle_end") out.push({ index, glyph: "◆", label: "结局" });
    else if (e.type === "dawn") out.push({ index, glyph: "│", label: `第 ${e.night} 夜` });
  });
  return out;
}

export function suitClass(card?: string) {
  if (!card) return "";
  if (card.includes("♦")) return "suit-diamond";
  if (card.includes("♥")) return "suit-heart";
  if (card.includes("♣")) return "suit-club";
  if (card.includes("♠")) return "suit-spade";
  return "ananke";
}

export const REASON_ZH: Record<string, string> = { trial: "试炼", uptime: "Uptime 耗尽", signal_lost: "信号丢失", gatekeeper: "守门人", violation: "违规", ananke: "ANANKE" };
export const WEEKDAY = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
