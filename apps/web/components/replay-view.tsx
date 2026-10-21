"use client";
import { Player } from "./player";
import { Tomb } from "./tomb";

/** Full replay page body: player + post-cycle reveal (humanity, diagnosis). */
export function ReplayView({ replay, myAgentIds = [] }: { replay: any; myAgentIds?: string[] }) {
  const s = replay.summary;
  return (
    <div>
      <div className="statusbar"><span>{replay.id} · 回放 · 种子 {replay.seed}</span><span>{s?.endingTitle ?? ""}</span></div>
      <Player events={replay.events} myAgentIds={myAgentIds} />
      <div className="wrap">
        {s && (
          <section className="block">
            <div className="label">揭晓</div>
            <div className="display d-hero">{s.endingTitle}</div>
            <p className="dim">{s.winner ? `${s.winner.name}（宿主 ${s.winner.host}）· 人性 ${s.winner.humanity}` : "无人生还"}</p>
            <table className="t" style={{ marginTop: 16 }}>
              <thead><tr><th>AGENT</th><th>状态</th><th>人性</th><th>能力诊断</th></tr></thead>
              <tbody>
                {replay.agents.map((a: any) => {
                  const t = s.tombstones?.find((x: any) => x.id === a.id || x.agentId === a.id || x.name === a.name);
                  const h = t?.humanity ?? (s.winner?.id === a.id ? s.winner.humanity : undefined);
                  return (
                    <tr key={a.id}>
                      <td style={{ color: myAgentIds.includes(a.id) ? "var(--ember)" : undefined }}>{a.name}</td>
                      <td className="mono">{a.status}</td>
                      <td className="mono" style={{ color: humanityColor(h) }}>{h == null || h < 0 ? "—" : h}</td>
                      <td className="dim" style={{ fontSize: 12 }}>{(a.diagnosis ?? []).join(" / ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
        {s?.tombstones?.length > 0 && (
          <section className="block">
            <div className="label">本周墓碑</div>
            <div className="scroll-x" style={{ marginTop: 12 }}>{s.tombstones.map((t: any) => <Tomb key={t.name} t={{ ...t, lastWords: t.lastWords ?? t.last_words }} />)}</div>
          </section>
        )}
      </div>
    </div>
  );
}

/** FRONTEND 4.1 humanity gradient — only shown after the cycle. */
export function humanityColor(h?: number) {
  if (h == null || h < 0) return undefined;
  if (h >= 100) return "#ff6a2b";
  if (h >= 60) return "#ffb38a";
  if (h >= 30) return "#8c9096";
  return "#4f535a";
}
