"use client";
import type { CycleEvent } from "@echo/engine";
import { useEffect, useState } from "react";
import { Player } from "@/components/player";
import { WhisperOverlay } from "@/components/whisper";
import { api, subscribe } from "@/lib/api";

export default function LivePage() {
  const [cycle, setCycle] = useState<any>(null);
  const [events, setEvents] = useState<CycleEvent[]>([]);
  const [conn, setConn] = useState<"open" | "error" | "idle">("idle");
  const [mine, setMine] = useState<string[]>([]);

  useEffect(() => {
    api("/api/cycles/current").then(setCycle).catch(() => setConn("error"));
    api("/api/me").then((m) => setMine(m.agents.map((a: any) => a.id))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!cycle) return;
    // Late-visibility events can arrive out of seq order; keep the log sorted.
    return subscribe(cycle.id, (e) => setEvents((prev) => [...prev, e].sort((a, b) => a.seq - b.seq)), setConn);
  }, [cycle?.id]);

  if (!cycle) return <div className="wrap block"><p className="grey">{conn === "error" ? "无法连接城市（API 未启动？）" : "…"}</p></div>;
  return (
    <div>
      <div className="statusbar"><span>{cycle.id} · 直播 · {events.length} 事件</span><span>{conn === "open" ? "已连接" : conn === "error" ? "重连中…" : ""}</span></div>
      <Player events={events} live myAgentIds={mine} />
      <WhisperOverlay cycleId={cycle.id} />
    </div>
  );
}
