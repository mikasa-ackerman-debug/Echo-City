import type { AgentResponse, Observation } from "@echo/protocol";
import type { AgentDriver, DecideContext } from "./driver";

/**
 * MCP 模式（docs/MCP-ACCESS.md FR-3/FR-4）：平台作为 MCP Server，玩家的 Agent CLI
 * 通过 `echo.get_observation` 拉取观察、`echo.submit_action` 提交动作。
 *
 * 驱动与传输解耦：McpDriver 只把观察登记进 ObservationRegistry 并等待结果；
 * HTTP/MCP 层只读写注册表。客户端断连不会取消等待，重连后凭同一 request_id 续交。
 */

/** 注册表中一条待决观察。observation 原样来自引擎 buildObservation（per-agent 过滤）。 */
export interface PendingObservation {
  agentId: string;
  requestId: string;
  observation: Observation;
  /** 实际截止时刻（epoch ms，已含 per-agent 超时倍率）。 */
  deadline: number;
  issuedAt: number;
}

export type SubmitReason = "unknown_request" | "consumed" | "expired" | "invalid_response";
export type SubmitResult = { ok: true } | { ok: false; reason: SubmitReason };

/**
 * 可替换的注册表接口（v1 进程内存，v2 可换 Redis）。驱动只依赖三个写操作：
 *  - observe：登记待决观察，返回在 submit / deadline / abort / takeover 时 resolve 的 Promise；
 *  - submit：按 request_id 幂等提交；
 *  - expire：主动作废（超时、中止）。
 * observe 返回的 Promise 永不 reject。
 */
export interface ObservationRegistry {
  observe(entry: Omit<PendingObservation, "issuedAt">, signal?: AbortSignal): Promise<AgentResponse | null>;
  submit(agentId: string, requestId: string, response: unknown): SubmitResult;
  expire(agentId: string, requestId?: string): void;
}

export class McpDriver implements AgentDriver {
  readonly kind = "mcp";

  constructor(private registry: ObservationRegistry, private agentId: string) {}

  /** 契约：永不抛错；超时 / 中止 / 被接管 / 任何内部错误一律 resolve(null)，由引擎记 strike。 */
  async decide(obs: Observation, signal?: AbortSignal, ctx?: DecideContext): Promise<AgentResponse | null> {
    try {
      if (signal?.aborted) return null;
      const budget = ctx?.deadlineMs ?? obs.deadline_ms;
      const deadline = Date.now() + (Number.isFinite(budget) && budget > 0 ? budget : 0);
      return await this.registry.observe({ agentId: this.agentId, requestId: obs.request_id, observation: obs, deadline }, signal);
    } catch {
      return null;
    }
  }
}
