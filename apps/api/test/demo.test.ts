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
  it("runs a private compressed week with the admin's own agent + mock bots, isolated from the real week", async () => {
    // a normal weekly cycle is open for registration
    const weekly = (await api("POST", "/api/cycles", { mode: "weekly", fillBots: 12 }, admin)).json;

    expect((await api("POST", "/api/demo/cycles", {})).status).toBe(403);
    const demo = (await api("POST", "/api/demo/cycles", { speed: 20000, fillBots: 12 }, admin)).json;
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
    expect(started.json.mode).toBe("weekly");

    const done = await app.manager.waitFor(demo.id, 60000);
    expect(done.status).toBe("ended");
    expect(app.store.cycle(weekly.id)!.status).toBe("registering");

    // tombstones stay out of the public graveyard but are reachable by cycle
    const all = (await api("GET", "/api/graveyard")).json as Array<{ cycleId: string }>;
    expect(all.some((t) => t.cycleId === demo.id)).toBe(false);
    expect(((await api("GET", `/api/graveyard?cycle=${demo.id}`)).json as unknown[]).length).toBeGreaterThan(0);
    expect((await api("GET", `/api/cycles/${demo.id}/replay`)).status).toBe(200);
  }, 90000);
});
