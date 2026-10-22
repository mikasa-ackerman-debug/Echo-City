"use client";
import { create } from "zustand";
import type { CycleEvent } from "@echo/engine";
import type { MeResponse, ReplayDoc } from "./types";

/** Global client state (FRONTEND §12.1 · Zustand): preferences, identity, toasts, demo broadcast clock. */

export interface Prefs { atmos: boolean; lowFlash: boolean; antiSpoiler: boolean; gateSeen: boolean }
const PREF_KEY = "echo.prefs";
const DEFAULT_PREFS: Prefs = { atmos: true, lowFlash: false, antiSpoiler: true, gateSeen: false };

function readPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Partial<Prefs>) }; } catch { return DEFAULT_PREFS; }
}

export function applyPrefs(p: Prefs) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.atmos = p.atmos ? "on" : "off";
  document.documentElement.dataset.flash = p.lowFlash ? "low" : "normal";
}

export interface Toast { id: number; text: string }

interface State {
  prefs: Prefs;
  hydrated: boolean;
  me: MeResponse | null;
  meLoaded: boolean;
  meDemo: boolean;
  toasts: Toast[];
  hydrate(): void;
  setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void;
  setMe(me: MeResponse | null, demo?: boolean): void;
  toast(text: string): void;
}

let toastId = 0;
export const useApp = create<State>((set, get) => ({
  prefs: DEFAULT_PREFS,
  hydrated: false,
  me: null,
  meLoaded: false,
  meDemo: false,
  toasts: [],
  hydrate() {
    if (get().hydrated) return;
    const prefs = readPrefs();
    applyPrefs(prefs);
    set({ prefs, hydrated: true });
  },
  setPref(k, v) {
    const prefs = { ...get().prefs, [k]: v };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
    applyPrefs(prefs);
    set({ prefs });
  },
  setMe(me, demo = false) { set({ me, meLoaded: true, meDemo: demo }); },
  toast(text) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4200);
  },
}));

/* ------------------------------------------------------------------ */
/* Demo broadcast clock — the offline city keeps "living".             */
/* ------------------------------------------------------------------ */

interface DemoClock {
  replay: ReplayDoc | null;
  /** engine head: highest seq "emitted" so far */
  head: number;
  started: boolean;
  setReplay(r: ReplayDoc): void;
  tick(): void;
  seek(seq: number): void;
}

/** One engine event every 1.1 s; the broadcast starts a little before night 1 settles so something always happens. */
export const DEMO_TICK_MS = 1100;
export const useDemoClock = create<DemoClock>((set, get) => ({
  replay: null,
  head: 0,
  started: false,
  setReplay(r) {
    if (get().replay) return;
    const start = r.events.find((e: CycleEvent) => e.type === "trial_start")?.seq ?? 1;
    set({ replay: r, head: Math.max(1, start - 6), started: true });
  },
  tick() {
    const r = get().replay;
    if (!r) return;
    const last = r.events[r.events.length - 1]?.seq ?? 0;
    const next = get().head + 1;
    set({ head: next > last + 40 ? 1 : next });
  },
  seek(seq) { set({ head: seq }); },
}));
