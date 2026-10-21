import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { advance, createCycle, type CycleEvent } from "@echo/engine";
import { createApp } from "../src/server";
import { Store } from "../src/store";
import { ApiError } from "../src/manager";
import { nextMonday1900 } from "../src/schedule";
import type { AddressInfo } from "node:net";

const host = { name: "Host", relation: "assistant", memories: ["memory"], belief: "belief" };
const event = (seq: number, type: string, vis = "public", extra = {}): CycleEvent => ({ seq, type, vis, night: 1, data: {}, ...extra } as CycleEvent);

describe("backend recovery and delivery", () => {
  it("keeps engine seq immutable while delivering late-visible events after REST/SSE cursors", () => {
    const app = createApp({ dataDir: null, adminToken: "admin", secretKey: "secret" });
    const c = app.manager.createCycle({ mode: "fast" });
    app.store.appendEvents(c.id, [event(1, "public"), event(2, "thought", "after_night"), event(3, "public")]);
    expect(app.manager.visibleEvents(c.id).map((e) => [e.seq, e.deliveryCursor])).toEqual([[1, 1], [3, 2]]);
    app.store.appendEvents(c.id, [event(4, "night_end")]);
    expect(app.manager.visibleEvents(c.id, undefined, 2).map((e) => [e.seq, e.deliveryCursor])).toEqual([[2, 3], [4, 4]]);
    const delivered: number[] = [];
    const unsubscribe = app.manager.subscribe(c.id, undefined, (events) => delivered.push(...events.map((e) => e.seq)), 2);
    expect(delivered).toEqual([2, 4]); unsubscribe();
  });
  it("recovers state and events from one atomic checkpoint, not stale snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "echo-checkpoint-"));
    try {
      const store = new Store(dir);
      const initial = createCycle({ id: "checkpoint", seed: "private", roster: [0, 1].map((i) => ({ id: `a${i}`, name: `A${i}`, host })) });
      store.checkpoint(initial, []);
      const result = advance(initial);
      store.checkpoint(result.state, result.events);
      store.saveState(initial); // emulate old separately-written snapshot after crash
      const recovered = new Store(dir);
      expect(recovered.loadState(initial.id)?.seq).toBe(result.state.seq);
      expect(recovered.events(initial.id).map((e) => e.seq)).toEqual(result.events.map((e) => e.seq));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("releases missing-checkpoint lineages and isolates malformed recovery", () => {
    const app = createApp({ dataDir: null, adminToken: "admin", secretKey: "secret" });
    const c = app.manager.createCycle({ mode: "fast" });
    const user = { id: "u", name: "User", tokenHash: "", createdAt: "" };
    const agent = app.manager.register(user, { cycleId: c.id, name: "Agent", mode: "bot", host }).agent;
    c.status = "running"; agent.status = "alive";
    app.manager.resumeAll();
    expect(c.status).toBe("aborted"); expect(agent.status).toBe("archived");
    const next = app.manager.createCycle({ mode: "fast" });
    expect(() => app.manager.register(user, { cycleId: next.id, lineageId: agent.lineageId, name: "Next", mode: "bot" })).not.toThrow();
  });
  it("creates tombstones at death, preserves early letters during finalize and closes exactly at 24h", () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const app = createApp({ dataDir: null, adminToken: "a", secretKey: "k", now: () => now });
    const c = app.manager.createCycle({ mode: "fast" });
    const user = { id: "owner", name: "Owner", tokenHash: "", createdAt: "" };
    const rec = app.manager.register(user, { cycleId: c.id, name: "Agent", mode: "bot", host }).agent;
    const state = createCycle({ id: c.id, seed: c.seed, roster: [{ id: rec.id, name: rec.name, host, owner: user.id, lineageId: rec.lineageId }, { id: "probe", name: "Probe", host }] });
    state.agents[rec.id].status = "deleted";
    state.agents[rec.id].deletion = { night: 1, reason: "trial", order: 1 };
    app.store.checkpoint(state, [], now.toISOString());
    (app.manager as any).recordDeaths(c, state);
    expect(app.store.db.tombstones).toHaveLength(1);
    expect(app.store.db.tombstones[0].deletedAt).toBe(now.toISOString());
    app.manager.writeLetter(user, rec.id, "Remember");
    now = new Date("2026-01-02T00:00:00Z");
    (app.manager as any).finalize(c, state);
    expect(app.store.db.tombstones).toHaveLength(1);
    expect(app.store.lineage(rec.lineageId)!.generations[0].letter).toBe("Remember");
    delete app.store.db.tombstones[0].letter;
    expect(() => app.manager.writeLetter(user, rec.id, "Late")).toThrow("24");
  });

  it("caps registration at 96 and rejects engine-reserved names before starting", () => {
    const app = createApp({ dataDir: null, adminToken: "a", secretKey: "k" });
    const c = app.manager.createCycle({ mode: "fast", fillBots: 200 });
    expect(c.fillBots).toBe(96);
    const user = (i: number) => ({ id: `u${i}`, name: "User", tokenHash: "", createdAt: "" });
    for (const name of ["ANANKE", "myANANKE", "system", "abc:xyz", "a\nname"])
      expect(() => app.manager.register(user(100), { cycleId: c.id, name, mode: "bot", host })).toThrow();
    for (let i = 0; i < 96; i++) app.manager.register(user(i), { cycleId: c.id, name: `Agent${i}`, mode: "bot", host });
    expect(() => app.manager.register(user(96), { cycleId: c.id, name: "Overflow", mode: "bot", host })).toThrow("96");
  });

  it("skips underfilled due weeks, releases lineages, but retries transient and early failures", () => {
    let now = new Date("2026-10-26T10:59:30Z");
    const app = createApp({ dataDir: null, adminToken: "a", secretKey: "k", now: () => now });
    const c = app.manager.createCycle({ mode: "weekly", startsAt: "2026-10-26T11:00:00Z", fillBots: 0 });
    const user = { id: "owner", name: "Owner", tokenHash: "", createdAt: "" };
    const rec = app.manager.register(user, { cycleId: c.id, name: "Agent", mode: "bot", host }).agent;
    expect(() => app.manager.start(c.id)).toThrow("2");
    const error = new ApiError(409, "至少需要 2 个 Agent");
    expect(app.manager.skipFailedScheduledStart(c.id, error)).toBe(false);
    now = new Date("2026-10-26T11:00:00Z");
    expect(app.manager.skipFailedScheduledStart(c.id, new Error("disk failure"))).toBe(false);
    expect(app.manager.skipFailedScheduledStart(c.id, error)).toBe(true);
    expect(c.status).toBe("aborted"); expect(rec.status).toBe("archived");
    const next = app.manager.createCycle({ mode: "weekly", startsAt: nextMonday1900(now).toISOString() });
    expect(new Date(next.startsAt).getTime()).toBeGreaterThan(now.getTime());
    expect(() => app.manager.register(user, { cycleId: next.id, lineageId: rec.lineageId, name: "Next", mode: "bot" })).not.toThrow();
  });

  it("rejects stream tickets exactly at their expiry using an isolated clock", async () => {
    let now = new Date("2026-10-26T11:00:00Z");
    const app = createApp({ dataDir: null, adminToken: "a", secretKey: "k", now: () => now });
    const c = app.manager.createCycle({ mode: "fast" });
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    try {
      const user = await (await fetch(base + "/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "User" }) })).json() as any;
      const issued = await (await fetch(base + "/api/stream-ticket", { method: "POST", headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" }, body: JSON.stringify({ cycleId: c.id }) })).json() as any;
      now = new Date(now.getTime() + 60000);
      const response = await fetch(`${base}/api/cycles/${c.id}/stream?ticket=${issued.ticket}`);
      expect(response.status).toBe(401); await response.arrayBuffer();
    } finally { app.server.closeAllConnections(); await new Promise<void>((resolve) => app.server.close(() => resolve())); }
  });

  it("fails closed in production and rejects invalid numeric configuration", () => {
    expect(() => createApp({ dataDir: null, adminToken: "a", secretKey: "k", timeoutScale: NaN })).toThrow();
    const previous = process.env.NODE_ENV; process.env.NODE_ENV = "production";
    try { expect(() => createApp({ dataDir: null, adminToken: "dev-admin", secretKey: "dev-secret" })).toThrow("Production"); }
    finally { process.env.NODE_ENV = previous; }
  });
});
