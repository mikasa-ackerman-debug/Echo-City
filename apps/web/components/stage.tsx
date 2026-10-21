"use client";
import type { CycleEvent } from "@echo/engine";
import { suitClass, type VenueLite } from "@/lib/player";

/**
 * Trial stage (FRONTEND 7.1): shared shell + per-trial body.
 * Every body is a pure function of the venue's round events — no engine state needed.
 */
export function Stage({ venue }: { venue: VenueLite }) {
  const last = venue.last;
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="label">{venue.district} · 第 {venue.night} 夜</div>
          <div className="display d-section">
            <span className={suitClass(venue.card)}>{venue.card}</span> {venue.name}
          </div>
        </div>
        <div className="mono grey" style={{ fontSize: 12 }}>
          {venue.rounds.filter((r) => r.type !== "rule_added").length} 回合 · {venue.ended ? "已结算" : "进行中"}
        </div>
      </div>
      {venue.rules && <p className="dim" style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{venue.rules}</p>}
      <Seats venue={venue} />
      <div style={{ marginTop: 20 }}>{last ? <RoundBody e={last} /> : <p className="grey">等待第一回合……</p>}</div>
      {venue.rounds.filter((r) => r.type === "rule_added").map((r) => (
        <p key={r.seq} className="ananke" style={{ fontSize: 13 }}>⟲ {(r.data as any).rule}</p>
      ))}
      {venue.messages.length > 0 && (
        <div className="feed" style={{ marginTop: 16 }}>
          <div className="label">会场对话</div>
          {venue.messages.slice(-12).map((m) => <div key={m.seq} className="ev">{m.text}</div>)}
        </div>
      )}
    </div>
  );
}

function Seats({ venue }: { venue: VenueLite }) {
  return (
    <div className="row" style={{ marginTop: 16 }}>
      {venue.players.map((name) => {
        const o = venue.outcomes?.[name];
        const dead = o === "delete";
        return (
          <div key={name} className={`seat ${dead ? "dead deleted-flash" : ""}`}>
            <div className="big">{dead ? "✝" : o === "win" ? "★" : o === "pass" ? "✓" : "·"}</div>
            <div>{name}</div>
            {o && <div className="mono grey" style={{ fontSize: 10 }}>{o}</div>}
          </div>
        );
      })}
    </div>
  );
}

function KV({ obj }: { obj: Record<string, unknown> }) {
  return (
    <table className="t">
      <tbody>
        {Object.entries(obj).map(([k, v]) => (
          <tr key={k}><td>{k}</td><td className="mono">{typeof v === "object" ? JSON.stringify(v) : String(v)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function RoundBody({ e }: { e: CycleEvent }) {
  const d = e.data as any;
  switch (e.type) {
    case "beauty_round":
    case "joker_duel_round":
      return (
        <div>
          <div className="label">第 {d.round} 回合 · 平均 {d.average?.toFixed?.(2) ?? "—"} · 目标 {d.target?.toFixed?.(2) ?? "—"}</div>
          <BarChart values={d.picks ?? {}} max={100} highlight={d.winners ?? []} />
        </div>
      );
    case "lifeboat_round":
      return (
        <div>
          <div className="label">第 {d.round} 回合 · 投入 {d.total} / {d.threshold} · {d.ok ? "引擎还在转" : "熄火"}</div>
          <div className="bar" style={{ margin: "10px 0" }}><span style={{ width: `${Math.min(100, (d.total / Math.max(1, d.threshold)) * 100)}%`, background: d.ok ? "var(--suit-club)" : "var(--alert)" }} /></div>
          <BarChart values={d.inputs ?? {}} max={4} />
        </div>
      );
    case "collar_declare":
      return (<div><div className="label">第 {d.round} 回合宣告</div><KV obj={d.declarations ?? {}} /></div>);
    case "corridor_round":
      return (
        <div>
          <div className="label">第 {d.round} 回合</div>
          <table className="t"><tbody>{(d.guesses ?? []).map((g: any, i: number) => <tr key={i}><td>{g.agent}</td><td className="mono">{g.guess}</td><td className="mono">●{g.exact} ○{g.partial}</td></tr>)}</tbody></table>
        </div>
      );
    case "hound_round":
      return <HoundGrid d={d} />;
    default:
      return (<div><div className="label">{e.type}</div>{e.text && <p>{e.text}</p>}{d && typeof d === "object" && <KV obj={Object.fromEntries(Object.entries(d).filter(([k]) => k !== "venue"))} />}</div>);
  }
}

function BarChart({ values, max, highlight = [] }: { values: Record<string, number | null>; max: number; highlight?: string[] }) {
  return (
    <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
      {Object.entries(values).map(([name, v]) => (
        <div key={name} className="row" style={{ gap: 8, fontSize: 12 }}>
          <span style={{ width: 90, color: highlight.includes(name) ? "var(--ananke)" : undefined }}>{name}</span>
          <div className="bar" style={{ flex: 1 }}><span style={{ width: `${v == null ? 0 : (v / max) * 100}%`, background: highlight.includes(name) ? "var(--ananke)" : undefined }} /></div>
          <span className="mono" style={{ width: 32, textAlign: "right" }}>{v ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

function HoundGrid({ d }: { d: any }) {
  const size = d.size ?? 12;
  const pos: Record<string, [number, number]> = d.positions ?? {};
  const hound: [number, number] | undefined = d.hound;
  const cells = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const who = Object.entries(pos).find(([, p]) => p && p[0] === x && p[1] === y)?.[0];
      const isHound = hound && hound[0] === x && hound[1] === y;
      cells.push(
        <div key={`${x},${y}`} title={who} style={{ aspectRatio: "1", border: "1px solid var(--line)", display: "grid", placeItems: "center", fontSize: 10, background: isHound ? "var(--alert)" : who ? "var(--paper-dim)" : undefined, color: "var(--ink)" }}>
          {isHound ? "犬" : who ? who[0] : ""}
        </div>,
      );
    }
  return (
    <div>
      <div className="label">第 {d.round} 回合 · 猎犬</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${size}, 1fr)`, maxWidth: 420, marginTop: 8 }}>{cells}</div>
      {d.caught?.length ? <p className="alert">被捕获：{d.caught.join("、")}</p> : null}
    </div>
  );
}
