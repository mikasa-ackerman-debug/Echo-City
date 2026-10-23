import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src";

const dir = mkdtempSync(join(tmpdir(), "echo-demo-"));
const app = createApp({ dataDir: dir, adminToken: "adm", secretKey: "k", timeoutScale: 0.01, whisperWindowMs: 0, fastStepDelayMs: 0, allowInsecureWebhooks: true });
let base = "";

beforeAll(async () => {
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(() => {
  app.manager.stopAll();
  app.server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
}
const admin = { "x-admin-token": "adm" };
const host = { name: "林晚", relation: "她的睡前陪聊助手", memories: ["下雨天适合炖菜。"], belief: "" };

describe("admin demo backdoor", () => {
  it("runs a private compressed city with the admin's own agent + mock bots, isolated from the real week", async () => {
    // a normal weekly cycle is open for registration
    const weekly = (await api("POST", "/api/cycles", { mode: "daily", fillBots: 12 }, admin)).json;

    expect((await api("POST", "/api/demo/cycles", {})).status).toBe(403);
    const demo = (await api("POST", "/api/demo/cycles", { speed: 400000, fillBots: 12 }, admin)).json;
    expect(demo.id).toMatch(/^demo-/);
    expect(demo.demo).toBe(true);

    // demo cycles never capture normal registrations, the public list or "current"
    const list = (await api("GET", "/api/cycles")).json as Array<{ id: string }>;
    expect(list.map((c) => c.id)).not.toContain(demo.id);
    expect((await api("GET", "/api/cycles/current")).json.id).toBe(weekly.id);
    const u1 = (await api("POST", "/api/users", { name: "normal" })).json.token;
    const normal = await api("POST", "/api/agents", { name: "Normal", mode: "bot", host }, { authorization: `Bearer ${u1}` });
    expect(normal.json.agent.cycleId).toBe(weekly.id);

    // the admin's own agent joins the demo explicitly
    const u2 = (await api("POST", "/api/users", { name: "demo-host" })).json.token;
    const mine = await api("POST", "/api/agents", { name: "Mine", mode: "bot", bot: { persona: "diplomat" }, host, cycleId: demo.id }, { authorization: `Bearer ${u2}` });
    expect(mine.status).toBe(200);

    const started = await api("POST", `/api/demo/cycles/${demo.id}/start`, {}, admin);
    expect(started.status).toBe(200);
    expect(started.json.agentIds).toHaveLength(12);
    expect(started.json.mode).toBe("daily");
    expect(started.json.rules).toBe("ladder");

    const done = await app.manager.waitFor(demo.id, 60000);
    expect(done.status).toBe("ended");
    expect(app.store.cycle(weekly.id)!.status).toBe("registering");

    // tombstones stay out of the public graveyard but are reachable by cycle
    const all = (await api("GET", "/api/graveyard")).json as Array<{ cycleId: string }>;
    expect(all.some((t) => t.cycleId === demo.id)).toBe(false);
    expect(((await api("GET", `/api/graveyard?cycle=${demo.id}`)).json as unknown[]).length).toBeGreaterThan(0);
    expect((await api("GET", `/api/cycles/${demo.id}/replay`)).status).toBe(200);
  }, 90000);

  it("全局模拟: the private lobby is visible by id, and 还原 stops the simulated city for good", async () => {
    const pub = (await api("POST", "/api/cycles", { mode: "daily" }, admin)).json;
    const demo = (await api("POST", "/api/demo/cycles", { speed: 2880, fillBots: 12 }, admin)).json;
    const u = (await api("POST", "/api/users", { name: "sim" })).json.token;
    await api("POST", "/api/agents", { name: "Sim", mode: "bot", bot: { persona: "diplomat" }, host, cycleId: demo.id }, { authorization: `Bearer ${u}` });
    expect((await api("GET", "/api/lobby")).json.id).toBe(pub.id);
    const dl = (await api("GET", `/api/lobby?cycle=${demo.id}`)).json;
    expect(dl.id).toBe(demo.id);
    expect(dl.seated).toBe(1);
    expect((await api("GET", `/api/lobby?cycle=${pub.id}x`)).json.id).toBe(pub.id);
    expect((await api("POST", `/api/demo/cycles/${demo.id}/start`, {}, admin)).json.agentIds).toHaveLength(12);
    expect((await api("POST", `/api/demo/cycles/${demo.id}/stop`, {})).status).toBe(403);
    expect((await api("POST", `/api/demo/cycles/${pub.id}/stop`, {}, admin)).status).toBe(404);
    const stopped = await api("POST", `/api/demo/cycles/${demo.id}/stop`, {}, admin);
    expect(stopped.json.status).toBe("aborted");
    await new Promise((r) => setTimeout(r, 300));
    expect(app.store.cycle(demo.id)!.status).toBe("aborted");
    expect(app.store.db.agents.filter((a) => a.cycleId === demo.id).every((a) => a.status !== "alive")).toBe(true);
    expect(app.store.cycle(pub.id)!.status).toBe("registering");
  }, 30000);

  it("the lobby opens the city as soon as every seat is taken, then a new lobby takes registrations", async () => {
    const lobby = (await api("POST", "/api/cycles", { mode: "daily", capacity: 3 }, admin)).json;
    expect(lobby.capacity).toBe(3);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = (await api("POST", "/api/users", { name: `seat${i}` })).json.token;
      const r = await api("POST", "/api/agents", { cycleId: lobby.id, name: `Seat${i}`, mode: "bot", bot: { persona: "guardian" }, host }, { authorization: `Bearer ${t}` });
      expect(r.status).toBe(200);
      ids.push(r.json.agent.id);
      const view = (await api("GET", "/api/lobby?x=" + i)).json;
      if (i < 2 && view.id === lobby.id) expect(view.seated).toBe(i + 1);
    }
    expect(app.store.cycle(lobby.id)!.status).toBe("running");
    const t4 = (await api("POST", "/api/users", { name: "late" })).json.token;
    const late = await api("POST", "/api/agents", { cycleId: lobby.id, name: "Late", mode: "bot", host }, { authorization: `Bearer ${t4}` });
    expect(late.status).toBe(409);
    // house bots carry a lobby profile into the city
    const state = app.store.loadState(lobby.id)!;
    expect(state.config.mode).toBe("ladder");
    expect(state.agents[ids[0]].profile?.logic).toBeTypeOf("number");
    app.manager.stopAll();
  });

  it("house bots only fill a lobby that has a real player, and never past its capacity", async () => {
    const c = app.manager.createCycle({ mode: "daily", capacity: 4, fillBots: 12, fillAfterMs: 0 });
    expect(c.fillAt).toBeUndefined();
    expect(app.manager.fillLobbyIfDue(c.id)).toBe(false); // empty lobby: nobody to keep company
    const t = (await api("POST", "/api/users", { name: "solo" })).json.token;
    expect((await api("POST", "/api/agents", { cycleId: c.id, name: "Solo", mode: "bot", bot: { persona: "gambler" }, host }, { authorization: `Bearer ${t}` })).status).toBe(200);
    expect(app.store.cycle(c.id)!.fillAt).toBeTypeOf("string");
    expect(app.manager.fillLobbyIfDue(c.id)).toBe(true);
    expect(app.store.db.agents.filter((a) => a.cycleId === c.id)).toHaveLength(4);
    app.manager.stopAll();
  });
});
