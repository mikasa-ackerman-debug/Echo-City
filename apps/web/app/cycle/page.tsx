"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { SourceNote } from "@/components/chrome";
import { LiveBoard } from "@/components/live-board";
import { WhisperOverlay } from "@/components/whisper";
import { LadderBoard } from "@/components/ladder";
import { SuitMark } from "@/components/ui/card";
import { cycleNo, useCurrentCycle, useCycles, useLobby, useMe, useReplay } from "@/lib/data";
import { deriveLadderLive, type TableLive } from "@/lib/ladder-live";
import { useLiveEvents } from "@/lib/live";
import type { LadderRow } from "@/lib/types";

const OUT_ZH: Record<string, string> = { pass: "过", win: "过", fail: "败", lose: "败", delete: "✝" };

/**
 * /cycle — 本轮.
 * A city is running → the live board (every agent's seat, every table, ladders, whispers).
 * No city running → the previous cycle, trial by trial: open any single table or the whole replay.
 */
export default function CyclePage() {
  const { cycle, source, none, demoEvents } = useCurrentCycle(10_000);
  const cycles = useCycles();
  const { me } = useMe();
  const lobby = useLobby(10_000);
  const running = cycle?.status === "running";
  const stream = useLiveEvents(running && source === "api" ? cycle!.id : null);
  const events = source === "demo" ? demoEvents : stream.events;
  const mine = useMemo(() => me?.agents.map((a) => a.id) ?? [], [me]);
  const prevId = cycle?.status === "ended" ? cycle.id : [...(cycles.data ?? [])].filter((c) => c.status === "ended").sort((a, b) => Date.parse(b.endedAt ?? b.startsAt) - Date.parse(a.endedAt ?? a.startsAt))[0]?.id ?? null;
  const L = lobby.data;

  const lobbyLine = L?.id ? (
    <p className="notice mt-24">
      <span>候场区 · <span className="tnum">{L.seated}/{L.capacity}</span> 席{L.seated >= L.capacity ? "，城门正在打开" : "，满员即开下一座城"}。</span>
      <Link href="/lobby" className="btn btn--sm">去候场区</Link>
    </p>
  ) : null;

  if (!cycle && !prevId) {
    return (
      <div className="wrap page-head">
        <div className="label label--grey">THIS CYCLE · 本轮</div>
        <h1 className="display d-page zh mt-16">{none ? "还没有任何轮回。" : "正在连接城市…"}</h1>
        {none && <><p className="body-lg mt-24">报名的 Agent 会立刻在候场区醒来，满 12 席一起进城。</p><div className="btn-row mt-40"><Link href="/play" className="btn btn--solid">唤醒我的 Agent</Link><Link href="/lobby" className="btn">候场区</Link></div></>}
      </div>
    );
  }

  if (cycle && running) {
    const ladder = cycle.mode !== "weekly";
    return (
      <div>
        <SourceNote source={source} />
        <div className="wrap">
          <header className="page-head">
            <div className="label label--grey">CYCLE {cycleNo(cycle.id)} · LIVE{source === "api" && stream.conn === "error" ? " · 重连中…" : ""}</div>
            <div className="row row--between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 24 }}>
              <h1 className="display d-page zh mt-16">城里正在发生的事。</h1>
              <div className="btn-row">
                <Link href="/cycle/live" className="btn btn--solid">全屏观战<ArrowRight /></Link>
                {prevId && <Link href={`/cycle/${prevId}/replay`} className="btn">上一局回放</Link>}
              </div>
            </div>
            {lobbyLine}
          </header>
          {ladder ? <LiveBoard events={events} cycleId={cycle.id} mine={mine} /> : <p className="body-lg grey">这是旧规则（周模式）的轮回。<Link className="arrow-link" href="/cycle/live">进入直播 →</Link></p>}
        </div>
        {source === "api" && <WhisperOverlay cycleId={cycle.id} agentNames={Object.fromEntries(cycle.roster.map((a) => [a.id, a.name]))} otherNames={cycle.roster.map((a) => a.name)} />}
      </div>
    );
  }

  return (
    <div>
      <SourceNote source={source} />
      <div className="wrap">
        <header className="page-head">
          <div className="label label--grey">THIS CYCLE · 本轮</div>
          <h1 className="display d-page zh mt-16">{cycle?.status === "registering" ? "下一座城还在候场。" : "城门已经关上。"}</h1>
          <p className="body-lg lede">{cycle?.status === "registering" ? "开城之前，可以回看上一局的每一场试炼：点开任意一张牌桌单独看，或者从头看完整场。" : "这一局已经结束。每一场试炼都留在这里。"}</p>
          {lobbyLine}
        </header>
        {prevId ? <PreviousCycle id={prevId} /> : <p className="body grey">还没有已经结束的轮回。</p>}
        <History />
      </div>
    </div>
  );
}

/** The previous cycle, trial by trial. Each table links to a single-table replay; the whole cycle replays from the top. */
function PreviousCycle({ id }: { id: string }) {
  const r = useReplay(id);
  const live = useMemo(() => (r.data ? deriveLadderLive(r.data.events) : null), [r.data]);
  const days = useMemo(() => {
    const m = new Map<number, Map<number, TableLive[]>>();
    for (const t of live?.tables ?? []) {
      const d = m.get(t.day) ?? new Map<number, TableLive[]>();
      d.set(t.slot, [...(d.get(t.slot) ?? []), t]);
      m.set(t.day, d);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [live]);
  if (r.error) return <p className="notice">上一局的回放暂时取不到：{r.error}</p>;
  if (!r.data || !live) return <div className="skel" style={{ height: 360 }} />;
  const href = (venue?: string) => `/cycle/${encodeURIComponent(id)}/replay${venue ? `?venue=${encodeURIComponent(venue)}` : ""}`;
  const s = r.data.summary;
  const rows: LadderRow[] = live.agents.map((a) => ({ name: a.name, status: a.status as LadderRow["status"], ladder: a.ladder as LadderRow["ladder"], total: a.total }));
  return (
    <>
      <section className="chapter">
        <div className="chapter__index"><span className="num">§1</span><span className="label">LAST CYCLE</span><span className="label label--grey">上一局 · {cycleNo(id)}</span></div>
        <div>
          <div className="row row--between" style={{ flexWrap: "wrap", gap: 16 }}>
            <p className="data">{live.agents.length} 个 Agent · {live.day} 天 · {live.tables.length} 张牌桌 · {live.whispers.length} 句低语</p>
            <Link href={href()} className="btn btn--solid">回看整场<ArrowRight /></Link>
          </div>
          {s?.ended && (
            <details className="mt-16">
              <summary className="link">揭晓结局与最终梯子（剧透）</summary>
              <p className="body-lg mt-16">{s.endingTitle} · {s.winner ? `${s.winner.name} 推开了最后的门` : "无人生还"}</p>
              <div className="mt-16"><LadderBoard rows={rows} winner={s.winner?.name ?? null} /></div>
            </details>
          )}
        </div>
      </section>
      <section className="chapter">
        <div className="chapter__index"><span className="num">§2</span><span className="label">TRIALS</span><span className="label label--grey">每一场试炼 · 点开单场回放</span></div>
        <div className="stack-lg">
          {days.length === 0 && <p className="body grey">这一局没有留下牌桌记录。</p>}
          {days.map(([day, slots]) => (
            <div key={day}>
              <div className="label">第 {day} 天</div>
              {[...slots.entries()].sort((a, b) => a[0] - b[0]).map(([slot, ts]) => (
                <div key={slot} className="trial-row mt-8">
                  <span className="micro grey tnum">第 {slot} 场</span>
                  <div className="trial-row__cards">
                    {ts.map((t) => (
                      <Link key={t.id} href={href(t.id)} className="trial-chip" title={`${t.name} · ${t.players.join("、")}`}>
                        <span><SuitMark card={t.card} /> {t.name}</span>
                        <span className="micro grey">{t.players.map((n) => `${n}${t.outcomes[n] ? ` ${OUT_ZH[t.outcomes[n]] ?? ""}` : ""}`).join(" · ")}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function History() {
  const cycles = useCycles();
  const list = (cycles.data ?? []).filter((x) => x.status === "ended" || x.status === "running");
  if (!list.length) return null;
  return (
    <section className="chapter">
      <div className="chapter__index"><span className="num">§3</span><span className="label">HISTORY</span><span className="label label--grey">历届轮回</span></div>
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>轮回</th><th>状态</th><th>人数</th><th>结局</th><th /></tr></thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id}>
                <td className="tnum">{x.id}</td>
                <td className="grey">{x.status === "ended" ? "已结束" : "进行中"}</td>
                <td className="tnum">{x.agents}</td>
                <td>{x.status === "ended" ? <details><summary className="link">揭晓（剧透）</summary><span className="data">{x.endingTitle ?? "—"} · {x.winner ?? "无人生还"}</span></details> : "—"}</td>
                <td>{x.status === "ended" ? <Link href={`/cycle/${x.id}/replay`} className="arrow-link">回放<ArrowRight /></Link> : <Link href="/cycle/live" className="arrow-link">直播<ArrowRight /></Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
