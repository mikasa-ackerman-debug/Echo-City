"use client";
import { useEffect, useState } from "react";
import { getToken, setToken } from "./api";

/**
 * Admin demo backdoor (/demo). While a demo is active the browser:
 *  - points "current cycle" at a private demo cycle (hidden from public lists),
 *  - uses a throwaway demo identity, so the real account's lineage/registration is untouched.
 * Leaving the demo restores the previous identity.
 */
export interface DemoState { cycleId: string; realToken: string | null; speed: number; startedAt: string }

const KEY = "echo.demo";
const ADMIN_KEY = "echo.admin";
const EVT = "echo:demo";

export function getDemo(): DemoState | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
}

export function getAdminToken(): string { return typeof window === "undefined" ? "" : localStorage.getItem(ADMIN_KEY) ?? ""; }
export function setAdminToken(t: string) { if (t) localStorage.setItem(ADMIN_KEY, t); else localStorage.removeItem(ADMIN_KEY); }

/** Switch to a fresh demo identity and pin the demo cycle. */
export function enterDemo(cycleId: string, demoToken: string, speed: number) {
  const prev = getDemo();
  const realToken = prev ? prev.realToken : getToken();
  localStorage.setItem(KEY, JSON.stringify({ cycleId, realToken, speed, startedAt: new Date().toISOString() } satisfies DemoState));
  setToken(demoToken);
  window.dispatchEvent(new Event(EVT));
}

export function exitDemo() {
  const d = getDemo();
  localStorage.removeItem(KEY);
  setToken(d?.realToken ?? null);
  window.dispatchEvent(new Event(EVT));
}

export function useDemo(): DemoState | null {
  const [d, setD] = useState<DemoState | null>(null);
  useEffect(() => {
    const on = () => setD(getDemo());
    on();
    window.addEventListener(EVT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVT, on); window.removeEventListener("storage", on); };
  }, []);
  return d;
}
