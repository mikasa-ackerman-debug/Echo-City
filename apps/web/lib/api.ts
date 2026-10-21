"use client";
import type { CycleEvent } from "@echo/engine";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("echo.token");
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem("echo.token", t);
  else localStorage.removeItem("echo.token");
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getToken();
  if (token && init.auth !== false) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method: init.method ?? (init.body ? "POST" : "GET"), headers, body: init.body ? JSON.stringify(init.body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, json?.error ?? `HTTP ${res.status}`);
  return json as T;
}

/** Subscribe to a cycle's SSE stream. Reconnects automatically (EventSource) and resumes via Last-Event-ID. */
export function subscribe(cycleId: string, onEvent: (e: CycleEvent) => void, onStatus?: (s: "open" | "error") => void): () => void {
  const token = getToken();
  const url = `${API}/api/cycles/${encodeURIComponent(cycleId)}/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  const es = new EventSource(url);
  const seen = new Set<number>();
  const handler = (m: MessageEvent) => {
    try {
      const e = JSON.parse(m.data) as CycleEvent;
      if (seen.has(e.seq)) return;
      seen.add(e.seq);
      onEvent(e);
    } catch {}
  };
  es.onmessage = handler;
  // Named events (event: <type>) don't hit onmessage; listen generically.
  const types = KNOWN_TYPES;
  for (const t of types) es.addEventListener(t, handler as EventListener);
  es.onopen = () => onStatus?.("open");
  es.onerror = () => onStatus?.("error");
  return () => es.close();
}

const KNOWN_TYPES = [
  "cycle_start", "amendment", "dawn", "venues_lit", "venue_dark", "quiet_night", "finale", "solo_king", "say", "broadcast", "whisper", "whisper_meta", "move", "register",
  "search", "scout", "trade", "pact_offer", "pact_signed", "pact_declined", "pact_broken", "pact_fulfilled", "expose", "pawn", "pawn_detail", "use_item", "share_intel",
  "trial_start", "trial_message", "trial_end", "trial_reveal", "trial_elimination", "rule_added", "gatekeeper_enter", "beauty_round", "collar_claim", "collar_declare",
  "jack_found", "vote_execute", "vote_none", "dinner_pairs", "dinner_round", "lifeboat_round", "corridor_round", "elevator_answer", "hound_round", "hound_decoy",
  "greenhouse_round", "passphrase_leak", "joker_round", "joker_cull", "joker_duel", "joker_duel_round", "agent_deleted", "uptime", "humanity", "thought", "timeout",
  "invalid_action", "no_trial", "night_end", "whisper_open", "host_whisper", "host_silent", "whisper_rejected", "judgment_break", "inquiry_start", "inquiry_question",
  "inquiry_answer", "cycle_end", "passphrase", "self_leak", "venues_secret",
];
