"use client";
import type { CycleEvent } from "@echo/engine";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

const TOKEN_KEY = "echo.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event("echo:auth"));
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Network-level failure (API not running) — distinct from an HTTP error the server returned. */
export class OfflineError extends Error {}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getToken();
  if (token && init.auth !== false) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API + path, { method: init.method ?? (init.body ? "POST" : "GET"), headers, body: init.body ? JSON.stringify(init.body) : undefined, signal: init.signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new OfflineError("城市离线 · API 未连接");
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return json as T;
}

export type StreamStatus = "open" | "error";

/** Tickets are single-use; reconnect explicitly with a fresh ticket. Engine seq is only deduplication, never Last-Event-ID. */
export function subscribe(cycleId: string, onEvent: (e: CycleEvent) => void, onStatus?: (s: StreamStatus) => void): () => void {
  let stopped = false;
  let es: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const seen = new Set<number>();
  let deliveryCursor = 0;
  let delay = 1000;
  const connect = async () => {
    try {
      const ticket = getToken() ? (await api<{ ticket: string }>("/api/stream-ticket", { body: { cycleId } })).ticket : null;
      if (stopped) return;
      const query = new URLSearchParams();
      if (ticket) query.set("ticket", ticket);
      if (deliveryCursor > 0) query.set("since", String(deliveryCursor));
      es = new EventSource(`${API}/api/cycles/${encodeURIComponent(cycleId)}/stream${query.size ? `?${query}` : ""}`);
      const handler = (m: MessageEvent) => {
        let e: CycleEvent & { deliveryCursor?: number };
        try { e = JSON.parse(m.data); } catch { return; }
        if (!Number.isFinite(e.seq)) return;
        const delivered = Number(m.lastEventId || e.deliveryCursor);
        if (Number.isSafeInteger(delivered) && delivered > deliveryCursor) deliveryCursor = delivered;
        if (seen.has(e.seq)) return;
        seen.add(e.seq);
        onEvent(e);
      };
      es.onmessage = handler;
      for (const t of KNOWN_TYPES) es.addEventListener(t, handler as EventListener);
      es.onopen = () => { delay = 1000; onStatus?.("open"); };
      es.onerror = reconnect;
    } catch { reconnect(); }
  };
  const reconnect = () => {
    es?.close();
    if (stopped) return;
    onStatus?.("error");
    retry = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 15000);
  };
  void connect();
  return () => { stopped = true; es?.close(); if (retry) clearTimeout(retry); };
}

const KNOWN_TYPES = [
  "cycle_start", "amendment", "dawn", "venues_lit", "venue_dark", "quiet_night", "finale", "solo_king", "say", "broadcast", "whisper", "whisper_meta", "move", "register",
  "search", "scout", "trade", "pact_offer", "pact_signed", "pact_declined", "pact_broken", "pact_fulfilled", "expose", "pawn", "pawn_detail", "use_item", "share_intel",
  "trial_start", "trial_message", "trial_end", "trial_reveal", "trial_elimination", "rule_added", "gatekeeper_enter", "beauty_round", "beauty_cap", "collar_claim", "collar_declare", "collar_cap",
  "jack_found", "vote_execute", "vote_none", "dinner_pairs", "dinner_round", "lifeboat_round", "corridor_round", "elevator_answer", "hound_round", "hound_decoy",
  "greenhouse_round", "passphrase_leak", "joker_round", "joker_cull", "joker_duel", "joker_duel_round", "agent_deleted", "uptime", "humanity", "thought", "timeout",
  "invalid_action", "no_trial", "night_end", "whisper_open", "host_whisper", "host_silent", "whisper_rejected", "judgment_break", "inquiry_start", "inquiry_question",
  "inquiry_answer", "cycle_end", "passphrase", "self_leak", "venues_secret",
];
