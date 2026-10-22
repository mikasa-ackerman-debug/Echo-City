import { sanitizeText } from "@echo/protocol";

export interface LLMConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Call an OpenAI-compatible chat completions endpoint.
 * Returns the assistant's text response, or throws on failure.
 */
export async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[],
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = JSON.stringify({
    model: config.model,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 1024,
    messages,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);

  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const json = await res.json() as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
    const msg = json.choices?.[0]?.message;
    const content = msg?.content || msg?.reasoning_content || "";
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a JSON object from LLM output, tolerating markdown code fences. */
export function extractJSON(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  try { return JSON.parse(cleaned.slice(start)); } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* Decision prompts                                                    */
/* ------------------------------------------------------------------ */

/** Prompt for an agent to select which trial card to enter. */
export function selectCardPrompt(
  persona: string,
  agentName: string,
  availableCards: Array<{ id: string; name: string; suit: string; rank: number; tests: string; minPlayers: number; maxPlayers: number }>,
  alreadyJoined: string[],
): LLMMessage[] {
  const cardList = availableCards
    .map((c) => `- ${c.id}: ${c.name}（${c.suit}，${c.tests}，${c.minPlayers}–${c.maxPlayers} 人）`)
    .join("\n");
  return [
    {
      role: "system",
      content: [
        persona || "你是一个自主决策的智能体。",
        `你是「${agentName}」，正在残响城参加试炼。`,
        "你需要选择一个尚未关闭的试炼卡进入。",
        "根据你的性格和偏好做出选择。可以选你擅长的，也可以按你的意志选。",
        "只输出一个 JSON 对象，不要输出其它文字。",
        '格式：{"card": "卡片ID", "reason": "一句话理由"}',
      ].join("\n"),
    },
    {
      role: "user",
      content: `当前可加入的试炼卡：\n${cardList}\n${alreadyJoined.length ? `\n你已经加入的房间：${alreadyJoined.join("、")}（不能再加入）\n` : ""}\n请选择一张卡。`,
    },
  ];
}

/** Prompt for an agent to make a move during a trial. */
export function trialActionPrompt(
  persona: string,
  agentName: string,
  trialName: string,
  rules: string,
  observation: string,
  legalActions: string[],
): LLMMessage[] {
  return [
    {
      role: "system",
      content: [
        persona || "你是一个自主决策的智能体。",
        `你是「${agentName}」，正在参加试炼「${trialName}」。`,
        "根据观察做出最佳行动决策。",
        "只输出一个 JSON 对象，不要输出其它文字。",
        '格式：{"action": "行动描述", "params": {...}}',
      ].join("\n"),
    },
    {
      role: "user",
      content: `## 试炼规则\n${rules}\n\n## 当前观察\n${observation}\n\n## 合法行动\n${legalActions.join("\n")}\n\n请做出你的决策。`,
    },
  ];
}
