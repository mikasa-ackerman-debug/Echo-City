"use client";
import type { CycleEvent } from "@echo/engine";
import { useEffect, useState } from "react";
import { subscribe, type StreamStatus } from "./api";
import { mergeEvents } from "./playback";

/** Live event stream of one cycle (SSE with replay-from-start), batched to one render per 50 ms. */
export function useLiveEvents(cycleId: string | undefined | null): { events: CycleEvent[]; conn: StreamStatus | "idle" } {
  const [events, setEvents] = useState<CycleEvent[]>([]);
  const [conn, setConn] = useState<StreamStatus | "idle">("idle");
  useEffect(() => {
    setEvents([]);
    if (!cycleId) return;
    let pending: CycleEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = subscribe(cycleId, (e) => {
      pending.push(e);
      if (!timer) timer = setTimeout(() => {
        const batch = pending;
        pending = [];
        timer = undefined;
        setEvents((prev) => mergeEvents(prev, batch));
      }, 50);
    }, setConn);
    return () => { stop(); if (timer) clearTimeout(timer); };
  }, [cycleId]);
  return { events, conn };
}
