import { describe, expect, it } from "vitest";
import { judgeLoad, runMcpLoad } from "./mcp-load";

/** T6 短版（CI）：12 个并发 MCP agent 真实时间长轮询 25s。完整 30 分钟版：npx tsx apps/api/test/mcp-load.ts */
describe("T6 · MCP 负载（短版）", () => {
  it("12 并发长轮询：无 429/5xx、无连接泄漏、registry 归零", async () => {
    const r = await runMcpLoad({ agents: 12, durationMs: 25000, sampleMs: 1000 });
    expect(judgeLoad(r)).toEqual([]);
    expect(r.observations).toBeGreaterThanOrEqual(12); // 第一轮白天每人至少一份观察
    expect(r.submitted).toBe(r.observations);
    expect(r.maxPolling).toBeGreaterThan(0);
  }, 90000);
});
