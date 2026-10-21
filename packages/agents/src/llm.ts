import { extractJsonObject, type AgentResponse, type Observation } from "@echo/protocol";
import { injectedText, networkText } from "./network";
import type { AgentDriver } from "./driver";
import { systemPrompt, userPrompt } from "./prompt";

export interface LlmConfig {
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 or https://api.deepseek.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  strategy: string;
  temperature?: number;
  maxTokens?: number;
  /** Use response_format: json_object (most OpenAI-compatible servers support it). */
  jsonMode?: boolean;
  fetchImpl?: typeof fetch;
  allowHttp?: boolean;
  timeoutMs?: number;
}

export interface LlmUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  failures: number;
}

/**
 * Hosted mode: the platform calls an OpenAI-compatible chat completions API
 * on the player's behalf. Stateless per call — continuity lives in `notes`.
 */
export class LlmAgent implements AgentDriver {
  readonly kind: string;
  usage: LlmUsage = { calls: 0, promptTokens: 0, completionTokens: 0, failures: 0 };

  constructor(private cfg: LlmConfig) {
    this.kind = `hosted:${cfg.model}`;
  }

  async decide(obs: Observation, signal?: AbortSignal): Promise<AgentResponse | null> {
    const messages = [
      { role: "system", content: systemPrompt(this.cfg.strategy) },
      { role: "user", content: userPrompt(obs) },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await this.complete(messages, signal);
        const parsed = extractJsonObject(text) as AgentResponse;
        return parsed;
      } catch (err) {
        this.usage.failures++;
        if (signal?.aborted) return null;
        messages.push({ role: "user", content: `上一次的输出无法解析（${String((err as Error).message).slice(0, 120)}）。请只输出一个合法的 JSON 对象。` });
      }
    }
    return null;
  }

  private async complete(messages: Array<{ role: string; content: string }>, signal?: AbortSignal): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: this.cfg.temperature ?? 0.7,
      max_tokens: this.cfg.maxTokens ?? 800,
    };
    if (this.cfg.jsonMode !== false) body.response_format = { type: "json_object" };
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify(body),
      signal,
      redirect: "error",
    };
    const res = this.cfg.fetchImpl
      ? await injectedText(this.cfg.fetchImpl, url, init, 256 * 1024)
      : await networkText(url, init, { allowHttp: this.cfg.allowHttp, maxBytes: 256 * 1024, timeoutMs: this.cfg.timeoutMs });
    if (res.status < 200 || res.status >= 300) throw new Error(`LLM HTTP ${res.status}`);
    const json = JSON.parse(res.text) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    this.usage.calls++;
    this.usage.promptTokens += json.usage?.prompt_tokens ?? 0;
    this.usage.completionTokens += json.usage?.completion_tokens ?? 0;
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty completion");
    return content;
  }
}
