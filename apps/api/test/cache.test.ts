import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { advance, createCycle, type CycleEvent, type CycleState } from "@echo/engine";
import { Store, type CycleRec } from "../src/store";
import { CycleManager } from "../src/manager";
import { Sealer } from "../src/crypto";

const host = { name: "Host", relation: "assistant", memories: ["memory"], belief: "belief" };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function store(limit = 16) {
  const dir = mkdtempSync(join(tmpdir(), "echo-cache-"));
  dirs.push(dir);
  return new Store(dir, limit);
}
function cycle(store: Store, id: string, status: CycleRec["status"] = "ended") {
  const rec: CycleRec = { id, seed: id, status, mode: "fast", startsAt: "", createdAt: "", fillBots: 0, trialLength: "short", agentIds: [] };
  store.db.cycles.push(rec);
  return rec;
}
function initial(id: string) {
  return createCycle({ id, seed: id, roster: [0, 1].map((i) => ({ id: `a${i}`, name: `A${i}`, host })) });
}
const event = (seq: number): CycleEvent => ({ seq, type: "public", vis: "public", night: 1, data: {} } as CycleEvent);
// Inspect actual retained maps rather than a diagnostic count that could hide leaks.
function caches(store: Store) {
  return store as unknown as { memEvents: Map<string, CycleEvent[]>; memStates: Map<string, CycleState>; deathTimes: Map<string, Record<string, string>> };
}
function manager(store: Store) {
  return new CycleManager(store, { timeoutScale: 0.01, whisperWindowMs: 0, fastStepDelayMs: 0, allowInsecureWebhooks: true, sealer: new Sealer("secret") });
}

describe("bounded historical storage cache", () => {
  it("bounds many completed histories to 16, pins running histories, and reloads exact disk checkpoints", () => {
    const s = store();
    cycle(s, "running", "running");
    const running = advance(initial("running"));
    s.checkpoint(running.state, running.events);
    for (let i = 0; i < 40; i++) {
      const id = `done-${i}`;
      cycle(s, id);
      const result = advance(initial(id));
      s.checkpoint(result.state, result.events);
      expect(caches(s).memEvents.size).toBeLessThanOrEqual(17);
      expect(caches(s).deathTimes.size).toBeLessThanOrEqual(17);
      expect(caches(s).memStates.size).toBe(0);
      expect(caches(s).memEvents.has("running")).toBe(true);
    }
    expect(caches(s).memEvents.has("done-0")).toBe(false);
    const expected = advance(initial("done-0"));
    expect(s.events("done-0")).toEqual(expected.events);
    expect(s.loadState("done-0")).toEqual(expected.state);
    s.flush();
    const reopened = new Store(s.dir);
    expect(reopened.events("done-0")).toEqual(expected.events);
    expect(reopened.loadState("done-0")).toEqual(expected.state);
    expect(s.events("running")).toEqual(running.events);
  });

  it("touches accessors and evicts state metadata with the least recently used history", () => {
    const s = store(2);
    for (const id of ["a", "b"]) { cycle(s, id); s.checkpoint(initial(id), []); }
    s.events("a");
    cycle(s, "c"); s.checkpoint(initial("c"), []);
    expect([...caches(s).memEvents.keys()].sort()).toEqual(["a", "c"]);
    expect(caches(s).deathTimes.has("b")).toBe(false);
    s.loadState("a");
    cycle(s, "d"); s.checkpoint(initial("d"), []);
    expect(caches(s).memEvents.has("a")).toBe(true);
    expect(caches(s).memEvents.has("c")).toBe(false);
  });

  it("pins subscribed completed histories until the last subscriber disconnects", () => {
    const s = store(1); const m = manager(s);
    cycle(s, "subscribed"); s.checkpoint(initial("subscribed"), []);
    const first = m.subscribe("subscribed", undefined, () => {});
    const second = m.subscribe("subscribed", undefined, () => {});
    for (let i = 0; i < 20; i++) { const id = `done-${i}`; cycle(s, id); s.checkpoint(initial(id), []); }
    expect(caches(s).memEvents.has("subscribed")).toBe(true);
    expect(caches(s).memEvents.size).toBe(2);
    first(); first();
    expect(caches(s).memEvents.has("subscribed")).toBe(true);
    second();
    expect(caches(s).memEvents.size).toBe(1);
    expect(caches(s).memEvents.has("subscribed")).toBe(false);
  });

  it("does not lose appended tails or duplicate retried batches after eviction and reopening", () => {
    const s = store(1);
    cycle(s, "target");
    const state = initial("target"); state.seq = 1;
    s.checkpoint(state, [event(1)]);
    cycle(s, "other"); s.checkpoint(initial("other"), []);
    expect(caches(s).memEvents.has("target")).toBe(false);
    s.appendEvents("target", [event(2)]);
    expect(s.events("target").map((e) => e.seq)).toEqual([1, 2]);
    state.seq = 2;
    s.checkpoint(state, [event(2)]);
    s.checkpoint(initial("other"), []); // evict before retry
    s.checkpoint(state, [event(2)]);
    s.checkpoint(state, []);
    s.flush();
    const reopened = new Store(s.dir, 1);
    expect(reopened.events("target").map((e) => e.seq)).toEqual([1, 2]);
    expect(reopened.loadState("target")?.seq).toBe(2);
    s.appendEvents("target", [event(3)]);
    s.truncateEvents("target", 2);
    s.checkpoint(initial("other"), []);
    expect(s.events("target").map((e) => e.seq)).toEqual([1, 2]);
    expect(new Store(s.dir).events("target").map((e) => e.seq)).toEqual([1, 2]);
  });

  it("drops finalized live states and serves coherent snapshots and replay on demand", () => {
    const s = store(); const m = manager(s);
    const internals = m as unknown as { live: Map<string, CycleState>; finalize: (rec: CycleRec, state: CycleState) => void };
    for (let i = 0; i < 25; i++) {
      const id = `final-${i}`; const rec = cycle(s, id, "running");
      const result = advance(initial(id));
      s.checkpoint(result.state, result.events);
      internals.live.set(id, result.state);
      internals.finalize(rec, result.state);
      expect(internals.live.size).toBe(0);
      expect(caches(s).memEvents.size).toBeLessThanOrEqual(16);
    }
    expect(m.liveSnapshot("final-0")?.stage).toBe(s.loadState("final-0")?.stage);
    expect(m.replay("final-0").format).toBe("echo-replay/1");
  });

  it("releases subscription pins on initial delivery and publish callback failures", () => {
    const s = store(1); const m = manager(s);
    cycle(s, "failed"); s.appendEvents("failed", [event(1)]);
    expect(() => m.subscribe("failed", undefined, () => { throw new Error("closed"); })).toThrow("closed");
    const unsubscribe = m.subscribe("failed", undefined, () => { throw new Error("closed"); }, 1);
    s.appendEvents("failed", [event(2)]);
    (m as unknown as { publish: (id: string) => void }).publish("failed");
    unsubscribe();
    cycle(s, "next"); s.checkpoint(initial("next"), []);
    expect(caches(s).memEvents.has("failed")).toBe(false);
  });

  it("preserves original death timestamps across complete eviction and checkpoint retries", () => {
    const s = store(0); cycle(s, "death");
    const state = initial("death");
    state.agents.a0.status = "deleted";
    state.agents.a0.deletion = { night: 1, reason: "trial", order: 1 };
    s.checkpoint(state, [], "2026-01-01T00:00:00Z");
    expect(caches(s).memEvents.size).toBe(0);
    expect(caches(s).deathTimes.size).toBe(0);
    s.checkpoint(state, [], "2026-01-02T00:00:00Z");
    expect(s.deathTime("death", "a0")).toBe("2026-01-01T00:00:00Z");
    expect(caches(s).deathTimes.size).toBe(0);
  });

  it("keeps in-memory-only histories authoritative instead of evicting irreplaceable data", () => {
    const s = new Store(null, 1);
    for (let i = 0; i < 20; i++) { const id = `memory-${i}`; cycle(s, id); s.checkpoint(initial(id), []); s.appendEvents(id, [event(1)]); }
    expect(s.events("memory-0").map((e) => e.seq)).toEqual([1]);
    expect(s.loadState("memory-0")?.id).toBe("memory-0");
  });
});
