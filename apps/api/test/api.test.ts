import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src";
import { nextMonday1900, stageTime } from "../src/schedule";

const dir = mkdtempSync(join(tmpdir(), "echo-api-"));
const app = createApp({ dataDir: dir, adminToken: "adm", secretKey: "k", timeoutScale: 0.01, whisperWindowMs: 200, fastStepDelayMs: 0, allowInsecureWebhooks: true });
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

const host = { name: "林晚", relation: "她的睡前陪聊助手", memories: ["下雨天适合炖菜。", "我的名字是她的猫。", "明天见。"], belief: "温柔不是软弱。" };

describe("schedule", () => {
  it("computes Monday 19:00 Asia/Shanghai", () => {
    const m = nextMonday1900(new Date("2026-10-21T12:00:00Z")); // Wed
    expect(m.toISOString()).toBe("2026-10-26T11:00:00.000Z");
    expect(stageTime(m, 6, "trial_start")!.toISOString()).toBe("2026-10-31T13:00:00.000Z"); // Sat 21:00
  });
});

describe("api", () => {
  let token = "";
  let cycleId = "";
  let agentId = "";

  it("creates users and requires auth", async () => {
    const r = await api("POST", "/api/users", { name: "tonny" });
    expect(r.status).toBe(200);
    token = r.json.token;
    expect((await api("GET", "/api/me")).status).toBe(401);
    expect((await api("GET", "/api/me", undefined, { authorization: `Bearer ${token}` })).json.user.name).toBe("tonny");
  });

  it("only admins create cycles", async () => {
    expect((await api("POST", "/api/cycles", { mode: "fast" })).status).toBe(403);
    const r = await api("POST", "/api/cycles", { mode: "fast", seed: "api-test", fillBots: 8, trialLength: "short" }, { "x-admin-token": "adm" });
    expect(r.status).toBe(200);
    cycleId = r.json.id;
  });

  it("registers an agent with a new lineage and hides secrets", async () => {
    const auth = { authorization: `Bearer ${token}` };
    const bad = await api("POST", "/api/agents", { name: "Moth", mode: "hosted", host, hosted: { baseUrl: "ftp://x", model: "m", apiKey: "sk" } }, auth);
    expect(bad.status).toBe(400);
    const r = await api("POST", "/api/agents", { cycleId, name: "Moth", mode: "bot", bot: { persona: "diplomat" }, host, strategy: "守住暗号" }, auth);
    expect(r.status).toBe(200);
    agentId = r.json.agent.id;
    const again = await api("POST", "/api/agents", { cycleId, name: "Moth2", mode: "bot", host }, auth);
    expect(again.status).toBe(409);
    const me = await api("GET", "/api/me", undefined, auth);
    expect(JSON.stringify(me.json)).not.toContain("apiKey");
    expect(me.json.lineages).toHaveLength(1);
  });

  it("runs the cycle, records tombstones and extends the lineage", async () => {
    const start = await api("POST", `/api/cycles/${cycleId}/start`, {}, { "x-admin-token": "adm" });
    expect(start.status).toBe(200);
    const c = await app.manager.waitFor(cycleId, 60000);
    expect(c.status).toBe("ended");
    const view = await api("GET", `/api/cycles/${cycleId}`);
    expect(view.json.summary.ending).toBeTruthy();
    expect(view.json.roster.length).toBe(8);
    const events = await api("GET", `/api/cycles/${cycleId}/events`);
    expect(events.json.some((e: any) => e.type === "cycle_end")).toBe(true);
    const grave = await api("GET", `/api/graveyard?cycle=${cycleId}`);
    expect(grave.json.length).toBeGreaterThan(0);
    expect(grave.json[0].ownerId).toBeUndefined();
    const me = await api("GET", "/api/me", undefined, { authorization: `Bearer ${token}` });
    expect(me.json.lineages[0].generations).toHaveLength(1);
    const replay = await api("GET", `/api/cycles/${cycleId}/replay`);
    expect(replay.json.format).toBe("echo-replay/1");
  });

  it("letters: only the owner, once, within 24h", async () => {
    const me = await api("GET", "/api/me", undefined, { authorization: `Bearer ${token}` });
    const gen = me.json.lineages[0].generations[0];
    if (gen.fate !== "deleted") return; // our bot survived this seed; nothing to write
    const other = (await api("POST", "/api/users", { name: "x" })).json.token;
    expect((await api("POST", `/api/tombstones/${agentId}/letter`, { text: "hi" }, { authorization: `Bearer ${other}` })).status).toBe(404);
    expect((await api("POST", `/api/tombstones/${agentId}/letter`, { text: "下一个你，记得她。" }, { authorization: `Bearer ${token}` })).status).toBe(200);
    expect((await api("POST", `/api/tombstones/${agentId}/letter`, { text: "again" }, { authorization: `Bearer ${token}` })).status).toBe(409);
  });

  it("streams events over SSE", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/cycles/${cycleId}/stream`, { signal: ctrl.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("event: cycle_start")) text += new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    expect(text).toContain("id: 1");
  });

  it("validates host whispers through a live window", async () => {
    const r = await api("POST", "/api/cycles", { mode: "fast", seed: "whisper", fillBots: 4, trialLength: "short" }, { "x-admin-token": "adm" });
    const u = (await api("POST", "/api/users", { name: "w" })).json.token;
    const auth = { authorization: `Bearer ${u}` };
    const reg = await api("POST", "/api/agents", { cycleId: r.json.id, name: "Wisp", mode: "bot", bot: { persona: "guardian" }, host }, auth);
    await api("POST", `/api/cycles/${r.json.id}/start`, {}, { "x-admin-token": "adm" });
    let saw = false;
    for (let i = 0; i < 400 && !saw; i++) {
      const w = (await api("GET", `/api/cycles/${r.json.id}/whisper`, undefined, auth)).json;
      if (w.open && w.agents.includes(reg.json.agent.id)) {
        expect((await api("POST", `/api/cycles/${r.json.id}/whisper`, { agentId: reg.json.agent.id, text: "去♦" }, auth)).status).toBe(400);
        expect((await api("POST", `/api/cycles/${r.json.id}/whisper`, { agentId: reg.json.agent.id, text: "别怕。" }, auth)).status).toBe(200);
        saw = true;
      } else if ((await api("GET", `/api/cycles/${r.json.id}`)).json.status === "ended") break;
      await new Promise((res) => setTimeout(res, 10));
    }
    await app.manager.waitFor(r.json.id);
    const ev = await api("GET", `/api/cycles/${r.json.id}/events`, undefined, auth);
    if (saw) expect(ev.json.some((e: any) => e.type === "host_whisper" && e.data.text === "别怕。")).toBe(true);
  });
});
