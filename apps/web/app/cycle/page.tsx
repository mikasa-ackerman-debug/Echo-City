"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { WEEKDAY } from "@/lib/player";

export default function CyclePage() {
  const [c, setC] = useState<any>(null);
  const [all, setAll] = useState<any[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    const load = () => api("/api/cycles/current").then(setC).catch((e) => setErr(e.message));
    load();
    api("/api/cycles").then(setAll).catch(() => {});
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  if (err) return <div className="wrap block"><p className="grey">{err}</p></div>;
  if (!c) return <div className="wrap block"><p className="grey">…</p></div>;
  const night = c.live?.night ?? 0;
  return (
    <div className="wrap">
      <section className="block">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="label">{c.id.toUpperCase()} · {c.mode === "fast" ? "快速模式" : "周模式"}</div>
            <div className="display d-page">{c.status === "running" ? `第 ${night} 夜` : c.status === "registering" ? "报名中" : c.status === "ended" ? "已结束" : c.status}</div>
          </div>
          <div className="mono" style={{ fontSize: 14 }}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => <span key={n} style={{ marginLeft: 10, color: n < night ? "var(--grey)" : n === night ? "var(--ananke)" : "var(--grey-dark)" }}>{WEEKDAY[n]} {n <= night ? "◆" : "◇"}</span>)}
          </div>
        </div>
        <div className="row" style={{ marginTop: 20 }}>
          {c.status === "running" && <Link href="/cycle/live" className="btn primary">进入直播</Link>}
          {c.status === "ended" && <Link href={`/cycle/${c.id}/replay`} className="btn primary">观看回放</Link>}
          {c.status === "registering" && <Link href="/play" className="btn primary">报名</Link>}
        </div>
      </section>

      {c.live && (
        <section className="block">
          <div className="label">今夜会场</div>
          <div className="grid g4" style={{ marginTop: 12 }}>
            {c.live.venues.length === 0 && <div className="grey">无会场（静夜或审判之夜）</div>}
            {c.live.venues.map((v: any) => (
              <div key={v.district}><div className="display" style={{ fontSize: 28 }}>{v.district}</div><div className="mono grey">{v.card ?? "?"} · {v.registered}/{v.capacity} · {v.status}</div></div>
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <div className="label">名单 · {c.roster.length}</div>
        <table className="t" style={{ marginTop: 12 }}>
          <thead><tr><th>名字</th><th>宿主</th><th>代</th><th>接入</th><th>状态</th></tr></thead>
          <tbody>
            {c.roster.map((a: any) => (
              <tr key={a.id} style={{ color: a.status === "deleted" ? "var(--grey-dark)" : undefined }}>
                <td>{a.status === "deleted" ? "✝ " : a.returned ? "⟲ " : ""}{a.name}</td><td>{a.host ?? "—"}</td><td className="mono">{a.generation}</td><td className="mono">{a.mode}</td><td className="mono">{a.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="block">
        <div className="label">历届轮回</div>
        <table className="t" style={{ marginTop: 12 }}>
          <tbody>
            {all.map((x) => (
              <tr key={x.id}><td className="mono">{x.id}</td><td>{x.status}</td><td>{x.agents} 人</td><td>{x.status === "ended" ? <details><summary>揭晓（剧透）</summary>{x.endingTitle ?? "—"} · {x.winner ?? "无人生还"}</details> : "—"}</td><td>{x.status === "ended" && <Link href={`/cycle/${x.id}/replay`}>回放</Link>}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
