import type { CycleEvent } from "@echo/engine";
import { num, rec, str, strMap } from "./ev";

/**
 * Ladder rules, spectator view: what every agent is doing right now and how it has done so far.
 * Pure function of the delivered events — the same input powers the live board and the trial index of a replay.
 */

export interface AgentLive {
  id: string;
  name: string;
  host: string;
  status: "alive" | "deleted" | "ascended" | "returned" | "archived";
  uptime: number | null;
  ladder: Record<string, number>;
  total: number;
  /** This slot: the table it sat down at (venue id), or null = resting. */
  venue: string | null;
  card: string | null;
  step: number | null;
  /** Live score on a bank card (0..1), latest answer in this slot. */
  score: number | null;
  attempts: number;
  passed: number;
  failed: number;
  bySuit: Record<string, { played: number; passed: number }>;
  last?: { card: string; outcome: string; day: number; slot: number };
  whisperCredits: number;
  whispers: Array<{ text: string; host: string; day: number; slot: number; seq: number }>;
  deletedBy?: string;
  jokerOpen: boolean;
}

export interface TableLive {
  id: string;
  day: number;
  slot: number;
  card: string;
  trial: string;
  name: string;
  players: string[];
  echoes: string[];
  gatekeeper?: string;
  ended: boolean;
  outcomes: Record<string, string>;
  summary?: string;
  scores: Record<string, number>;
  startIndex: number;
  endIndex?: number;
}

export interface LadderLiveView {
  day: number;
  slot: number;
  slotsPerDay: number;
  agents: AgentLive[];
  tables: TableLive[];
  whispers: Array<{ agentId: string; agent: string; host: string; text: string; day: number; slot: number; seq: number }>;
  feed: CycleEvent[];
  winner: string | null;
  ended: boolean;
}

const PASS = new Set(["pass", "win"]);

export function deriveLadderLive(events: CycleEvent[]): LadderLiveView {
  const v: LadderLiveView = { day: 0, slot: 0, slotsPerDay: 0, agents: [], tables: [], whispers: [], feed: [], winner: null, ended: false };
  const byId = new Map<string, AgentLive>();
  const byName = new Map<string, AgentLive>();
  const tables = new Map<string, TableLive>();
  events.forEach((e, index) => {
    const d = e.data ?? {};
    if (e.night > 0) v.day = e.night;
    switch (e.type) {
      case "cycle_start":
        v.slotsPerDay = num(rec(d.config).slotsPerDay) ?? v.slotsPerDay;
        for (const raw of (Array.isArray(d.agents) ? d.agents : []) as Array<Record<string, unknown>>) {
          const id = str(raw.id);
          if (!id) continue;
          const a: AgentLive = { id, name: str(raw.name) ?? id, host: str(raw.host) ?? "", status: "alive", uptime: num(raw.uptime) ?? null, ladder: { "♦": 0, "♣": 0, "♠": 0, "♥": 0 }, total: 0, venue: null, card: null, step: null, score: null, attempts: 0, passed: 0, failed: 0, bySuit: {}, whisperCredits: 0, whispers: [], jokerOpen: false };
          byId.set(id, a); byName.set(a.name, a); v.agents.push(a);
        }
        break;
      case "slot_open":
        v.slot = num(d.slot) ?? v.slot;
        v.slotsPerDay = num(d.slots) ?? v.slotsPerDay;
        for (const a of v.agents) { a.venue = null; a.card = null; a.step = null; a.score = null; }
        break;
      case "challenge": {
        const a = byId.get(str(d.id) ?? "");
        if (a) { a.venue = str(d.venue) ?? null; a.card = str(d.card) ?? null; a.step = num(d.step) ?? null; a.score = null; a.attempts++; }
        break;
      }
      case "trial_start": {
        const id = str(d.venue) ?? e.venue ?? `v${e.seq}`;
        tables.set(id, { id, day: e.night, slot: v.slot, card: str(d.card) ?? "", trial: str(d.trial) ?? "", name: str(d.name) ?? "", players: Array.isArray(d.players) ? (d.players as string[]) : [], echoes: [], ended: false, outcomes: {}, scores: {}, startIndex: index });
        break;
      }
      case "echo_join": {
        const t = tables.get(str(d.venue) ?? e.venue ?? "");
        if (t) t.echoes = Array.isArray(d.echoes) ? (d.echoes as string[]) : [];
        break;
      }
      case "gatekeeper_enter": {
        const t = tables.get(e.venue ?? "");
        if (t) t.gatekeeper = str(d.gatekeeper);
        break;
      }
      case "bank_answer": {
        const t = tables.get(e.venue ?? "");
        const name = str(d.agent) ?? "";
        const sc = num(d.score) ?? 0;
        if (t) t.scores[name] = Math.max(t.scores[name] ?? 0, sc);
        const a = byName.get(name);
        if (a && a.venue === e.venue) a.score = Math.max(a.score ?? 0, sc);
        break;
      }
      case "trial_end": {
        const t = tables.get(str(d.venue) ?? e.venue ?? "");
        const outcomes = strMap(d.outcomes);
        if (t) { t.ended = true; t.outcomes = outcomes; t.summary = str(d.summary) ?? e.text; t.endIndex = index; }
        const suit = t?.card.slice(0, 1) ?? "";
        for (const [name, o] of Object.entries(outcomes)) {
          const a = byName.get(name);
          if (!a) continue;
          const ok = PASS.has(o);
          if (ok) a.passed++; else a.failed++;
          const b = (a.bySuit[suit] ??= { played: 0, passed: 0 });
          b.played++; if (ok) b.passed++;
          a.last = { card: t?.card ?? "", outcome: o, day: e.night, slot: v.slot };
        }
        break;
      }
      case "ladder_step": {
        const a = byId.get(str(d.id) ?? "");
        if (a) { a.ladder[str(d.suit) ?? ""] = num(d.cleared) ?? 0; a.total = num(d.total) ?? Object.values(a.ladder).reduce((x, y) => x + y, 0); }
        break;
      }
      case "joker_unlocked": {
        const a = byId.get(str(d.id) ?? "");
        if (a) a.jokerOpen = true;
        break;
      }
      case "uptime": {
        const a = byId.get(str(d.id) ?? "");
        if (a) a.uptime = num(d.value) ?? a.uptime;
        break;
      }
      case "whisper_earned": {
        const a = byId.get(str(d.id) ?? "");
        if (a) a.whisperCredits = num(d.credits) ?? a.whisperCredits + 1;
        break;
      }
      case "host_whisper": {
        const a = byId.get(str(d.id) ?? "") ?? byName.get(str(d.agent) ?? "");
        const w = { text: str(d.text) ?? "", host: str(d.host) ?? "", day: e.night, slot: v.slot, seq: e.seq };
        if (a) { a.whispers.push(w); a.whisperCredits = num(d.credits) ?? Math.max(0, a.whisperCredits - 1); }
        v.whispers.push({ agentId: a?.id ?? "", agent: str(d.agent) ?? "", ...w });
        break;
      }
      case "agent_deleted": {
        const a = byId.get(str(d.id) ?? "");
        if (a) { a.status = "deleted"; a.uptime = 0; a.deletedBy = str(d.card) ?? str(d.reason); }
        break;
      }
      case "ladder_winner":
        v.winner = str(d.id) ?? null;
        { const a = byId.get(v.winner ?? ""); if (a) a.status = "ascended"; }
        break;
      case "cycle_end":
        v.ended = true;
        for (const raw of (Array.isArray(d.agents) ? d.agents : []) as Array<Record<string, unknown>>) {
          const a = byId.get(str(raw.id) ?? "");
          const st = str(raw.status);
          if (a && (st === "alive" || st === "deleted" || st === "ascended" || st === "returned" || st === "archived")) a.status = st;
        }
        break;
    }
    if (e.text && e.vis === "public") v.feed.push(e);
  });
  v.tables = [...tables.values()];
  if (v.feed.length > 60) v.feed = v.feed.slice(-60);
  return v;
}
