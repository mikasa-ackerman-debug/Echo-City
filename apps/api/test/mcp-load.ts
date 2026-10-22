/**
 * T6 · MCP 负载（R6 / R8）：N 个并发 MCP agent 按真实时间长轮询 /mcp。
 *
 * 场景：一局 weekly 轮回从"现在"开始（真实时钟），N 个 bridge 持续 get_observation(wait_ms=10s)，
 * 拿到观察后模拟 1–5s 思考再提交。期间采样 HTTP 状态、打开的 socket 数、registry 统计与堆内存。
 * 结束后断言：无 429、无 5xx、无客户端异常、socket 回落（无连接泄漏）、pendingCount / polling 归零。
 *
 *   npx tsx apps/api/test/mcp-load.ts            # 默认 12 个 agent × 30 分钟
 *   MCP_LOAD_MINUTES=5 MCP_LOAD_AGENTS=12 npx tsx apps/api/test/mcp-load.ts
 *
 * vitest 中的短版见 mcp-load.test.ts。
 */
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server";
import { autoDecider, McpClient, runBridge, type BridgeStats, type Decider, type FetchLike } from "../../../examples/mcp-agent/src/bridge";

export interface LoadOptions {
  agents: number;
  durationMs: number;
  waitMs?: number;
  thinkMs?: [number, number];
  sampleMs?: number;
  log?: (msg: string) => void;
}

export interface LoadReport {
  agents: number;
  durationMs: number;
  requests: number;
  statuses: Record<string, number>;
  clientErrors: number;
  observations: number;
  submitted: number;
  /** 每用户每 60s 窗口的最大限流点数（上限 1200）。 */
  maxRatePoints: number;
  maxSockets: number;
  socketsAfter: number;
  maxPolling: number;
  pollingAfter: number;
  pendingAfter: number;
  heapStartMb: number;
  heapEndMb: number;
  samples: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runMcpLoad(opts: LoadOptions): Promise<LoadReport> {
  const log = opts.log ?? (() => {});
  const dir = mkdtempSync(join(tmpdir(), "echo-mcp-load-"));
  const app = createApp({ dataDir: dir, adminToken: "adm", secretKey: "k", allowInsecureWebhooks: true });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    (await (await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined })).json()) as any;
  const sockets = () => new Promise<number>((r) => app.server.getConnections((_e, n) => r(n ?? 0)));

  try {
    const cy = await api("POST", "/api/cycles", { mode: "weekly", seed: "t6-load", fillBots: opts.agents + 4, trialLength: "short", startsAt: new Date().toISOString() }, { "x-admin-token": "adm" });
    const statuses: Record<string, number> = {};
    // 按与服务端相同的规则统计每用户 60s 窗口限流点数（POST=10）
    const windows = new Map<string, { start: number; points: number }>();
    let maxRatePoints = 0;
    let requests = 0;
    const tokens: string[] = [];
    for (let i = 0; i < opts.agents; i++) {
      const u = await api("POST", "/api/users", { name: `load${i}` });
      await api("POST", "/api/agents", { cycleId: cy.id, name: `Load${i}`, mode: "mcp", host: { name: "宿主", relation: "助手", memories: ["记忆"], belief: "信念" } }, { authorization: `Bearer ${u.token}` });
      tokens.push(u.token);
    }
    const ctrl = new AbortController();
    const runs: Array<Promise<BridgeStats>> = tokens.map((token) => {
      const counting: FetchLike = async (url, init) => {
        const now = Date.now();
        let w = windows.get(token);
        if (!w || now - w.start >= 60000) windows.set(token, (w = { start: now, points: 0 }));
        w.points += 10;
        maxRatePoints = Math.max(maxRatePoints, w.points);
        requests++;
        const res = await fetch(url, init);
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
        return res as unknown as Awaited<ReturnType<FetchLike>>;
      };
      const [lo, hi] = opts.thinkMs ?? [1000, 5000];
      const decide: Decider = async (input) => {
        await sleep(lo + Math.random() * (hi - lo));
        return autoDecider(input);
      };
      return runBridge({ client: new McpClient(`${base}/mcp`, token, counting), decide, signal: ctrl.signal, waitMs: opts.waitMs ?? 10000, log: () => {} });
    });
    await api("POST", `/api/cycles/${cy.id}/start`, {}, { "x-admin-token": "adm" });

    const heapStartMb = process.memoryUsage().heapUsed / 2 ** 20;
    let maxSockets = 0, maxPolling = 0, samples = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < opts.durationMs) {
      await sleep(Math.min(opts.sampleMs ?? 5000, Math.max(0, opts.durationMs - (Date.now() - t0))));
      const n = await sockets();
      const st = app.manager.mcp.stats();
      maxSockets = Math.max(maxSockets, n);
      maxPolling = Math.max(maxPolling, st.polling);
      samples++;
      if (samples % 12 === 0) log(`[t6] ${((Date.now() - t0) / 60000).toFixed(1)}min req=${requests} sockets=${n} polling=${st.polling} pending=${st.pendingCount} statuses=${JSON.stringify(statuses)}`);
    }
    ctrl.abort();
    const stats = await Promise.all(runs);
    // 客户端停止后：长轮询应在 ≤10s 内全部结束；keep-alive 空闲连接在服务端 keepAliveTimeout 后关闭
    app.manager.stopAll();
    await sleep(500);
    for (const id of [...app.store.db.agents.map((a) => a.id)]) app.manager.mcp.expire(id);
    let socketsAfter = await sockets();
    for (let i = 0; i < 30 && socketsAfter > 0; i++) {
      await sleep(500);
      socketsAfter = await sockets();
    }
    const after = app.manager.mcp.stats();
    return {
      agents: opts.agents,
      durationMs: opts.durationMs,
      requests,
      statuses,
      clientErrors: stats.reduce((n, s) => n + s.errors, 0),
      observations: stats.reduce((n, s) => n + s.observations, 0),
      submitted: stats.reduce((n, s) => n + s.submitted, 0),
      maxRatePoints,
      maxSockets,
      socketsAfter,
      maxPolling,
      pollingAfter: after.polling,
      pendingAfter: after.pendingCount,
      heapStartMb: Math.round(heapStartMb),
      heapEndMb: Math.round(process.memoryUsage().heapUsed / 2 ** 20),
      samples,
    };
  } finally {
    await new Promise<void>((r) => app.server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 判定：返回不满足的条目（空数组 = 通过）。 */
export function judgeLoad(r: LoadReport): string[] {
  const bad: string[] = [];
  if (r.statuses["429"]) bad.push(`出现 429 × ${r.statuses["429"]}`);
  const fivexx = Object.keys(r.statuses).filter((s) => Number(s) >= 500);
  if (fivexx.length) bad.push(`出现 5xx：${fivexx.join(",")}`);
  if (r.clientErrors) bad.push(`客户端异常 ${r.clientErrors} 次`);
  if (r.maxRatePoints > 1200) bad.push(`限流点数峰值 ${r.maxRatePoints} > 1200`);
  if (r.maxSockets > r.agents * 3) bad.push(`socket 峰值 ${r.maxSockets} 超过 ${r.agents * 3}`);
  if (r.socketsAfter > 0) bad.push(`客户端停止后仍有 ${r.socketsAfter} 个连接`);
  if (r.pollingAfter || r.pendingAfter) bad.push(`registry 未归零 polling=${r.pollingAfter} pending=${r.pendingAfter}`);
  return bad;
}

// 直接运行（路径可能含非 ASCII 字符，需按文件路径比较而不是 URL 字符串）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const minutes = Number(process.env.MCP_LOAD_MINUTES ?? 30);
  const agents = Number(process.env.MCP_LOAD_AGENTS ?? 12);
  console.log(`[t6] ${agents} agents × ${minutes} min`);
  const report = await runMcpLoad({ agents, durationMs: minutes * 60000, log: console.log });
  console.log(JSON.stringify(report, null, 2));
  const bad = judgeLoad(report);
  console.log(bad.length ? `[t6] FAIL\n- ${bad.join("\n- ")}` : "[t6] PASS");
  process.exit(bad.length ? 1 : 0);
}
