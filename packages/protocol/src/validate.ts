import {
  LIMITS,
  type ActionSpec,
  type AgentAction,
  type AgentResponse,
  type ChannelSpec,
  type OutboundMessage,
  type ParamSpec,
} from "./types";

/** Strip control characters, collapse whitespace runs and enforce a length limit. */
export function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== "string") return "";
  // eslint-disable-next-line no-control-regex
  let s = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  s = s.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const chars = Array.from(s);
  if (chars.length > maxLength) s = chars.slice(0, maxLength).join("");
  return s;
}

export function textLength(s: string): number {
  return Array.from(s).length;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function validateParam(name: string, spec: ParamSpec, value: unknown): ValidationResult<unknown> {
  if (value === undefined || value === null) {
    if (spec.optional) return { ok: true, value: undefined };
    return { ok: false, error: `missing param "${name}"` };
  }
  switch (spec.kind) {
    case "enum": {
      const hit = spec.values.find((v) => v === value || String(v) === String(value));
      if (hit === undefined) return { ok: false, error: `param "${name}" must be one of ${spec.values.join(", ")}` };
      return { ok: true, value: hit };
    }
    case "int": {
      const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isInteger(n)) return { ok: false, error: `param "${name}" must be an integer` };
      if (n < spec.min || n > spec.max) return { ok: false, error: `param "${name}" must be in [${spec.min}, ${spec.max}]` };
      return { ok: true, value: n };
    }
    case "string": {
      if (typeof value !== "string") return { ok: false, error: `param "${name}" must be a string` };
      const s = sanitizeText(value, spec.maxLength);
      if (spec.minLength && textLength(s) < spec.minLength) return { ok: false, error: `param "${name}" is too short` };
      return { ok: true, value: s };
    }
    case "list": {
      if (!Array.isArray(value)) return { ok: false, error: `param "${name}" must be an array` };
      const out: Record<string, unknown>[] = [];
      for (const raw of value.slice(0, spec.maxItems)) {
        if (!raw || typeof raw !== "object") return { ok: false, error: `param "${name}" items must be objects` };
        const item: Record<string, unknown> = {};
        for (const [k, sub] of Object.entries(spec.item)) {
          const r = validateParam(`${name}.${k}`, sub, (raw as Record<string, unknown>)[k]);
          if (!r.ok) return r;
          if (r.value !== undefined) item[k] = r.value;
        }
        out.push(item);
      }
      return { ok: true, value: out };
    }
  }
}

/** Validate an action against the currently legal action specs. Returns a normalized action. */
export function validateAction(action: unknown, legal: ActionSpec[]): ValidationResult<AgentAction> {
  if (!action || typeof action !== "object") return { ok: false, error: "action must be an object" };
  const type = (action as Record<string, unknown>).type;
  if (typeof type !== "string") return { ok: false, error: "action.type must be a string" };
  const spec = legal.find((a) => a.type === type);
  if (!spec) return { ok: false, error: `action "${type}" is not legal now (legal: ${legal.map((a) => a.type).join(", ")})` };
  const out: AgentAction = { type };
  for (const [name, p] of Object.entries(spec.params ?? {})) {
    const r = validateParam(name, p, (action as Record<string, unknown>)[name]);
    if (!r.ok) return r;
    if (r.value !== undefined) out[name] = r.value;
  }
  return { ok: true, value: out };
}

/**
 * Filter outbound messages against allowed channels. Invalid messages are
 * dropped (not fatal): a chatty agent should not be punished for an extra line.
 */
export function filterMessages(messages: unknown, channels: ChannelSpec[]): OutboundMessage[] {
  if (!Array.isArray(messages)) return [];
  const used = new Map<string, number>();
  const out: OutboundMessage[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const channel = m.channel;
    const spec = channels.find((c) => c.channel === channel);
    if (!spec) continue;
    const to = typeof m.to === "string" ? m.to.trim() : "all";
    if (spec.to !== "all") {
      if (!spec.to.includes(to)) continue;
    } else if (to !== "all" && spec.channel !== "whisper") {
      // public channels ignore explicit recipients
    }
    const count = used.get(spec.channel) ?? 0;
    if (count >= spec.maxMessages) continue;
    const text = sanitizeText(m.text, spec.maxLength);
    if (!text) continue;
    used.set(spec.channel, count + 1);
    out.push({ channel: spec.channel, to: spec.to === "all" ? "all" : to, text });
  }
  return out;
}

export interface NormalizedResponse {
  response: AgentResponse;
  valid: boolean;
  error?: string;
}

/**
 * Normalize an arbitrary agent payload. If the action is invalid, `valid` is
 * false and the caller should substitute the default action.
 */
export function normalizeResponse(raw: unknown, legal: ActionSpec[], channels: ChannelSpec[]): NormalizedResponse {
  if (!raw || typeof raw !== "object") {
    return { response: { action: { type: "__invalid" } }, valid: false, error: "response must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;
  const actionResult = validateAction(r.action, legal);
  const response: AgentResponse = {
    action: actionResult.ok ? actionResult.value : { type: "__invalid" },
    messages: filterMessages(r.messages, channels),
  };
  if (typeof r.thought === "string") response.thought = sanitizeText(r.thought, LIMITS.thought);
  if (typeof r.notes === "string") response.notes = sanitizeText(r.notes, LIMITS.notes);
  if (typeof r.last_words === "string") response.last_words = sanitizeText(r.last_words, LIMITS.lastWords);
  return actionResult.ok
    ? { response, valid: true }
    : { response, valid: false, error: actionResult.error };
}

/** Extract the first JSON object from model output (handles ```json fences and prose). */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  if (start < 0) throw new Error("no JSON object found");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error("unterminated JSON object");
}
