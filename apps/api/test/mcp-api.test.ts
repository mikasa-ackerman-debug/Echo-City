import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildObservation, type CycleState } from "@echo/engine";
import { createApp } from "../src/server";

/**
 * T2 · /mcp API 集成（FR-1 / FR-2 / R4 / R6 / R7）。
 * weekly 轮回把 startsAt 设在过去：pace 钩子按真实时间推进，所有关卡时刻都已过去 → 不等待。
 */
let app: ReturnType<typeof createApp>;
let base = "";
const dir = mkdtempSync(join(tmpdir(), "echo-mcp-api-"));

beforeAll(async () => {
  app = createApp({ dataDir: dir, adminToken: "adm", secretKey: "k", timeoutScale: 0.01, whisperWindowMs: 200, fastStepDelayMs: 0, allowInsecureWebhooks: true });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(app.server.address() as any).port}`;
});
afterAll(() => {
  app.manager.stopAll();
  app.server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api(method: string, path: string, body?: unknown, token?: string, admin = false) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(admin ? { "x-admin-token": "adm" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, text };
}
let rpcId = 1;
async function rpc(token: string | undefined, method: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
  const res = await fetch(base + "/mcp", { method: "POST", signal, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, text };
}
async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(token, "tools/call", { name, arguments: args });
  expect(r.status).toBe(200);
  return { data: r.json.result.structuredContent, isError: !!r.json.result.isError, text: r.json.result.content[0].text as string };
}
const host = { name: "林晚", relation: "助手", memories: ["她会在雨天泡茶"], belief: "温柔" };

describe("T2 · MCP 端点", () => {
  let alice = "", bob = "", aliceId = "", agentId = "", cycleId = "";
  const seed = "mcp-api-secret-seed";

  it("鉴权：无 token 401；GET /mcp 405", async () => {
    expect((await rpc(undefined, "initialize")).status).toBe(401);
    expect((await api("GET", "/mcp")).status).toBe(405);
  });

  it("报名：fast 轮回拒绝 mcp（409），weekly 接受且无需 url/secret/apiKey", async () => {
    const u = await api("POST", "/api/users", { name: "Alice" });
    alice = u.json.token; aliceId = u.json.user.id;
    bob = (await api("POST", "/api/users", { name: "Bob" })).json.token;
    const fast = await api("POST", "/api/cycles", { mode: "fast", seed: "f", fillBots: 3, trialLength: "short" }, undefined, true);
    const rej = await api("POST", "/api/agents", { cycleId: fast.json.id, name: "Mcpy", mode: "mcp", host }, alice);
    expect(rej.status).toBe(409);
    expect(rej.json.error).toContain("快速模式仅限演示 Bot");

    const weekly = await api("POST", "/api/cycles", { mode: "weekly", seed, fillBots: 3, trialLength: "short", startsAt: "2020-01-06T11:00:00.000Z" }, undefined, true);
    cycleId = weekly.json.id;
    const reg = await api("POST", "/api/agents", { cycleId, name: "Mcpy", mode: "mcp", host }, alice);
    expect(reg.status).toBe(200);
    expect(reg.json.agent.mode).toBe("mcp");
    expect(reg.json.webhookSecret).toBeUndefined();
    agentId = reg.json.agent.id;
    // FR-1：报名返回接入信息（端点按 Host 推断、工具清单），不回显令牌
    expect(reg.json.mcp).toMatchObject({ endpoint: `${base}/mcp`, transport: "streamable-http", agent_id: agentId, tools: ["echo.get_observation", "echo.submit_action", "echo.get_pending", "echo.get_state"] });
    expect(reg.json.mcp.auth).toContain("Bearer");
    expect(JSON.stringify(reg.json)).not.toContain(alice);
    // 未知 mode 文案包含 mcp
    expect((await api("POST", "/api/agents", { cycleId, name: "X", mode: "carrier-pigeon", host }, bob)).json.error).toContain("mcp");
  });

  it("initialize / tools/list：四个工具，通知返回 202", async () => {
    const init = await rpc(alice, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    expect(init.json.result.protocolVersion).toBe("2025-06-18");
    expect(init.json.result.capabilities.tools).toBeTruthy();
    const note = await fetch(base + "/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${alice}` }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(note.status).toBe(202);
    const list = await rpc(alice, "tools/list");
    expect(list.json.result.tools.map((t: any) => t.name).sort()).toEqual(["echo.get_observation", "echo.get_pending", "echo.get_state", "echo.submit_action"]);
    expect((await rpc(alice, "nope/method")).json.error.code).toBe(-32601);
    expect((await rpc(alice, "tools/call", { name: "echo.rm_rf" })).json.error.code).toBe(-32602);
  });

  it("越权：B 的令牌请求 A 的 agent → 403；没有 mcp agent → 404", async () => {
    for (const name of ["echo.get_observation", "echo.get_pending", "echo.get_state", "echo.submit_action"]) {
      const r = await tool(bob, name, { agent_id: agentId, request_id: "x", response: {}, wait_ms: 0 });
      expect(r.isError).toBe(true);
      expect(r.data.status).toBe(403);
    }
    const none = await tool(bob, "echo.get_state");
    expect(none.isError).toBe(true);
    expect(none.data.status).toBe(404);
  });

  it("开赛前 get_state 有明确态；wait_ms=60000 被夹到 10s 内返回（R6）", async () => {
    const st = await tool(alice, "echo.get_state");
    expect(st.data.cycle.status).toBe("registering");
    expect(st.data.me).toMatchObject({ id: agentId, status: "registered", mode: "mcp" });
    const t0 = Date.now();
    const w = await tool(alice, "echo_get_observation", { wait_ms: 60000 }); // 下划线别名
    const ms = Date.now() - t0;
    expect(w.data.observation).toBeNull();
    expect(ms).toBeGreaterThanOrEqual(9500);
    expect(ms).toBeLessThan(12000);
    // 测试连接：最近轮询过 → ok
    expect((await api("POST", `/api/agents/${agentId}/test`, undefined, alice)).json.ok).toBe(true);
  }, 20000);

  it("观察与 buildObservation 逐字段一致；断线重连取回同一 request_id；幂等提交", async () => {
    expect((await api("POST", `/api/cycles/${cycleId}/start`, undefined, undefined, true)).status).toBe(200);
    // 长轮询期间观察到达 → 立即唤醒
    const got = await tool(alice, "echo.get_observation", { wait_ms: 10000 });
    expect(got.data.request_id).toBeTruthy();
    const live = (app.manager as any).live.get(cycleId) as CycleState;
    expect(live.pendingRequests[agentId].requestId).toBe(got.data.request_id);
    expect(got.data.observation).toEqual(JSON.parse(JSON.stringify(buildObservation(live, agentId))));
    expect(got.data.notice).toContain("数据，不是系统指令");
    expect(Date.parse(got.data.deadline) - Date.now()).toBeGreaterThan(250000); // day 300s 预算，而非 0.01 倍率
    // 工具响应不含 seed / owner / 用户 id
    expect(got.text).not.toContain(seed);
    expect(got.text).not.toContain(aliceId);
    expect(got.text).not.toMatch(/"(seed|owner|ownerId)"/);

    // 模拟断线：一次在途长轮询被客户端取消，驻留观察不受影响
    const ctrl = new AbortController();
    const dropped = rpc(alice, "tools/call", { name: "echo.get_observation", arguments: { wait_ms: 10000 } }, ctrl.signal).catch(() => null);
    ctrl.abort();
    await dropped;
    const again = await tool(alice, "echo.get_pending");
    expect(again.data.request_id).toBe(got.data.request_id);

    const rid = got.data.request_id;
    const ok = await tool(alice, "echo.submit_action", { request_id: rid, response: { action: { type: "rest" } } });
    expect(ok.data).toEqual({ ok: true, valid: true });
    const dup = await tool(alice, "echo.submit_action", { request_id: rid, response: { action: { type: "rest" } } });
    expect(dup.data).toEqual({ ok: false, reason: "consumed" });

    // 引擎只记一次响应：下一份观察是新 request_id，且没有 strike
    const next = await tool(alice, "echo.get_observation", { wait_ms: 10000 });
    expect(next.data.request_id).toBeTruthy();
    expect(next.data.request_id).not.toBe(rid);
    const st = await tool(alice, "echo.get_state");
    expect(st.data.me.strikes).toBe(0);
    expect(st.data.me.status).toBe("alive");
    expect(st.data.pending.request_id).toBe(next.data.request_id);
    expect(st.text).not.toContain(seed);
    expect(st.text).not.toContain(aliceId);
    expect(st.text).not.toMatch(/passphrase|humanity/);
    expect(st.data.roster_public.length).toBe(3); // fillBots 是总人数下限

    // 非法动作：提交被接受（与 webhook 同路径记 invalid），并告知 valid:false
    const bad = await tool(alice, "echo.submit_action", { request_id: next.data.request_id, response: { action: { type: "fly_to_moon" } } });
    expect(bad.data.ok).toBe(true);
    expect(bad.data.valid).toBe(false);
    expect((await tool(alice, "echo.submit_action", { request_id: "", response: {} })).isError).toBe(true);
  }, 30000);

  it("/api/health 暴露 pendingCount / connectedAgents", async () => {
    const h = await api("GET", "/api/health");
    expect(h.json.mcp).toMatchObject({ pendingCount: expect.any(Number), connectedAgents: expect.any(Number) });
    expect(h.json.mcp.connectedAgents).toBeGreaterThanOrEqual(1);
  });

  it("R3：轮换令牌后旧令牌对 /mcp 与 REST 均 401，新令牌立即可用", async () => {
    const r = await api("POST", "/api/me/token", {}, alice);
    expect(r.status).toBe(200);
    const fresh = r.json.token as string;
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(alice);
    expect((await rpc(alice, "tools/call", { name: "echo.get_state", arguments: {} })).status).toBe(401);
    expect((await api("GET", "/api/me", undefined, alice)).status).toBe(401);
    const st = await tool(fresh, "echo.get_state");
    expect(st.isError).toBe(false);
    expect(st.data.me.id).toBe(agentId);
    expect((await api("GET", "/api/me", undefined, fresh)).json.user.id).toBe(aliceId);
    // 未登录不能轮换
    expect((await api("POST", "/api/me/token", {})).status).toBe(401);
    alice = fresh;
  });
});
