import { afterEach, describe, expect, it, vi } from "vitest";
import { McpDriver, RuleBot, type ObservationRegistry } from "@echo/agents";
import { advance, buildObservation, createCycle, type CycleState } from "@echo/engine";
import { collectResponses } from "@echo/runner";
import type { Observation } from "@echo/protocol";
import { MCP_TIMEOUTS_MS, mcpScaleFor } from "../src/manager";
import { MCP_MAX_WAIT_MS, MemoryObservationRegistry } from "../src/registry";

const host = { name: "林晚", relation: "助手", memories: ["记忆"], belief: "温柔" };
const roster = Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, name: `Agent${i}`, host }));
/** 推进到第一个"等待 agent"的状态（第 1 夜白天）。 */
const waitingState = (): CycleState => advance(createCycle({ id: "mcp-t", seed: "mcp-seed", roster, config: { trialLength: "short" } })).state;
const obsFor = (s: CycleState, id: string) => buildObservation(s, id);
const quiet = () => {};

afterEach(() => vi.useRealTimers());

describe("T1 · McpDriver × ObservationRegistry 契约", () => {
  it("submit 即 resolve；同一 request_id 重复提交返回 consumed，只结算一次", async () => {
    const reg = new MemoryObservationRegistry(quiet);
    const s = waitingState();
    const obs = obsFor(s, "a0");
    const p = new McpDriver(reg, "a0").decide(obs, undefined, { deadlineMs: 60000 });
    expect(reg.pending("a0")?.requestId).toBe(obs.request_id);
    // 驻留观察就是 buildObservation 的原对象，传输层不加工
    expect(reg.pending("a0")?.observation).toBe(obs);
    expect(reg.submit("a0", obs.request_id, { action: { type: "rest" } })).toEqual({ ok: true });
    expect(reg.submit("a0", obs.request_id, { action: { type: "rest" } })).toEqual({ ok: false, reason: "consumed" });
    expect(reg.submit("a0", "nope", {})).toEqual({ ok: false, reason: "unknown_request" });
    expect(await p).toEqual({ action: { type: "rest" } });
    expect(reg.stats().pendingCount).toBe(0);
  });

  it("他人 agent 不能代交：提交按 agentId 隔离", async () => {
    const reg = new MemoryObservationRegistry(quiet);
    const obs = obsFor(waitingState(), "a0");
    const p = new McpDriver(reg, "a0").decide(obs, undefined, { deadlineMs: 50 });
    expect(reg.submit("a1", obs.request_id, { action: { type: "rest" } })).toEqual({ ok: false, reason: "unknown_request" });
    expect(await p).toBeNull();
  });

  it("deadline 到期 resolve(null)，之后提交返回 expired", async () => {
    vi.useFakeTimers();
    const reg = new MemoryObservationRegistry(quiet);
    const obs = obsFor(waitingState(), "a0");
    const p = new McpDriver(reg, "a0").decide(obs, undefined, { deadlineMs: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p).toBeNull();
    expect(reg.submit("a0", obs.request_id, { action: { type: "rest" } })).toEqual({ ok: false, reason: "expired" });
  });

  it("runner abort resolve(null)；已中止的 signal 不登记观察", async () => {
    const reg = new MemoryObservationRegistry(quiet);
    const obs = obsFor(waitingState(), "a0");
    const ctrl = new AbortController();
    const p = new McpDriver(reg, "a0").decide(obs, ctrl.signal, { deadlineMs: 60000 });
    ctrl.abort();
    expect(await p).toBeNull();
    expect(reg.pending("a0")).toBeNull();
    expect(await new McpDriver(reg, "a0").decide(obs, AbortSignal.abort(), { deadlineMs: 60000 })).toBeNull();
    expect(reg.pending("a0")).toBeNull();
  });

  it("同一 agent 重复注册：新观察 takeover，旧的 resolve(null) 并记 expired", async () => {
    const reg = new MemoryObservationRegistry(quiet);
    const s = waitingState();
    const first = obsFor(s, "a0");
    const second = { ...first, request_id: `${first.request_id}-2` } as Observation;
    const d = new McpDriver(reg, "a0");
    const p1 = d.decide(first, undefined, { deadlineMs: 60000 });
    const p2 = d.decide(second, undefined, { deadlineMs: 60000 });
    expect(await p1).toBeNull();
    expect(reg.submit("a0", first.request_id, { action: { type: "rest" } })).toEqual({ ok: false, reason: "expired" });
    expect(reg.submit("a0", second.request_id, { action: { type: "rest" } })).toEqual({ ok: true });
    expect(await p2).toEqual({ action: { type: "rest" } });
  });

  it("decide 永不抛错：注册表异常 → null", async () => {
    const broken: ObservationRegistry = { observe: () => { throw new Error("boom"); }, submit: () => ({ ok: true }), expire: () => {} };
    await expect(new McpDriver(broken, "a0").decide(obsFor(waitingState(), "a0"))).resolves.toBeNull();
  });

  it("客户端断线 60s 不取消等待：重连 get_pending 取回同一 request_id 并成功提交（R7）", async () => {
    vi.useFakeTimers();
    const reg = new MemoryObservationRegistry(quiet);
    const obs = obsFor(waitingState(), "a0");
    const p = new McpDriver(reg, "a0").decide(obs, undefined, { deadlineMs: MCP_TIMEOUTS_MS.day });
    // 第一次长轮询拿到观察后"断线"（取消请求）
    const poll = new AbortController();
    expect((await reg.wait("a0", 10000, poll.signal)).entry?.requestId).toBe(obs.request_id);
    poll.abort();
    await vi.advanceTimersByTimeAsync(60000);
    expect(reg.pending("a0")?.requestId).toBe(obs.request_id);
    expect(reg.submit("a0", obs.request_id, { action: { type: "rest" } })).toEqual({ ok: true });
    expect(await p).toEqual({ action: { type: "rest" } });
  });

  it("长轮询：wait_ms 被夹到 10s；观察到达时立即唤醒；多端轮询后者接管（R6）", async () => {
    vi.useFakeTimers();
    const reg = new MemoryObservationRegistry(quiet);
    const t0 = Date.now();
    const w = reg.wait("a0", 60000);
    await vi.advanceTimersByTimeAsync(MCP_MAX_WAIT_MS);
    expect((await w).entry).toBeNull();
    expect(Date.now() - t0).toBe(MCP_MAX_WAIT_MS);

    const older = reg.wait("a0", 10000);
    const newer = reg.wait("a0", 10000);
    expect(await older).toEqual({ entry: null, takenOver: true });
    const obs = obsFor(waitingState(), "a0");
    const p = new McpDriver(reg, "a0").decide(obs, undefined, { deadlineMs: 60000 });
    expect((await newer).entry?.requestId).toBe(obs.request_id);
    reg.expire("a0");
    expect(await p).toBeNull();
  });
});

describe("T5 · per-agent 超时（FR-5 / R1）", () => {
  /** 让 a0 走 MCP、其余为 Bot；fakeClient 在 delayMs 后提交。返回 a0 的结算结果与引擎推进后的 strike。 */
  async function round(timeout: "day" | "spade", delayMs: number) {
    vi.useFakeTimers();
    const reg = new MemoryObservationRegistry(quiet);
    const s = waitingState();
    if (s.waiting.kind !== "agents") throw new Error("expected agents");
    // 只改 runner 的计时类别（引擎规则不动），模拟 ♠ 回合的 spade 超时
    for (const r of s.waiting.requests) r.timeout = timeout;
    const drivers = { a0: new McpDriver(reg, "a0"), a1: new RuleBot("guardian"), a2: new RuleBot("gambler") };
    const scale = mcpScaleFor((id) => id === "a0", 0.01);
    const started = Date.now();
    const collecting = collectResponses(s, drivers, scale);
    let botsDoneAt = 0;
    void collecting.then(() => (botsDoneAt = Date.now() - started));
    await vi.advanceTimersByTimeAsync(delayMs);
    const pending = reg.pending("a0");
    if (pending) reg.submit("a0", pending.requestId, { action: { type: "rest" } });
    await vi.advanceTimersByTimeAsync(MCP_TIMEOUTS_MS[timeout] + 1000);
    const out = await collecting;
    const next = advance(s, { responses: out });
    return { response: out.a0, strikes: next.state.agents.a0.strikes, timeoutEvent: next.events.some((e) => e.type === "timeout"), botsDoneAt, pending: !!pending };
  }

  it("day 回合延迟 90s 提交：正常结算，不记 strike", async () => {
    const r = await round("day", 90000);
    expect(r.pending).toBe(true);
    expect(r.response).toEqual({ action: { type: "rest" } });
    expect(r.strikes).toBe(0);
  });

  it("spade 回合延迟 60s 提交（引擎基准仅 5s）：正常结算", async () => {
    const r = await round("spade", 60000);
    expect(r.response).toEqual({ action: { type: "rest" } });
    expect(r.strikes).toBe(0);
  });

  it("超过 MCP deadline（day 300s）才提交：resolve(null)，strike +1 并有 timeout 事件", async () => {
    const r = await round("day", MCP_TIMEOUTS_MS.day + 1000);
    expect(r.pending).toBe(false);
    expect(r.response).toBeNull();
    expect(r.strikes).toBe(1);
    expect(r.timeoutEvent).toBe(true);
  });

  it("倍率按 (agent, 类别) 计算：mcp 拿到绝对预算，Bot 与 host 保持全局倍率", () => {
    const f = mcpScaleFor((id) => id === "m", 0.01);
    expect(20000 * f("m", "day", 20000)).toBe(300000);
    expect(15000 * f("m", "trial", 15000)).toBe(240000);
    expect(5000 * f("m", "spade", 5000)).toBe(120000);
    expect(15000 * f("m", "talk", 15000)).toBe(60000);
    expect(f("m", "host", 90000)).toBe(0.01);
    expect(f("bot", "spade", 5000)).toBe(0.01);
  });

  it("observation.deadline_ms 保持引擎设计值（buildObservation 逐字段一致），实际预算经 ctx 下发", async () => {
    const seen: Array<{ obs: number; ctx?: number }> = [];
    const spy = { kind: "spy", decide: async (o: Observation, _s?: AbortSignal, ctx?: { deadlineMs: number }) => (seen.push({ obs: o.deadline_ms, ctx: ctx?.deadlineMs }), null) };
    const s = waitingState();
    await collectResponses(s, { a0: spy, a1: spy, a2: spy }, mcpScaleFor((id) => id === "a0", 0.01));
    expect(seen).toContainEqual({ obs: 20000, ctx: 300000 });
    expect(seen).toContainEqual({ obs: 20000, ctx: 200 });
  });
});
