"use client";
import type { CycleEvent } from "@echo/engine";
import { SIM_ID, simLobby, simMe, simReplay, useSim } from "./sim-local";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HttpError, OfflineError, api, getToken } from "./api";
import { useDemo } from "./demo-mode";
import { demoCycleList, demoCycleView, demoLiveView, demoTombstones, loadDemoReplay } from "./demo";
import { releaseOrder, releasedAt } from "./playback";
import { DEMO_TICK_MS, useApp, useDemoClock } from "./store";
import type { CycleListItem, CycleView, DataSource, LobbyView, MeResponse, ReplayDoc, TombstoneDTO } from "./types";

/** Data layer (FRONTEND §10.1): REST + polling against apps/api, demo fixtures when the city is offline. */

export interface Resource<T> { data: T | null; error: string | null; loading: boolean; source: DataSource; reload(): void }

export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  opts: { poll?: number; fallback?: () => Promise<T> } = {},
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<DataSource>("api");
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load); loadRef.current = load;
  const fbRef = useRef(opts.fallback); fbRef.current = opts.fallback;

  useEffect(() => {
    if (key == null) { setLoading(false); return; }
    let alive = true;
    const ctl = new AbortController();
    const run = async () => {
      try {
        const v = await loadRef.current(ctl.signal);
        if (!alive) return;
        setData(v); setSource("api"); setError(null);
      } catch (err) {
        if (!alive || ctl.signal.aborted) return;
        if (err instanceof OfflineError && fbRef.current) {
          try { const v = await fbRef.current(); if (alive) { setData(v); setSource("demo"); setError(null); } }
          catch { if (alive) setError(err.message); }
        } else setError(err instanceof Error ? err.message : String(err));
      } finally { if (alive) setLoading(false); }
    };
    run();
    const t = opts.poll ? setInterval(run, opts.poll) : undefined;
    return () => { alive = false; ctl.abort(); if (t) clearInterval(t); };
  }, [key, nonce, opts.poll]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, source, reload };
}

/* ---------------- demo broadcast ---------------- */

let tickers = 0;
let tickTimer: ReturnType<typeof setInterval> | undefined;
function retainTicker() {
  tickers++;
  if (!tickTimer) tickTimer = setInterval(() => useDemoClock.getState().tick(), DEMO_TICK_MS);
  return () => { tickers--; if (tickers <= 0 && tickTimer) { clearInterval(tickTimer); tickTimer = undefined; } };
}

const orderCache = new WeakMap<ReplayDoc, ReturnType<typeof releaseOrder>>();
function orderOf(r: ReplayDoc) {
  let o = orderCache.get(r);
  if (!o) { o = releaseOrder(r.events); orderCache.set(r, o); }
  return o;
}

/** The demo city "broadcasting": events released up to the clock head, honoring late reveal. */
export function useDemoBroadcast(enabled: boolean): { replay: ReplayDoc | null; events: CycleEvent[]; head: number } {
  const replay = useDemoClock((s) => s.replay);
  const head = useDemoClock((s) => s.head);
  useEffect(() => {
    if (!enabled) return;
    loadDemoReplay().then((r) => useDemoClock.getState().setReplay(r)).catch(() => {});
    return retainTicker();
  }, [enabled]);
  const events = useMemo(() => (enabled && replay ? releasedAt(orderOf(replay), head) : []), [enabled, replay, head]);
  return { replay: enabled ? replay : null, events, head };
}

/* ---------------- current cycle ---------------- */

export interface CurrentCycle { cycle: CycleView | null; source: DataSource; loading: boolean; error: string | null; none: boolean; demoEvents: CycleEvent[] }

export function useCurrentCycle(poll = 10_000): CurrentCycle {
  const [offline, setOffline] = useState(false);
  const [none, setNone] = useState(false);
  const demoId = useDemo()?.cycleId ?? null;
  const r = useResource<CycleView | null>(demoId ? `current:${demoId}` : "current", async (signal) => {
    try {
      const path = demoId ? `/api/cycles/${encodeURIComponent(demoId)}` : "/api/cycles/current";
      const c = await api<CycleView>(path, { signal, auth: !!getToken() });
      setOffline(false); setNone(false);
      return c;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) { setNone(true); setOffline(false); return null; }
      if (err instanceof OfflineError) setOffline(true);
      throw err;
    }
  }, { poll, fallback: async () => null });
  const demo = useDemoBroadcast(offline);
  const sim = useSim();
  const cycle = useMemo(() => {
    if (sim.cfg) return sim.cycle;
    if (!offline) return r.data;
    if (!demo.replay) return null;
    const ended = demo.events.some((e) => e.type === "cycle_end");
    return ended ? demoCycleView(demo.replay) : demoLiveView(demo.replay, demo.events);
  }, [offline, r.data, demo.replay, demo.events, sim.cfg, sim.cycle]);
  // 全局模拟 (browser-local city) wins over everything: its events flow through the same "demo" path as the offline broadcast.
  if (sim.cfg) return { cycle, source: "demo", loading: false, error: null, none: false, demoEvents: sim.visible };
  return { cycle, source: offline ? "demo" : "api", loading: r.loading && !cycle, error: offline ? null : r.error, none, demoEvents: demo.events };
}

/* ---------------- me ---------------- */

let meInflight: Promise<void> | null = null;
export function loadMe(force = false): Promise<void> {
  const st = useApp.getState();
  if (!force && (st.meLoaded || meInflight)) return meInflight ?? Promise.resolve();
  if (!getToken()) { st.setMe(null); return Promise.resolve(); }
  meInflight = api<MeResponse>("/api/me")
    .then((me) => useApp.getState().setMe(me))
    .catch(() => useApp.getState().setMe(null))
    .finally(() => { meInflight = null; });
  return meInflight;
}

export function useMe() {
  const real = useApp((s) => s.me);
  const loaded = useApp((s) => s.meLoaded);
  const sim = useSim();
  const me = useMemo(() => (sim.cfg ? simMe(sim.cfg, sim.cycle) : real), [sim.cfg, sim.cycle, real]);
  useEffect(() => {
    loadMe();
    const on = () => loadMe(true);
    window.addEventListener("echo:auth", on);
    return () => window.removeEventListener("echo:auth", on);
  }, []);
  return { me, loaded: loaded || !!sim.cfg };
}

/* ---------------- server-clock countdown (FRONTEND §7.5) ---------------- */

let clockOffset = 0;
export function syncServerClock(serverNow?: string) {
  if (!serverNow) return;
  const t = Date.parse(serverNow);
  if (Number.isFinite(t)) clockOffset = t - Date.now();
}
export const serverNow = () => Date.now() + clockOffset;

export function useNow(interval = 1000): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    setNow(serverNow());
    const t = setInterval(() => setNow(serverNow()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

/** Monday 19:00 wake / 21:00 start, Asia/Shanghai (apps/api schedule). */
export function nextWeekly(now = serverNow(), hour = 21, weekday = 1): number {
  const BJ = 8 * 3600_000;
  const local = new Date(now + BJ);
  const day = (local.getUTCDay() + 6) % 7 + 1;
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, 0, 0));
  let add = (weekday - day + 7) % 7;
  if (add === 0 && target.getTime() <= local.getTime()) add = 7;
  return target.getTime() + add * 86400_000 - BJ;
}

/** Next nightly 21:00 Beijing. */
export function nextNight(now = serverNow()): number {
  const BJ = 8 * 3600_000;
  const local = new Date(now + BJ);
  const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 21, 0, 0);
  return (target <= local.getTime() ? target + 86400_000 : target) - BJ;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

export function cycleNo(id: string): string {
  const m = id.match(/(\d+)$/);
  return m ? m[1].padStart(2, "0") : id.replace(/^cycle-/, "").toUpperCase();
}

/* ---------------- collections with demo fallback ---------------- */


export function useGraveyard(query = "", limit = 200) {
  return useResource<TombstoneDTO[]>(`grave:${query}:${limit}`, (signal) => api<TombstoneDTO[]>(`/api/graveyard?limit=${limit}${query}`, { signal, auth: false }), {
    fallback: async () => demoTombstones(await loadDemoReplay()),
  });
}

export function useCycles() {
  return useResource<CycleListItem[]>("cycles", (signal) => api<CycleListItem[]>("/api/cycles", { signal, auth: false }), {
    fallback: async () => demoCycleList(await loadDemoReplay()),
  });
}

/** Replay for any cycle id; `cycle-demo1` / "demo" always resolves to the bundled demo. */
export function useReplay(id: string | null) {
  return useResource<ReplayDoc>(id ? `replay:${id}` : null, async (signal) => {
    if (id === "demo" || id === "cycle-demo1") return loadDemoReplay();
    if (id === SIM_ID) { const r = simReplay(); if (r) return r; throw new Error("这局全局模拟已经还原"); }
    return api<ReplayDoc>(`/api/cycles/${encodeURIComponent(id!)}/replay`, { signal, auth: !!getToken() });
  }, { fallback: async () => loadDemoReplay() });
}

/* ---------------- 候场区 ---------------- */

/** The open lobby — or, while 全局模拟 is on, the private demo lobby of this browser. */
export function useLobby(poll = 5000) {
  const demoId = useDemo()?.cycleId ?? null;
  const sim = useSim();
  const r = useResource<LobbyView>(demoId ? `lobby:${demoId}` : "lobby", (signal) => api<LobbyView>(`/api/lobby${demoId ? `?cycle=${encodeURIComponent(demoId)}` : ""}`, { signal, auth: false }), { poll });
  const local = useMemo(() => (sim.cfg ? simLobby(sim.cfg) : null), [sim.cfg]);
  return local ? { ...r, data: local, error: null, loading: false } : r;
}
