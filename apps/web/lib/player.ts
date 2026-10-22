import type { CycleEvent } from "@echo/engine";
import { list, num, rec, recs, str, strMap, strs } from "./ev";

/**
 * Pure replay reducer: everything a page shows is derived from (events, cursor).
 * The same code powers live (cursor = end) and replay (cursor anywhere).
 * Nothing here may peek past `cursor` — that is the spoiler contract (FRONTEND §10.3).
 */

export type AgentFate = "alive" | "deleted" | "ascended" | "returned" | "archived";

export interface AgentLite {
  id: string;
  name: string;
  host: string;
  relation?: string;
  kind?: string;
  generation: number;
  returned: boolean;
  status: AgentFate;
  uptime: number | null;
  location?: string;
  lastWords?: string;
  epitaph?: string;
  deletedNight?: number;
  deletedOrder?: number;
  card?: string;
  reason?: string;
  cardsCleared: string[];
  humanity?: number;
}

export interface VenueLite {
  id: string;
  district: string;
  card?: string;
  name?: string;
  trial?: string;
  suit?: string;
  rank?: number;
  tests?: string;
  players: string[];
  night: number;
  phase: string;
  ended: boolean;
  outcomes?: Record<string, string>;
  summary?: string;
  rules?: string;
  /** Latest round-type event in this venue, rendered by the stage. */
  last?: CycleEvent;
  rounds: CycleEvent[];
  rules_added: CycleEvent[];
  messages: CycleEvent[];
  claims: CycleEvent[];
  eliminated: string[];
  gatekeeper?: string;
  /** Full trial state, only delivered after the trial ends (vis: after_trial). */
  reveal?: Record<string, unknown>;
  startSeq: number;
  endSeq?: number;
}

export interface InquiryLine { index: number; question: string; answer?: string }

export interface View {
  night: number;
  phase: string;
  seq: number;
  agents: Record<string, AgentLite>;
  order: string[];
  venues: VenueLite[];
  /** Districts lit tonight (from venues_lit), with darkness applied. */
  lit: Array<{ id: string; district: string; capacity: number; registered: number; dark: boolean }>;
  narrator: string;
  narratorSeq: number;
  ending?: { title: string; kind: string; winner: string | null; text: string; fragments?: number };
  amendment?: string;
  districts: string[];
  map: Record<string, string[]>;
  inquiry: InquiryLine[];
  inquiryAgent?: string;
  quiet: boolean;
  finale?: "judgment" | "joker";
  whisperOpen: boolean;
  deleted: number;
}

const ROUND_TYPES = new Set(["beauty_round", "collar_declare", "dinner_round", "dinner_pairs", "lifeboat_round", "corridor_round", "elevator_answer", "hound_round", "joker_round", "joker_duel_round", "vote_execute", "vote_none", "greenhouse_round", "jack_found", "joker_cull", "joker_duel", "passphrase_leak", "hound_decoy", "beauty_cap", "collar_cap", "bank_task", "bank_answer"]);
const NARRATOR_TYPES = new Set(["dawn", "finale", "venues_lit", "quiet_night", "inquiry_question", "inquiry_start", "joker_cull", "whisper_open", "night_end", "judgment_break", "amendment", "solo_king", "rule_added", "gatekeeper_enter", "venue_dark"]);

export function deriveView(events: CycleEvent[], cursor = events.length): View {
  const v: View = { night: 0, phase: "dawn", seq: 0, agents: {}, order: [], venues: [], lit: [], narrator: "", narratorSeq: 0, districts: [], map: {}, inquiry: [], quiet: false, whisperOpen: false, deleted: 0 };
  const byName = new Map<string, AgentLite>();
  const venueOf = (id?: string) => (id ? v.venues.find((x) => x.id === id) : undefined);
  const say = (e: CycleEvent) => { if (e.text) { v.narrator = e.text; v.narratorSeq = e.seq; } };
  const end = Math.min(cursor, events.length);
  for (let i = 0; i < end; i++) {
    const e = events[i];
    const d = e.data ?? {};
    if (e.night !== v.night && e.night > 0) { v.lit = []; v.quiet = false; v.whisperOpen = false; }
    v.night = e.night;
    v.phase = e.phase;
    v.seq = e.seq;
    switch (e.type) {
      case "cycle_start": {
        v.districts = strs(d.districts);
        v.map = Object.fromEntries(Object.entries(rec(d.map)).map(([k, x]) => [k, strs(x)]));
        for (const a of recs(d.agents)) {
          const id = str(a.id);
          if (!id) continue;
          const agent: AgentLite = { id, name: str(a.name) ?? id, host: str(a.host) ?? "", relation: str(a.relation), kind: str(a.kind), generation: num(a.generation) ?? 1, returned: a.returned === true, status: "alive", uptime: num(a.uptime) ?? null, location: str(a.location), cardsCleared: [] };
          v.agents[id] = agent;
          byName.set(agent.name, agent);
          v.order.push(id);
        }
        v.amendment = str(rec(d.amendment).text) ?? v.amendment;
        say(e);
        break;
      }
      case "amendment":
        v.amendment = str(d.text) ?? v.amendment;
        say(e);
        break;
      case "uptime": {
        const a = v.agents[str(d.id) ?? ""];
        if (a) a.uptime = num(d.value) ?? a.uptime;
        break;
      }
      case "move": {
        const a = byName.get(str(d.agent) ?? "");
        if (a) a.location = str(d.to) ?? a.location;
        break;
      }
      case "venues_lit":
        v.lit = recs(d.venues).map((x) => ({ id: str(x.id) ?? "", district: str(x.district) ?? "", capacity: num(x.capacity) ?? 0, registered: 0, dark: false }));
        break;
      case "register": {
        const l = v.lit.find((x) => x.district === str(d.district));
        if (l) l.registered = num(d.count) ?? l.registered + 1;
        break;
      }
      case "venue_dark": {
        const l = v.lit.find((x) => x.district === str(d.district));
        if (l) l.dark = true;
        break;
      }
      case "quiet_night":
        v.quiet = true;
        break;
      case "finale":
        v.finale = str(d.kind) === "joker" ? "joker" : "judgment";
        break;
      case "whisper_open":
        v.whisperOpen = true;
        break;
      case "night_end":
        v.whisperOpen = false;
        break;
      case "agent_deleted": {
        const a = v.agents[str(d.id) ?? ""];
        if (a) Object.assign(a, { status: "deleted", lastWords: str(d.last_words), epitaph: str(d.epitaph), deletedNight: e.night, deletedOrder: num(d.order), card: str(d.card), reason: str(d.reason), uptime: 0 });
        v.deleted++;
        say(e);
        break;
      }
      case "trial_start":
        v.venues.push({
          id: str(d.venue) ?? e.venue ?? `v${e.seq}`, district: str(d.district) ?? "", card: str(d.card), name: str(d.name), trial: str(d.trial), suit: str(d.suit), rank: num(d.rank), tests: str(d.tests),
          players: strs(d.players), night: e.night, phase: e.phase, ended: false, rules: str(d.rules) ?? "", rounds: [], rules_added: [], messages: [], claims: [], eliminated: [], startSeq: e.seq,
        });
        say(e);
        break;
      case "trial_end": {
        const ven = venueOf(str(d.venue) ?? e.venue);
        if (ven) {
          ven.ended = true;
          ven.outcomes = strMap(d.outcomes);
          ven.summary = str(d.summary);
          ven.endSeq = e.seq;
          for (const [name, o] of Object.entries(ven.outcomes)) {
            const a = byName.get(name);
            if (a && o !== "delete" && ven.card && !a.cardsCleared.includes(ven.card)) a.cardsCleared.push(ven.card);
          }
        }
        say(e);
        break;
      }
      case "trial_reveal": {
        const ven = venueOf(str(d.venue) ?? e.venue);
        if (ven) ven.reveal = rec(d.state);
        break;
      }
      case "trial_message":
        venueOf(e.venue)?.messages.push(e);
        break;
      case "collar_claim":
        venueOf(e.venue)?.claims.push(e);
        break;
      case "rule_added":
        venueOf(e.venue)?.rules_added.push(e);
        say(e);
        break;
      case "gatekeeper_enter": {
        const ven = venueOf(e.venue);
        if (ven) ven.gatekeeper = str(d.gatekeeper);
        say(e);
        break;
      }
      case "trial_elimination": {
        const ven = venueOf(e.venue);
        const name = str(d.agent);
        if (ven && name) ven.eliminated.push(name);
        break;
      }
      case "inquiry_start":
        v.inquiryAgent = str(d.agent);
        say(e);
        break;
      case "inquiry_question":
        v.inquiry.push({ index: num(d.index) ?? v.inquiry.length, question: str(d.question) ?? "" });
        say(e);
        break;
      case "inquiry_answer": {
        const idx = num(d.index) ?? -1;
        const q = v.inquiry.find((x) => x.index === idx);
        if (q) q.answer = str(d.answer);
        else v.inquiry.push({ index: idx, question: str(d.question) ?? "", answer: str(d.answer) });
        break;
      }
      case "cycle_end": {
        const winner = rec(d.winner);
        v.ending = { title: str(d.ending_title) ?? "", kind: str(d.ending) ?? "none", winner: str(winner.name) ?? null, text: e.text ?? "", fragments: num(d.fragments) };
        for (const a of recs(d.agents)) {
          const ag = v.agents[str(a.id) ?? ""];
          if (!ag) continue;
          const st = str(a.status);
          if (st === "alive" || st === "deleted" || st === "ascended" || st === "returned" || st === "archived") ag.status = st;
          ag.humanity = num(a.humanity);
        }
        say(e);
        break;
      }
    }
    if (NARRATOR_TYPES.has(e.type) && e.type !== "rule_added") say(e);
    if (ROUND_TYPES.has(e.type) && e.venue) {
      const ven = venueOf(e.venue);
      if (ven) {
        ven.rounds.push(e);
        if (!["dinner_pairs", "beauty_cap", "collar_cap", "passphrase_leak", "hound_decoy", "jack_found", "joker_cull", "joker_duel"].includes(e.type)) ven.last = e;
      }
    }
  }
  return v;
}

export type MarkerKind = "night" | "deleted" | "broken" | "rule" | "whisper" | "ending";
export interface Marker { index: number; glyph: string; label: string; kind: MarkerKind; night: number }

/** Key moments for timeline ticks (FRONTEND 6.4): ✝ deletion · ⚡ broken pact · ⟲ rule · ✦ whisper · ◆ ending. */
export function markers(events: CycleEvent[]): Marker[] {
  const out: Marker[] = [];
  events.forEach((e, index) => {
    const d = e.data ?? {};
    if (e.type === "agent_deleted") out.push({ index, glyph: "✝", label: str(d.agent) ?? "", kind: "deleted", night: e.night });
    else if (e.type === "pact_broken") out.push({ index, glyph: "⚡", label: `${str(d.by) ?? ""} 背约`, kind: "broken", night: e.night });
    else if (e.type === "rule_added") out.push({ index, glyph: "⟲", label: "规则追加", kind: "rule", night: e.night });
    else if (e.type === "host_whisper") out.push({ index, glyph: "✦", label: "低语", kind: "whisper", night: e.night });
    else if (e.type === "cycle_end") out.push({ index, glyph: "◆", label: "结局", kind: "ending", night: e.night });
    else if (e.type === "dawn") out.push({ index, glyph: "│", label: `第 ${e.night} 夜`, kind: "night", night: e.night });
  });
  return out;
}

export function suitOf(card?: string): "diamond" | "heart" | "club" | "spade" | "joker" | undefined {
  if (!card) return undefined;
  if (card.includes("♦")) return "diamond";
  if (card.includes("♥")) return "heart";
  if (card.includes("♣")) return "club";
  if (card.includes("♠")) return "spade";
  if (/joker|鬼|🃏/i.test(card)) return "joker";
  return undefined;
}

export function suitClass(card?: string) {
  const s = suitOf(card);
  return s ? `suit-${s}` : "";
}

export const REASON_ZH: Record<string, string> = { trial: "试炼", uptime: "Uptime 耗尽", signal_lost: "信号丢失", gatekeeper: "守门人", violation: "违规", ananke: "ANANKE" };
export const WEEKDAY = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export const ENDING_GLYPH: Record<string, string> = { ember: "●", echo: "◐", necessity: "○", none: "—" };

/** Hidden-information list for a venue, only meaningful after `trial_reveal` has been delivered. */
export function revealList(v: VenueLite, key: string): unknown[] {
  return list(v.reveal?.[key]);
}
