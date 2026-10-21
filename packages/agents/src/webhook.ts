import { PROTOCOL_VERSION, type AgentResponse, type Observation } from "@echo/protocol";
import { HEADER_DEADLINE, HEADER_PROTOCOL, HEADER_REQUEST_ID, HEADER_SIGNATURE, HEADER_TIMESTAMP, signPayload } from "@echo/protocol/signing";
import type { AgentDriver } from "./driver";

export interface WebhookConfig {
  url: string;
  secret: string;
  fetchImpl?: typeof fetch;
}

/**
 * Webhook mode: POST the observation to the player's endpoint, signed with
 * HMAC-SHA256 over `${timestamp}.${body}`. Non-2xx, bad JSON or timeouts all
 * return null (= timeout strike in the engine).
 */
export class WebhookAgent implements AgentDriver {
  readonly kind = "webhook";
  lastError: string | null = null;

  constructor(private cfg: WebhookConfig) {}

  async decide(obs: Observation, signal?: AbortSignal): Promise<AgentResponse | null> {
    const body = JSON.stringify(obs);
    const ts = Date.now();
    const f = this.cfg.fetchImpl ?? fetch;
    try {
      const res = await f(this.cfg.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HEADER_PROTOCOL]: PROTOCOL_VERSION,
          [HEADER_TIMESTAMP]: String(ts),
          [HEADER_SIGNATURE]: signPayload(body, this.cfg.secret, ts),
          [HEADER_REQUEST_ID]: obs.request_id,
          [HEADER_DEADLINE]: String(obs.deadline_ms),
        },
        body,
        signal,
        redirect: "error",
      });
      if (!res.ok) {
        this.lastError = `HTTP ${res.status}`;
        return null;
      }
      const text = await res.text();
      if (text.length > 64 * 1024) {
        this.lastError = "response too large";
        return null;
      }
      return JSON.parse(text) as AgentResponse;
    } catch (err) {
      this.lastError = (err as Error).message;
      return null;
    }
  }
}
