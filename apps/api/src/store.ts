import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostProfile, LineageEntry } from "@echo/protocol";
import type { CycleEvent, CycleState, CycleSummary } from "@echo/engine";
import type { RoundState, CardRoom } from "./rooms";

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface UserRec {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  /** Banned from registering until this cycle id has passed (GDD 14.3). */
  bannedCycle?: string;
}

export interface LineageGeneration extends LineageEntry {
  agentId: string;
  cycleId: string;
  letter?: string;
  diagnosis?: string[];
  epitaph?: string;
  humanity?: number;
}

export interface LineageRec {
  id: string;
  ownerId: string;
  /** The host as it is *now*: pawned memories are gone for good. */
  host: HostProfile;
  generations: LineageGeneration[];
  createdAt: string;
}

export type AgentMode = "hosted" | "webhook" | "bot";

export interface AgentRec {
  id: string;
  ownerId: string;
  lineageId: string;
  cycleId: string;
  name: string;
  mode: AgentMode;
  strategy: string;
  hosted?: { baseUrl: string; model: string; apiKey: string };
  webhook?: { url: string; secret: string };
  bot?: { persona: string };
  /** LLM persona: system prompt for autonomous decisions. */
  persona?: string;
  /** Card selection preference (suit/dimension hints). */
  preference?: string;
  /** Cumulative score across trials. */
  score?: number;
  returned?: boolean;
  humanity?: number;
  generation?: number;
  status: "registered" | "alive" | "deleted" | "ascended" | "returned" | "archived";
  createdAt: string;
}

export type CycleStatus = "registering" | "running" | "ended" | "aborted";

export interface CycleRec {
  id: string;
  seed: string;
  status: CycleStatus;
  mode: "weekly" | "fast";
  /** ISO time of Monday 19:00 (weekly) or creation (fast). */
  startsAt: string;
  createdAt: string;
  endedAt?: string;
  fillBots: number;
  trialLength: "standard" | "short";
  summary?: CycleSummary;
  /** Agent ids that have entered the roster. */
  agentIds: string[];
  /** Admin demo cycle: hidden from public lists/graveyard, weekly schedule compressed by `demoSpeed`. */
  demo?: boolean;
  /** Virtual seconds per real second for demo cycles (e.g. 1440 → one city day per real minute). */
  demoSpeed?: number;
}

export interface TombstoneRec {
  agentId: string;
  cycleId: string;
  ownerId?: string;
  lineageId?: string;
  name: string;
  host: string;
  relation: string;
  generation: number;
  night: number;
  reason: string;
  card?: string;
  lastWords: string;
  epitaph?: string;
  cardsCleared: string[];
  order: number;
  deletedAt: string;
  letter?: string;
  letterAt?: string;
  diagnosis: string[];
}

/* ---------------- trial records ---------------- */

export interface TrialParticipant {
  id: string;
  name: string;
  passed: boolean;
  score?: number;
  survivalRounds?: number;
  notable?: string;
  /** Points earned in this trial (passed=100+, failed=0-30). */
  points?: number;
}

export interface TrialRecord {
  id: string;
  /** Card identity from the compendium. */
  card: string;
  cardName: string;
  suit: "♦" | "♥" | "♣" | "♠" | "JOKER";
  rank: number;
  /** Evaluation dimension. */
  dimension: string;
  dimensionName: string;
  dimensionWeights?: Record<string, number>;
  level: number;
  playerCount: number;
  flavor?: string;
  /** Generated script metadata. */
  script: {
    title: string;
    summary: string;
    path: string;
  };
  participants: TrialParticipant[];
  status: "running" | "completed" | "aborted";
  createdAt: string;
  completedAt?: string;
  notes?: string;
}

interface DbShape {
  version: 1;
  users: UserRec[];
  lineages: LineageRec[];
  agents: AgentRec[];
  cycles: CycleRec[];
  tombstones: TombstoneRec[];
  trialRecords: TrialRecord[];
  rounds: RoundState[];
  rooms: CardRoom[];
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

/**
 * Small JSON-file store. The whole relational part lives in memory and is
 * flushed atomically (write temp + rename); events are append-only NDJSON
 * per cycle; engine states are snapshotted per cycle for crash recovery.
 * Swap for Postgres later behind the same methods.
 */
export class Store {
  db: DbShape;
  private flushTimer: NodeJS.Timeout | null = null;
  private memEvents = new Map<string, CycleEvent[]>();
  private cacheOrder = new Map<string, true>();
  private eventPins = new Map<string, number>();

  constructor(readonly dir: string | null, readonly historyCacheLimit = 16) {
    if (!Number.isSafeInteger(historyCacheLimit) || historyCacheLimit < 0) throw new Error("Invalid history cache limit");
    this.db = { version: 1, users: [], lineages: [], agents: [], cycles: [], tombstones: [], trialRecords: [], rounds: [], rooms: [] };
    if (dir) {
      mkdirSync(join(dir, "events"), { recursive: true });
      mkdirSync(join(dir, "states"), { recursive: true });
      const f = join(dir, "db.json");
      if (existsSync(f)) this.db = { version: 1, users: [], lineages: [], agents: [], cycles: [], tombstones: [], trialRecords: [], rounds: [], rooms: [], ...JSON.parse(readFileSync(f, "utf8")) };
    }
  }

  /** Debounced flush. */
  save() {
    if (!this.dir) return;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 50);
  }

  flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.trimCache();
    if (!this.dir) return;
    const f = join(this.dir, "db.json");
    atomicWrite(f, JSON.stringify(this.db, null, 1));
  }

  /** Subscription pins are reference-counted; running cycles are pinned by status. */
  pinEvents(cycleId: string): () => void {
    this.eventPins.set(cycleId, (this.eventPins.get(cycleId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.eventPins.get(cycleId) ?? 1) - 1;
      if (count) this.eventPins.set(cycleId, count);
      else this.eventPins.delete(cycleId);
      this.trimCache();
    };
  }

  private touch(cycleId: string) {
    this.cacheOrder.delete(cycleId);
    this.cacheOrder.set(cycleId, true);
    this.trimCache();
  }

  private trimCache() {
    // Without a disk backing these maps are the database, not disposable caches.
    if (!this.dir) return;
    const historical = [...this.cacheOrder.keys()].filter((id) => this.cycle(id)?.status !== "running" && !this.eventPins.has(id));
    for (const id of historical.slice(0, Math.max(0, historical.length - this.historyCacheLimit))) {
      this.cacheOrder.delete(id);
      this.memEvents.delete(id);
      this.memStates.delete(id);
      this.deathTimes.delete(id);
    }
  }

  /* events */
  appendEvents(cycleId: string, events: CycleEvent[]) {
    if (!events.length) return;
    // Write first: if this history is evicted, its next read must include the tail.
    if (this.dir) appendFileSync(join(this.dir, "events", `${safe(cycleId)}.ndjson`), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const cached = this.memEvents.get(cycleId);
    if (cached) this.memEvents.set(cycleId, mergeEvents(cached, events));
    else if (!this.dir) this.memEvents.set(cycleId, mergeEvents([], events));
    if (this.memEvents.has(cycleId)) this.touch(cycleId);
  }

  events(cycleId: string): CycleEvent[] {
    const cached = this.memEvents.get(cycleId);
    if (cached) { this.touch(cycleId); return cached; }
    if (!this.dir) return [];
    const checkpoint = join(this.dir, "states", `${safe(cycleId)}.checkpoint.json`);
    const saved = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, "utf8")) : null;
    const f = join(this.dir, "events", `${safe(cycleId)}.ndjson`);
    const tail: CycleEvent[] = existsSync(f)
      ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CycleEvent)
      : [];
    // A checkpoint is authoritative for its entire prefix, including truncations.
    const list = saved ? mergeEvents(saved.events, tail.filter((e) => e.seq > saved.state.seq)) : mergeEvents([], tail);
    if (saved) this.deathTimes.set(cycleId, saved.deathTimes ?? {});
    this.memEvents.set(cycleId, list);
    this.touch(cycleId);
    return list;
  }

  /** Truncate events after a seq (used when resuming from an older snapshot). */
  truncateEvents(cycleId: string, maxSeq: number) {
    const list = this.events(cycleId).filter((e) => e.seq <= maxSeq);
    if (this.dir) {
      const checkpoint = join(this.dir, "states", `${safe(cycleId)}.checkpoint.json`);
      if (existsSync(checkpoint)) {
        const saved = JSON.parse(readFileSync(checkpoint, "utf8"));
        atomicWrite(checkpoint, JSON.stringify({ ...saved, events: list }));
      }
      writeFileSync(join(this.dir, "events", `${safe(cycleId)}.ndjson`), list.map((e) => JSON.stringify(e)).join("\n") + (list.length ? "\n" : ""));
    }
    this.memEvents.set(cycleId, list);
    this.touch(cycleId);
  }

  /** Atomic state + full event-prefix checkpoint; authoritative on recovery.
   * Existing NDJSON/state files remain supported for legacy checkpoints. */
  private deathTimes = new Map<string, Record<string, string>>();
  checkpoint(state: CycleState, events: CycleEvent[], now = new Date().toISOString()) {
    const list = mergeEvents(this.events(state.id), events).filter((e) => e.seq <= state.seq);
    const previous = this.dir ? join(this.dir, "states", `${safe(state.id)}.checkpoint.json`) : null;
    const deathTimes: Record<string, string> = { ...(this.deathTimes.get(state.id) ?? (previous && existsSync(previous) ? JSON.parse(readFileSync(previous, "utf8")).deathTimes : {})) };
    for (const id of state.order) if (state.agents[id].deletion && !deathTimes[id]) deathTimes[id] = now;
    if (this.dir) {
      const f = join(this.dir, "states", `${safe(state.id)}.checkpoint.json`);
      atomicWrite(f, JSON.stringify({ state, events: list, deathTimes }));
    }
    this.deathTimes.set(state.id, deathTimes);
    this.memEvents.set(state.id, list);
    if (!this.dir) this.memStates.set(state.id, structuredClone(state));
    this.touch(state.id);
  }

  deathTime(cycleId: string, agentId: string): string | undefined {
    if (!this.deathTimes.has(cycleId) && this.dir) {
      const checkpoint = join(this.dir, "states", `${safe(cycleId)}.checkpoint.json`);
      if (!existsSync(checkpoint)) return undefined;
      const saved = JSON.parse(readFileSync(checkpoint, "utf8"));
      const time = saved.deathTimes?.[agentId] as string | undefined;
      this.deathTimes.set(cycleId, saved.deathTimes ?? {});
      this.touch(cycleId);
      return time;
    }
    const time = this.deathTimes.get(cycleId)?.[agentId];
    if (this.deathTimes.has(cycleId)) this.touch(cycleId);
    return time;
  }

  /* engine state snapshots */
  private memStates = new Map<string, CycleState>();
  saveState(state: CycleState) {
    if (!this.dir) {
      this.memStates.set(state.id, state);
      return;
    }
    const f = join(this.dir, "states", `${safe(state.id)}.json`);
    writeFileSync(f + ".tmp", JSON.stringify(state));
    renameSync(f + ".tmp", f);
  }

  loadState(cycleId: string): CycleState | null {
    if (!this.dir) return this.memStates.get(cycleId) ?? null;
    const checkpoint = join(this.dir, "states", `${safe(cycleId)}.checkpoint.json`);
    if (existsSync(checkpoint)) {
      const saved = JSON.parse(readFileSync(checkpoint, "utf8"));
      this.deathTimes.set(cycleId, saved.deathTimes ?? {});
      this.touch(cycleId);
      return saved.state as CycleState;
    }
    const f = join(this.dir, "states", `${safe(cycleId)}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as CycleState) : null;
  }

  /* lookups */
  user(id: string) {
    return this.db.users.find((u) => u.id === id);
  }
  cycle(id: string) {
    return this.db.cycles.find((c) => c.id === id);
  }
  lineage(id: string) {
    return this.db.lineages.find((l) => l.id === id);
  }
  agent(id: string) {
    return this.db.agents.find((a) => a.id === id);
  }
  trialRecord(id: string) {
    return this.db.trialRecords.find((t) => t.id === id);
  }
}

function mergeEvents(prefix: CycleEvent[], added: CycleEvent[]): CycleEvent[] {
  const bySeq = new Map<number, CycleEvent>();
  for (const event of prefix) bySeq.set(event.seq, event);
  // Existing checkpoint events win if a producer retries a batch.
  for (const event of added) if (!bySeq.has(event.seq)) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function safe(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid cycle storage identifier");
  return id;
}

function atomicWrite(path: string, data: string) {
  const temporary = path + ".tmp";
  const fd = openSync(temporary, "w", 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
  const directory = openSync(join(path, ".."), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
