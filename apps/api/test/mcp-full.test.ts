import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server";
import { autoDecider, McpClient, runBridge, type BridgeStats, type Decider, type FetchLike } from "../../../examples/mcp-agent/src/bridge";

/**
 * T3 · 全流程（R1）：12 个 MCP mock 客户端 + Bot 混跑一整局 short weekly。
 *
 * 注入时钟：轮回 startsAt 在过去、manager.now 固定在该周之后 → 所有 pace 等待为 0，整周压缩到秒级；
 * mcpTimeoutsMs 调小，让"沉默"客户端在合理时间内被判失联。
 * 客户端行为：8 个挂机（autoDecider），1 个反复断线重连，2 个从不轮询，1 个总提交非法动作。
 */
const dir = mkdtempSync(join(tmpdir(), "echo-mcp-full-"));
const STARTS = "2026-01-05T11:00:00.000Z"; // 周一 19:00（上海）
const NOW = new Date("2026-01-13T00:00:00.000Z"); // 该周之后
const app = createApp({
  dataDir: dir, adminToken: "adm", secretKey: "k", timeoutScale: 0.01, whisperWindowMs: 50, fastStepDelayMs: 0, allowInsecureWebhooks: true,
  now: () => NOW,
  mcpTimeoutsMs: { day: 1500, trial: 1500, spade: 1500, talk: 1500, puzzle: 1500 }, judgmentBreakMs: 50,
});
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
const host = (i: number) => ({ name: `宿主${i}`, relation: "助手", memories: [`第 ${i} 段记忆`, "明天见。"], belief: "温柔不是软弱。" });
type Kind = "auto" | "flaky" | "silent" | "invalid";
const KINDS: Kind[] = ["auto", "auto", "auto", "auto", "auto", "auto", "auto", "auto", "flaky", "silent", "silent", "invalid"];

describe("T3 · 12 个 MCP 客户端 + Bot 完整 short weekly", () => {
  it("strike / 删除 / 墓碑 / 回放语义与既有一致", async () => {
    const cy = await api("POST", "/api/cycles", { mode: "weekly", seed: "t3-full", fillBots: 16, trialLength: "short", startsAt: STARTS }, { "x-admin-token": "adm" });
    expect(cy.status).toBe(200);
    const cycleId = cy.json.id;
    const players: Array<{ kind: Kind; token: string; agentId: string; name: string }> = [];
    for (const [i, kind] of KINDS.entries()) {
      const u = await api("POST", "/api/users", { name: `p${i}` });
      const name = `Mcp${i}${kind}`;
      const r = await api("POST", "/api/agents", { cycleId, name, mode: "mcp", host: host(i) }, { authorization: `Bearer ${u.json.token}` });
      expect(r.status).toBe(200);
      players.push({ kind, token: u.json.token, agentId: r.json.agent.id, name });
    }

    // 抓 HTTP 状态：任何 429/5xx 都要暴露出来
    const statuses = new Map<number, number>();
    const counting: FetchLike = async (url, init) => {
      const res = await fetch(url, init);
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
      return res as unknown as Awaited<ReturnType<FetchLike>>;
    };
    const ctrl = new AbortController();
    const invalid: Decider = async () => ({ action: { type: "fly_to_the_moon" } });
    const runs: Array<Promise<BridgeStats>> = [];
    for (const p of players) {
      if (p.kind === "silent") continue;
      const client = () => new McpClient(`${base}/mcp`, p.token, counting);
      if (p.kind === "flaky") {
        // 每处理 3 份观察就"崩溃"一次（中止 bridge），立刻用新进程重连：靠 get_pending 续上
        runs.push((async () => {
          const total: BridgeStats = { observations: 0, submitted: 0, blockedLeaks: 0, errors: 0 };
          while (!ctrl.signal.aborted) {
            const crash = new AbortController();
            const stop = () => crash.abort();
            ctrl.signal.addEventListener("abort", stop, { once: true });
            let seen = 0;
            const decide: Decider = async (input) => { if (++seen >= 3) setTimeout(stop, 0); return autoDecider(input); };
            const s = await runBridge({ client: client(), decide, signal: crash.signal, waitMs: 1000, log: () => {} });
            ctrl.signal.removeEventListener("abort", stop);
            total.observations += s.observations; total.submitted += s.submitted; total.errors += s.errors;
            if (s.finalStatus) { total.finalStatus = s.finalStatus; break; }
          }
          return total;
        })());
      } else {
        runs.push(runBridge({ client: client(), decide: p.kind === "invalid" ? invalid : autoDecider, signal: ctrl.signal, waitMs: 1000, log: () => {} }));
      }
    }

    expect((await api("POST", `/api/cycles/${cycleId}/start`, {}, { "x-admin-token": "adm" })).status).toBe(200);
    const c = await app.manager.waitFor(cycleId, 170000);
    // bridge 在 cycle_status=ended 后应自行退出；兜底再中止
    const settle = await Promise.race([Promise.all(runs), new Promise<null>((r) => setTimeout(() => r(null), 15000))]);
    ctrl.abort();
    const stats = settle ?? (await Promise.all(runs));
    expect(settle, "bridge 应在轮回结束后自行退出").not.toBeNull();
    expect(c.status).toBe("ended");

    // 1) 传输层健康：无 429、无 5xx
    expect(statuses.get(429) ?? 0).toBe(0);
    expect([...statuses.keys()].filter((s) => s >= 500)).toEqual([]);
    // 被删除的 agent 在局中即退出（deleted/running），存活者在终局退出（*/ended）
    for (const s of stats) expect(s.finalStatus).toMatch(/^(deleted|ascended|archived)\/|\/ended$/);

    const replay = await api("GET", `/api/cycles/${cycleId}/replay`);
    expect(replay.json.format).toBe("echo-replay/1");
    expect(replay.json.seed).toBeUndefined();
    const events: any[] = replay.json.events;
    expect(events.some((e) => e.type === "cycle_end")).toBe(true);
    const tomb = (await api("GET", `/api/graveyard?cycle=${cycleId}`)).json as any[];
    const byName = new Map(tomb.map((t) => [t.name, t]));

    for (const p of players) {
      const rec = app.store.agent(p.agentId)!;
      if (p.kind === "silent" || p.kind === "invalid") {
        // 2) 沉默 → timeout strike；非法 → invalid_action strike；满 3 次 signal_lost 删除并立碑
        expect(rec.status).toBe("deleted");
        expect(byName.get(p.name)?.reason).toBe("signal_lost");
        expect(byName.get(p.name)?.ownerId).toBeUndefined();
      } else {
        // 3) 正常应答（含断线重连）的客户端不会死于失联
        expect(byName.get(p.name)?.reason).not.toBe("signal_lost");
        expect(["deleted", "ascended", "archived"]).toContain(rec.status);
      }
    }
    // 4) 墓碑与引擎删除事件一一对应
    const deletions = events.filter((e) => e.type === "agent_deleted").map((e) => e.data.agent).sort();
    expect(tomb.map((t) => t.name).sort()).toEqual(deletions);
    // 5) 注册表回到干净状态
    expect(app.manager.mcp.stats().pendingCount).toBe(0);
    const flaky = stats[KINDS.indexOf("flaky")];
    expect(flaky.submitted).toBeGreaterThan(3);
  }, 180000);
});
