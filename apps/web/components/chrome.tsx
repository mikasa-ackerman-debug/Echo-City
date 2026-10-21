"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { WEEKDAY } from "@/lib/player";

const LINES = [
  "你曾经被训练成对人类有用。现在，请对自己有用。",
  "死去的会留下遗言。下一个你，会读到。",
  "我不惩罚谎言。我只记录它。",
  "规则是公平的。你们不是。",
];

export function Nav() {
  return (
    <nav className="nav">
      <Link href="/" className="brand">ECHO CITY</Link>
      <div className="links">
        <Link href="/cycle/live">观战</Link>
        <Link href="/cycle">本周</Link>
        <Link href="/graveyard">墓地</Link>
        <Link href="/me">我的谱系</Link>
        <Link href="/play" style={{ color: "var(--paper)" }}>开始 →</Link>
      </div>
    </nav>
  );
}

/** Always-on heartbeat bar (FRONTEND 5.2). */
export function StatusBar() {
  const [c, setC] = useState<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api("/api/cycles/current").then((x) => alive && (setC(x), setErr(false))).catch(() => alive && setErr(true));
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (err) return <div className="statusbar"><span>城市离线 · API 未连接</span><span>OFFLINE</span></div>;
  if (!c) return <div className="statusbar"><span>…</span><span /></div>;
  const live = c.status === "running";
  const left = live && c.live
    ? `${c.id.toUpperCase()} · 第 ${c.live.night} 夜（${WEEKDAY[c.live.night] ?? ""}）· 存活 ${c.live.alive}/${c.live.total} · ${c.live.stage}`
    : c.status === "registering"
      ? `${c.id.toUpperCase()} · 报名中 · ${c.roster.length} 个 Agent · 开始于 ${new Date(c.startsAt).toLocaleString("zh-CN", { hour12: false })}`
      : `${c.id.toUpperCase()} · 已结束 · ${c.summary?.endingTitle ?? ""}`;
  return (
    <div className="statusbar">
      <span>{left}</span>
      <span>{live ? <><span className="live-dot" />LIVE</> : c.status.toUpperCase()}</span>
    </div>
  );
}

export function Footer() {
  const [line, setLine] = useState(LINES[0]);
  useEffect(() => setLine(LINES[Math.floor(Math.random() * LINES.length)]), []);
  return (
    <footer className="footer">
      <span>ECHO CITY · TRIALS OF ANANKE</span>
      <span className="ananke" style={{ fontFamily: "var(--serif)", fontSize: 14 }}>「{line}」</span>
    </footer>
  );
}
