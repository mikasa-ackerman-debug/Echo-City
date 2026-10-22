import type { AgentResponse } from "@echo/protocol";
import type { ObservationRegistry, PendingObservation, SubmitResult } from "@echo/agents";

/** get_observation 长轮询硬上限：server.requestTimeout 为 15s，留 5s 余量（R6）。 */
export const MCP_MAX_WAIT_MS = 10000;
/** 视为"在线"的最近轮询窗口。 */
const CONNECTED_WINDOW_MS = 60000;
/** 每个 agent 保留的已结算 request_id 数（用于 consumed / expired 幂等应答）。 */
const HISTORY_PER_AGENT = 32;
const MAX_AGENTS_TRACKED = 4096;

interface Slot {
  entry: PendingObservation;
  resolve: (value: AgentResponse | null) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort: () => void;
  done?: boolean;
}

export interface WaitResult {
  entry: PendingObservation | null;
  /** 同一 agent 的新轮询接管了本次等待（多端 takeover，后者居上）。 */
  takenOver?: boolean;
}

interface Waiter {
  done: (r: WaitResult) => void;
}

/**
 * 进程内存版 ObservationRegistry（FR-4）。
 *
 * ⚠ 单实例约束（R5）：待决观察只存在于本进程内存，api 不可多副本部署——
 * 多副本会导致观察投递错位、提交丢失。v2 外置 Redis 时实现 observe/submit/expire 三操作即可平滑替换。
 *
 * 语义：
 *  - 每个 agent 至多一条待决观察；新观察到达时旧的作废（resolve null），即 takeover；
 *  - 读取（pending / wait）不消费观察：断线重连可反复取回同一 request_id；
 *  - submit 按 request_id 幂等：命中待决 → 结算；已结算 → consumed；已过期 → expired；
 *  - deadline 到期 / runner 中止 → resolve(null)，引擎记一次 strike。
 */
export class MemoryObservationRegistry implements ObservationRegistry {
  private slots = new Map<string, Slot>();
  private history = new Map<string, Map<string, "consumed" | "expired">>();
  private waiters = new Map<string, Waiter>();
  private seen = new Map<string, number>();

  constructor(private log: (msg: string) => void = (msg) => console.warn(`[mcp] ${msg}`)) {}

  /* ---------------- 写操作（驱动侧） ---------------- */

  observe(input: Omit<PendingObservation, "issuedAt">, signal?: AbortSignal): Promise<AgentResponse | null> {
    return new Promise((resolve) => {
      const prev = this.slots.get(input.agentId);
      if (prev) {
        this.log(`agent ${input.agentId} 的待决观察 ${prev.entry.requestId} 被新观察 ${input.requestId} 接管`);
        this.finish(prev, null, "expired");
      }
      if (signal?.aborted) {
        this.remember(input.agentId, input.requestId, "expired");
        return resolve(null);
      }
      const entry: PendingObservation = { ...input, issuedAt: Date.now() };
      const slot: Slot = {
        entry,
        resolve,
        signal,
        onAbort: () => this.finish(slot, null, "expired"),
        timer: setTimeout(() => this.finish(slot, null, "expired"), Math.max(0, entry.deadline - Date.now())),
      };
      slot.timer.unref?.();
      signal?.addEventListener("abort", slot.onAbort, { once: true });
      this.slots.set(entry.agentId, slot);
      this.waiters.get(entry.agentId)?.done({ entry });
    });
  }

  submit(agentId: string, requestId: string, response: unknown): SubmitResult {
    const slot = this.slots.get(agentId);
    if (slot && slot.entry.requestId === requestId) {
      if (!response || typeof response !== "object" || Array.isArray(response)) return { ok: false, reason: "invalid_response" };
      this.finish(slot, response as AgentResponse, "consumed");
      return { ok: true };
    }
    return { ok: false, reason: this.history.get(agentId)?.get(requestId) ?? "unknown_request" };
  }

  expire(agentId: string, requestId?: string): void {
    const slot = this.slots.get(agentId);
    if (slot && (!requestId || slot.entry.requestId === requestId)) this.finish(slot, null, "expired");
  }

  /* ---------------- 读操作（MCP 工具侧） ---------------- */

  /** 立即返回驻留观察（get_pending），不等待、不消费。 */
  pending(agentId: string): PendingObservation | null {
    this.touch(agentId);
    return this.slots.get(agentId)?.entry ?? null;
  }

  /** 长轮询（get_observation）：最多等待 MCP_MAX_WAIT_MS；同一 agent 新轮询接管旧轮询。 */
  wait(agentId: string, ms: number, signal?: AbortSignal): Promise<WaitResult> {
    const now = this.pending(agentId);
    const budget = Math.max(0, Math.min(MCP_MAX_WAIT_MS, Number.isFinite(ms) ? ms : 0));
    if (now || budget === 0 || signal?.aborted) return Promise.resolve({ entry: now });
    return new Promise((resolve) => {
      const prev = this.waiters.get(agentId);
      if (prev) {
        this.log(`agent ${agentId} 的长轮询被另一端接管`);
        prev.done({ entry: null, takenOver: true });
      }
      const onAbort = () => w.done({ entry: null });
      const timer = setTimeout(() => w.done({ entry: null }), budget);
      const w: Waiter = {
        done: (r) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          if (this.waiters.get(agentId) === w) this.waiters.delete(agentId);
          this.touch(agentId);
          resolve(r);
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.set(agentId, w);
    });
  }

  /** 最近一次轮询时间（epoch ms），用于"测试连接"。 */
  lastSeen(agentId: string): number | undefined {
    return this.waiters.has(agentId) ? Date.now() : this.seen.get(agentId);
  }

  /** 可观测性（FR-4）：供 /api/health 与日志。 */
  stats() {
    const now = Date.now();
    const connected = new Set(this.waiters.keys());
    for (const [id, t] of this.seen) if (now - t <= CONNECTED_WINDOW_MS) connected.add(id);
    return { pendingCount: this.slots.size, connectedAgents: connected.size, polling: this.waiters.size };
  }

  /* ---------------- 内部 ---------------- */

  private finish(slot: Slot, value: AgentResponse | null, mark: "consumed" | "expired") {
    if (slot.done) return; // 保证只 resolve 一次
    slot.done = true;
    const id = slot.entry.agentId;
    if (this.slots.get(id) === slot) this.slots.delete(id);
    clearTimeout(slot.timer);
    slot.signal?.removeEventListener("abort", slot.onAbort);
    this.remember(id, slot.entry.requestId, mark);
    slot.resolve(value);
  }

  private remember(agentId: string, requestId: string, mark: "consumed" | "expired") {
    let h = this.history.get(agentId);
    if (!h) {
      if (this.history.size >= MAX_AGENTS_TRACKED) this.history.delete(this.history.keys().next().value!);
      this.history.set(agentId, (h = new Map()));
    }
    h.delete(requestId);
    h.set(requestId, mark);
    if (h.size > HISTORY_PER_AGENT) h.delete(h.keys().next().value!);
  }

  private touch(agentId: string) {
    this.seen.delete(agentId);
    this.seen.set(agentId, Date.now());
    if (this.seen.size > MAX_AGENTS_TRACKED) this.seen.delete(this.seen.keys().next().value!);
  }
}
