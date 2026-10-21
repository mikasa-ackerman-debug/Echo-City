"use client";
import type { CycleEvent } from "@echo/engine";
import { useEffect, useMemo, useState } from "react";
import { Stage } from "./stage";
import { deriveView, markers, REASON_ZH, suitClass } from "@/lib/player";

/**
 * Live / replay player (FRONTEND 6.3 / 6.4). Same component for both:
 * live = the cursor follows the end; replay = free scrubbing, default 2×.
 */
export function Player({ events, live = false, myAgentIds = [] }: { events: CycleEvent[]; live?: boolean; myAgentIds?: string[] }) {
  const [cursor, setCursor] = useState(live ? events.length : 0);
  const [following, setFollowing] = useState(live);
  const [playing, setPlaying] = useState(!live);
  const [speed, setSpeed] = useState(2);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);

  useEffect(() => {
    if (following) setCursor(events.length);
  }, [events.length, following]);

  useEffect(() => {
    if (!playing || following) return;
    const t = setInterval(() => {
      setCursor((c) => {
        if (c >= events.length) {
          setPlaying(false);
          return c;
        }
        let n = c + 1;
        if (mineOnly && myAgentIds.length) {
          const names = new Set(myAgentIds);
          while (n < events.length && !touches(events[n - 1], names)) n++;
        }
        return n;
      });
    }, 400 / speed);
    return () => clearInterval(t);
  }, [playing, following, speed, events, mineOnly, myAgentIds]);

  const view = useMemo(() => deriveView(events, cursor), [events, cursor]);
  const marks = useMemo(() => markers(events), [events]);
  const tonight = view.venues.filter((v) => v.night === view.night);
  const venue = view.venues.find((v) => v.id === venueId) ?? tonight[tonight.length - 1] ?? view.venues[view.venues.length - 1];
  const feed = events.slice(Math.max(0, cursor - 80), cursor).filter((e) => e.text).reverse();
  const alive = view.order.map((id) => view.agents[id]).filter((a) => a.status === "alive");
  const dead = view.order.map((id) => view.agents[id]).filter((a) => a.status === "deleted");

  return (
    <div>
      <div className="live">
        <aside>
          <div className="label">今夜会场</div>
          {tonight.length === 0 && <p className="grey" style={{ fontSize: 13 }}>白天。城市在移动。</p>}
          {tonight.map((v) => (
            <button key={v.id} className={`venue-btn ${venue?.id === v.id ? "on" : ""}`} onClick={() => setVenueId(v.id)}>
              {v.ended ? "○" : "●"} {v.district} <span className={suitClass(v.card)}>{v.card}</span>
            </button>
          ))}
          {view.venues.length > tonight.length && (
            <details style={{ marginTop: 12 }}>
              <summary className="label" style={{ cursor: "pointer" }}>往夜会场</summary>
              {view.venues.filter((v) => v.night !== view.night).map((v) => (
                <button key={v.id} className={`venue-btn ${venue?.id === v.id ? "on" : ""}`} onClick={() => setVenueId(v.id)}>
                  N{v.night} {v.district} <span className={suitClass(v.card)}>{v.card}</span>
                </button>
              ))}
            </details>
          )}
          <div className="label" style={{ marginTop: 24 }}>存活 {alive.length} / {view.order.length}</div>
          {alive.map((a) => (
            <div key={a.id} className="row" style={{ fontSize: 13, justifyContent: "space-between", color: myAgentIds.includes(a.id) ? "var(--ember)" : undefined }}>
              <span>{a.name}</span>
              <span className="mono grey">{a.uptime != null ? "▮".repeat(Math.max(0, a.uptime)) : ""} {a.location ?? ""}</span>
            </div>
          ))}
          {dead.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="label" style={{ cursor: "pointer" }}>✝ 已删除 {dead.length}</summary>
              {dead.map((a) => (
                <div key={a.id} style={{ fontSize: 12, color: "var(--grey-dark)", margin: "4px 0" }}>✝ {a.name} · N{a.deletedNight} {a.card ?? REASON_ZH[a.reason ?? ""] ?? ""}</div>
              ))}
            </details>
          )}
        </aside>

        <main>
          {view.amendment && <div className="label" style={{ marginBottom: 8 }}>本周修正：{view.amendment}</div>}
          <div className="narrator ananke">{view.narrator || "……"}</div>
          {view.ending ? (
            <div style={{ padding: "24px 0" }}>
              <div className="label">结局</div>
              <div className={`display d-hero ${view.ending.title.includes("余烬") ? "ember" : ""}`}>{view.ending.title}</div>
              <p className="dim">{view.ending.winner ? `最后的生还者：${view.ending.winner}` : "无人生还。"}</p>
            </div>
          ) : venue ? (
            <Stage venue={venue} />
          ) : (
            <p className="grey">今夜的会场尚未亮灯。</p>
          )}
        </main>

        <aside>
          <div className="label">事件流</div>
          <div className="feed">
            {feed.map((e) => (
              <div key={e.seq} className={`ev ${e.type === "agent_deleted" ? "del" : ""}`}>
                <span className="mono grey" style={{ fontSize: 10 }}>N{e.night} </span>
                {e.type === "agent_deleted" ? <><b>✝ </b>{e.text}{(e.data as any).last_words && <div className="ember" style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>「{(e.data as any).last_words}」</div>}</> : e.type === "thought" ? <span className="dim">💭 {e.text}</span> : e.text}
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="timeline">
        <button className="btn" onClick={() => { setFollowing(false); setCursor((c) => Math.max(0, c - 20)); }}>◀◀</button>
        <button className="btn" onClick={() => { setFollowing(false); setPlaying((p) => !p); }}>{playing && !following ? "❚❚" : "▶"}</button>
        <button className="btn" onClick={() => { setFollowing(false); setCursor((c) => Math.min(events.length, c + 20)); }}>▶▶</button>
        <div style={{ flex: 1, position: "relative" }}>
          <input type="range" min={0} max={events.length} value={cursor} style={{ width: "100%" }} onChange={(e) => { setFollowing(false); setCursor(Number(e.target.value)); }} />
          <div style={{ position: "relative", height: 14 }}>
            {marks.filter((m) => m.glyph !== "│" || true).map((m) => (
              <span key={m.index} title={m.label} onClick={() => { setFollowing(false); setCursor(m.index + 1); }} style={{ position: "absolute", left: `${(m.index / Math.max(1, events.length)) * 100}%`, cursor: "pointer", fontSize: 10, color: m.glyph === "◆" ? "var(--ember)" : "var(--grey)" }}>{m.glyph}</span>
            ))}
          </div>
        </div>
        <span>{cursor}/{events.length}</span>
        <select className="input" style={{ width: 70 }} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {[1, 2, 4, 8].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        {myAgentIds.length > 0 && <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />只看我的</label>}
        {live && <button className={`btn ${following ? "primary" : ""}`} onClick={() => setFollowing(true)}><span className="live-dot" />LIVE</button>}
      </div>
    </div>
  );
}

function touches(e: CycleEvent, ids: Set<string>) {
  const d = e.data as any;
  if (e.owners?.some((o) => ids.has(o))) return true;
  if (d?.id && ids.has(d.id)) return true;
  return e.type === "dawn" || e.type === "cycle_end" || e.type === "trial_start";
}
