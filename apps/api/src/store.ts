import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostProfile, LineageEntry } from "@echo/protocol";
import type { CycleEvent, CycleState, CycleSummary } from "@echo/engine";

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

interface DbShape {
  version: 1;
  users: UserRec[];
  lineages: LineageRec[];
  agents: AgentRec[];
  cycles: CycleRec[];
  tombstones: TombstoneRec[];
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

  constructor(readonly dir: string | null) {
    this.db = { version: 1, users: [], lineages: [], agents: [], cycles: [], tombstones: [] };
    if (dir) {
      mkdirSync(join(dir, "events"), { recursive: true });
      mkdirSync(join(dir, "states"), { recursive: true });
      const f = join(dir, "db.json");
      if (existsSync(f)) this.db = { ...this.db, ...JSON.parse(readFileSync(f, "utf8")) };
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
    if (!this.dir) return;
    const f = join(this.dir, "db.json");
    atomicWrite(f, JSON.stringify(this.db, null, 1));
  }

  /* events */
  appendEvents(cycleId: string, events: CycleEvent[]) {
    if (!events.length) return;
    const cached = this.memEvents.get(cycleId);
    if (cached) cached.push(...events);
    else if (!this.dir) this.memEvents.set(cycleId, [...events]);
    if (this.dir) appendFileSync(join(this.dir, "events", `${safe(cycleId)}.ndjson`), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }

  events(cycleId: string): CycleEvent[] {
    const cached = this.memEvents.get(cycleId);
    if (cached) return cached;
    if (!this.dir) return [];
    const checkpoint = join(this.dir, "states", `${safe(cycleId)}.checkpoint.json`);
    if (existsSync(checkpoint)) {
      const list = JSON.parse(readFileSync(checkpoint, "utf8")).events as CycleEvent[];
      this.memEvents.set(cycleId, list); return list;
    }
    const f = join(this.dir, "events", `${safe(cycleId)}.ndjson`);
    const list = existsSync(f)
      ? readFileSync(f, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as CycleEvent)
      : [];
    this.memEvents.set(cycleId, list);
    return list;
  }

  /** Truncate events after a seq (used when resuming from an older snapshot). */
  truncateEvents(cycleId: string, maxSeq: number) {
    const list = this.events(cycleId).filter((e) => e.seq <= maxSeq);
    this.memEvents.set(cycleId, list);
    if (this.dir) writeFileSync(join(this.dir, "events", `${safe(cycleId)}.ndjson`), list.map((e) => JSON.stringify(e)).join("\n") + (list.length ? "\n" : ""));
  }

  /** Atomic state + full event-prefix checkpoint; authoritative on recovery.
   * Existing NDJSON/state files remain supported for legacy checkpoints. */
  private deathTimes = new Map<string, Record<string, string>>();
  checkpoint(state: CycleState, events: CycleEvent[], now = new Date().toISOString()) {
    const list = [...this.events(state.id), ...events];
    const deathTimes = { ...this.deathTimes.get(state.id) };
    for (const id of state.order) if (state.agents[id].deletion && !deathTimes[id]) deathTimes[id] = now;
    if (this.dir) {
      const f = join(this.dir, "states", `${safe(state.id)}.checkpoint.json`);
      atomicWrite(f, JSON.stringify({ state, events: list, deathTimes }));
    }
    this.deathTimes.set(state.id, deathTimes);
    this.memEvents.set(state.id, list);
    this.memStates.set(state.id, structuredClone(state));
  }

  deathTime(cycleId: string, agentId: string): string | undefined { return this.deathTimes.get(cycleId)?.[agentId]; }

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
