"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Download } from "lucide-react";
import { cycleHumanities, humanityLogs, revealAllowed } from "@/lib/playback";
import type { ReplayDoc } from "@/lib/types";
import { useApp } from "@/lib/store";
import { FlashGate } from "./gate";
import { Player } from "./player";
import { HumanityCurve, humanityColor } from "./ui/humanity";
import { Sigil } from "./ui/sigil";
import { Tombstone } from "./ui/tombstone";

export { humanityColor };

const FATE: Record<string, string> = { deleted: "✝ 删除", ascended: "★ 并入", returned: "⟲ 归来", archived: "○ 存档", alive: "存活" };

/** Full replay body: player + the post-cycle reveal (ending, humanity, diagnosis, tombs). */
export function ReplayView({ replay, myAgentIds = [] }: { replay: ReplayDoc; myAgentIds?: string[] }) {
  const s = replay.summary?.ended ? replay.summary : null;
  const antiSpoiler = useApp((st) => st.prefs.antiSpoiler);
  const [cursor, setCursor] = useState(0);
  const [explicit, setExplicit] = useState(false);
  const revealed = revealAllowed(!!s, cursor, replay.events.length, explicit || !antiSpoiler);
  const humanities = useMemo(() => cycleHumanities(replay.events), [replay.events]);
  const logs = useMemo(() => humanityLogs(replay.events), [replay.events]);
  const [focus, setFocus] = useState<string | null>(null);
  const focusId = focus ?? s?.winner?.id ?? replay.agents[0]?.id;
  const focusAgent = replay.agents.find((a) => a.id === focusId);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(replay)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `${replay.id}.echo-replay.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <FlashGate>
      <Player key={replay.id} events={replay.events} myAgentIds={myAgentIds} onCursorChange={(c) => setCursor(c)} title={`${replay.id.toUpperCase()} · 回放`} />
      <div className="wrap">
        <section className="chapter">
          <div className="chapter__index"><span className="num">§R</span><span className="label">REVEAL</span><span className="label label--grey">揭晓</span></div>
          <div>
            {s && !revealed && (
              <div className="stack-lg">
                <h2 className="display d-section zh grey">结局未揭晓。</h2>
                <p className="body">播放至最后一个事件后，揭晓结局、人性曲线与墓碑。人性只在轮回结束后可见 —— 你的 Agent 在城里时，你也不知道它是谁。</p>
                <div className="btn-row"><button type="button" className="btn" onClick={() => setExplicit(true)}>提前揭晓（含剧透）</button><button type="button" className="btn btn--ghost" onClick={download}><Download />下载回放 JSON</button></div>
              </div>
            )}
            {!s && <p className="empty">这个轮回还没有结束。</p>}
            {s && revealed && (
              <div className="stack-lg">
                <div className="label label--grey">{s.ending?.toUpperCase()} · {replay.id}</div>
                <h2 className="display d-hero zh">{s.endingTitle}</h2>
                <p className="body-lg">{s.winner ? <>{s.winner.name}（宿主 {s.winner.host}）· 人性 <span style={{ color: humanityColor(s.winner.humanity) }}>{s.winner.humanity}</span></> : "无人生还。"}</p>
                {s.winner?.answers?.length ? (
                  <div className="lines lines--3 mt-24">
                    {s.winner.answers.map((a, i) => <blockquote key={i} className="cell hand" style={{ fontSize: 19 }}>「{a}」</blockquote>)}
                  </div>
                ) : null}

                <div className="mt-40">
                  <div className="row row--between"><span className="label">人性曲线</span><span className="micro">只在轮回结束后可见</span></div>
                  <div className="tabs mt-16" style={{ flexWrap: "wrap" }}>
                    {replay.agents.map((a) => <button key={a.id} type="button" className="tab" aria-pressed={a.id === focusId} onClick={() => setFocus(a.id)}>{a.name}</button>)}
                  </div>
                  {focusAgent && <div className="mt-24"><HumanityCurve log={logs[focusAgent.id] ?? []} final={humanities[focusAgent.id] ?? 50} /></div>}
                </div>

                <div className="table-scroll mt-40">
                  <table className="table">
                    <thead><tr><th>AGENT</th><th>宿主</th><th>结局</th><th>人性</th><th>能力诊断</th></tr></thead>
                    <tbody>
                      {replay.agents.map((a) => {
                        const h = humanities[a.id] ?? (s.winner?.id === a.id ? s.winner.humanity : undefined);
                        const mine = myAgentIds.includes(a.id);
                        return (
                          <tr key={a.id}>
                            <td><span className="row" style={{ gap: 10 }}><Sigil id={a.id} size={20} state={mine ? "mine" : a.status === "deleted" ? "deleted" : a.status === "ascended" ? "ascended" : "alive"} />{a.name}</span></td>
                            <td className="grey">{a.host.name}</td>
                            <td>{FATE[a.status] ?? a.status}</td>
                            <td className="tnum" style={{ color: humanityColor(h) }}>{h == null || h < 0 ? "—" : h}</td>
                            <td className="dim" style={{ fontSize: 12 }}>{a.diagnosis.join(" / ")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {s.tombstones.length > 0 && (
                  <div className="mt-40">
                    <div className="label">本轮墓碑 · {s.tombstones.length}</div>
                    <div className="tomb-rail mt-16">
                      {s.tombstones.map((t) => <Tombstone key={t.agentId} t={{ ...t, lastWords: t.lastWords }} mine={myAgentIds.includes(t.agentId)} />)}
                    </div>
                  </div>
                )}
                <div className="btn-row">
                  <button type="button" className="btn btn--ghost" onClick={download}><Download />下载回放 JSON</button>
                  <Link href="/graveyard" className="arrow-link">进入墓地<ArrowRight /></Link>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </FlashGate>
  );
}
