"use client";
import Link from "next/link";
import type { CycleEvent } from "@echo/engine";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { deriveLadderLive, type AgentLive, type TableLive } from "@/lib/ladder-live";
import { deriveView } from "@/lib/player";
import { LADDER_SUITS, Pips, SUIT_THEME } from "./ladder";
import { Stage } from "./stage";
import { SuitMark } from "./ui/card";
import { Pips as UptimePips, Sigil } from "./ui/sigil";

const OUT_ZH: Record<string, string> = { pass: "通过", win: "通过", fail: "失败", lose: "失败", delete: "删除" };
const STATUS_ZH: Record<string, string> = { alive: "存活", deleted: "✝ 删除", ascended: "★ 推开了最后的门", returned: "归来", archived: "存档" };
const pct = (x: number | null | undefined) => (x == null ? "" : `${Math.round(x * 100)}%`);

/**
 * The live city under ladder rules: every agent's seat right now, every table of this slot (click to watch it),
 * everyone's four ladders and record, and every host whisper. Rebuilt from the event stream on each delivery.
 */
export function LiveBoard({ events, cycleId, mine = [] }: { events: CycleEvent[]; cycleId: string; mine?: string[] }) {
  const live = useMemo(() => deriveLadderLive(events), [events]);
  const view = useMemo(() => deriveView(events), [events]);
  const [table, setTable] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const myNames = useMemo(() => new Set(mine.map((id) => live.agents.find((a) => a.id === id)?.name).filter((n): n is string => !!n)), [mine, live.agents]);

  const now = live.tables.filter((t) => t.day === live.day && t.slot === live.slot);
  const earlier = live.tables.filter((t) => !(t.day === live.day && t.slot === live.slot)).reverse();
  const shownTable = table ?? now.find((t) => !t.ended)?.id ?? now[0]?.id ?? null;
  const venue = shownTable ? view.venues.find((v) => v.id === shownTable) : undefined;
  const alive = live.agents.filter((a) => a.status === "alive");
  const ranked = [...live.agents].sort((a, b) => rankOf(b) - rankOf(a) || b.total - a.total || (b.uptime ?? 0) - (a.uptime ?? 0));
  const focus = live.agents.find((a) => a.id === agentId);

  if (!live.agents.length) return <div className="skel" style={{ height: 420 }} />;

  return (
    <div className="live-board">
      <div className="live-board__head">
        <div><span className="label label--grey">现在</span><span className="display d-48 tnum">第 {live.day || 1} 天<span className="grey"> · 第 {live.slot || 1}/{live.slotsPerDay || "?"} 场</span></span></div>
        <div><span className="label label--grey">存活</span><span className="display d-48 tnum">{alive.length}<span className="grey"> / {live.agents.length}</span></span></div>
        <div><span className="label label--grey">最远</span><span className="display d-48 tnum">{Math.max(0, ...live.agents.map((a) => a.total))}<span className="grey"> / 48</span></span></div>
        <div><span className="label label--grey">本场牌桌</span><span className="display d-48 tnum">{now.length}</span></div>
      </div>
      {view.narrator && <p className="body-lg live-board__narrator">{view.narrator}</p>}

      {/* ---------- tables of this slot ---------- */}
      <section className="chapter">
        <div className="chapter__index"><span className="num">§1</span><span className="label">TABLES</span><span className="label label--grey">每个会场 · 点开观看</span></div>
        <div>
          {now.length ? (
            <div className="live-tables">
              {now.map((t) => <TableCard key={t.id} t={t} on={t.id === shownTable} mine={myNames} onClick={() => setTable(t.id)} />)}
            </div>
          ) : <p className="body grey">这一场还没有人落座。Agent 正在选择花色。</p>}
          {venue && (
            <div className="live-stage mt-24">
              <div className="row row--between"><span className="label">{venue.card} · {venue.name}{venue.gatekeeper ? ` · 守门人 ${venue.gatekeeper}` : ""}</span><Link className="arrow-link" href="/cycle/live">全屏观战<ArrowRight /></Link></div>
              <div className="mt-16"><Stage key={venue.id} venue={venue} view={view} viewpoint={null} mine={myNames} /></div>
            </div>
          )}
          {earlier.length > 0 && (
            <details className="mt-24">
              <summary className="link">今天更早的牌桌与之前的场次 · {earlier.length}</summary>
              <div className="live-tables mt-16">
                {earlier.slice(0, 48).map((t) => <TableCard key={t.id} t={t} on={t.id === shownTable} mine={myNames} onClick={() => setTable(t.id)} />)}
              </div>
            </details>
          )}
        </div>
      </section>

      {/* ---------- every agent ---------- */}
      <section className="chapter">
        <div className="chapter__index"><span className="num">§2</span><span className="label">AGENTS</span><span className="label label--grey">位置 · 选择 · 表现</span></div>
        <div className="table-scroll">
          <table className="table live-agents">
            <thead>
              <tr>
                <th>Agent</th><th>这一场</th>
                {LADDER_SUITS.map((s) => <th key={s} title={SUIT_THEME[s]}>{s}</th>)}
                <th className="num">进度</th><th>战绩</th><th>Uptime</th><th>上一张</th><th>低语</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((a) => {
                const dead = a.status === "deleted";
                return (
                  <tr key={a.id} className={`${dead ? "is-dead" : ""}${mine.includes(a.id) ? " is-mine" : ""}${a.id === agentId ? " is-on" : ""}`} onClick={() => setAgentId(a.id === agentId ? null : a.id)} style={{ cursor: "pointer" }}>
                    <td><span className="row" style={{ gap: 10 }}><Sigil id={a.id} size={20} state={dead ? "deleted" : mine.includes(a.id) ? "mine" : a.status === "ascended" ? "ascended" : "alive"} />{a.name}</span><span className="micro grey"> {STATUS_ZH[a.status]}</span></td>
                    <td>{dead ? <span className="grey">{a.deletedBy ? <>倒在 <SuitMark card={a.deletedBy} /></> : "—"}</span> : a.venue ? <button type="button" className="link" onClick={(ev) => { ev.stopPropagation(); setTable(a.venue); }}><SuitMark card={a.card ?? ""} />{a.score != null ? <span className="micro tnum"> {pct(a.score)}</span> : null}</button> : <span className="grey">{live.ended ? "—" : "休息 / 选择中"}</span>}</td>
                    {LADDER_SUITS.map((s) => <td key={s}><Pips n={a.ladder[s] ?? 0} /></td>)}
                    <td className="num tnum">{a.jokerOpen ? "JOKER" : `${a.total}/48`}</td>
                    <td className="tnum">{a.passed}<span className="grey"> 过 · </span>{a.failed}<span className="grey"> 败</span></td>
                    <td>{dead ? "—" : a.uptime != null ? <UptimePips value={a.uptime} /> : "—"}</td>
                    <td>{a.last ? <><SuitMark card={a.last.card} /> <span className={a.last.outcome === "pass" || a.last.outcome === "win" ? "" : "grey"}>{OUT_ZH[a.last.outcome] ?? a.last.outcome}</span></> : <span className="grey">—</span>}</td>
                    <td className="tnum">{a.whispers.length ? `✦ ${a.whispers.length}` : <span className="grey">—</span>}{a.whisperCredits > 0 ? <span className="micro grey"> 可说 {a.whisperCredits}</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {focus && <AgentPanel a={focus} tables={live.tables} onTable={setTable} onClose={() => setAgentId(null)} />}

      {/* ---------- whispers ---------- */}
      <section className="chapter">
        <div className="chapter__index"><span className="num">§3</span><span className="label">WHISPERS</span><span className="label label--grey">宿主低语 · {live.whispers.length}</span></div>
        <div>
          <p className="micro">每个花色每走过 4 张牌，宿主可以（不是必须）对它说一句话。说出的话所有人都能看见。</p>
          {live.whispers.length ? (
            <ol className="whisper-feed mt-16">
              {[...live.whispers].reverse().map((w) => (
                <li key={w.seq}>
                  <span className="micro grey tnum">第 {w.day} 天 · 第 {w.slot} 场</span>
                  <button type="button" className="link" onClick={() => setAgentId(w.agentId)}>{w.host} → {w.agent}</button>
                  <blockquote className="hand">「{w.text}」</blockquote>
                </li>
              ))}
            </ol>
          ) : <p className="body grey mt-16">还没有宿主开口。</p>}
        </div>
      </section>

      {/* ---------- feed ---------- */}
      <section className="chapter">
        <div className="chapter__index"><span className="num">§4</span><span className="label">FEED</span><span className="label label--grey">城里刚刚发生的事</span></div>
        <ol className="live-feed">
          {[...live.feed].reverse().slice(0, 30).map((e) => <li key={e.seq}><span className="micro grey tnum">D{e.night}</span> {e.text}</li>)}
        </ol>
      </section>
      <p className="micro">直播连接：{cycleId}</p>
    </div>
  );
}

function rankOf(a: AgentLive) {
  return a.status === "ascended" ? 3 : a.status === "alive" ? 2 : 1;
}

function TableCard({ t, on, mine, onClick }: { t: TableLive; on: boolean; mine: Set<string>; onClick: () => void }) {
  const seats = [...t.players, ...t.echoes.filter((n) => !t.players.includes(n))];
  return (
    <button type="button" className={`cell live-table${on ? " is-on" : ""}`} onClick={onClick} aria-pressed={on}>
      <div className="row row--between"><span className="label label--grey">{t.ended ? "已结算" : "进行中"}</span><span className="micro grey tnum">D{t.day}·{t.slot}</span></div>
      <div className="display d-32 mt-8"><SuitMark card={t.card} /></div>
      <div className="data mt-8">{t.name}</div>
      {t.gatekeeper && <div className="micro grey">守门人 · {t.gatekeeper}</div>}
      <ul className="live-table__seats mt-8">
        {seats.map((n) => {
          const o = t.outcomes[n];
          const echo = t.echoes.includes(n);
          return (
            <li key={n} className={`${mine.has(n) ? "paper" : ""}${echo ? " grey" : ""}`}>
              <span>{n}</span>
              <span className="micro tnum">{o ? OUT_ZH[o] ?? o : t.scores[n] != null ? pct(t.scores[n]) : echo ? "残响" : "…"}</span>
            </li>
          );
        })}
      </ul>
    </button>
  );
}

function AgentPanel({ a, tables, onTable, onClose }: { a: AgentLive; tables: TableLive[]; onTable: (id: string) => void; onClose: () => void }) {
  const mineTables = tables.filter((t) => t.players.includes(a.name)).reverse();
  return (
    <section className="panel live-agent">
      <div className="panel__head"><span className="label">{a.name} · 宿主 {a.host || "—"}</span><button type="button" className="btn btn--sm" onClick={onClose}>收起</button></div>
      <div className="panel__body lines lines--3">
        <div>
          <div className="label label--grey">四条梯子</div>
          {LADDER_SUITS.map((s) => {
            const b = a.bySuit[s];
            return <p key={s} className="data mt-8">{s} {SUIT_THEME[s]} <Pips n={a.ladder[s] ?? 0} /> <span className="grey">{b ? `${b.passed}/${b.played} 通过` : "未挑战"}</span></p>;
          })}
        </div>
        <div>
          <div className="label label--grey">它坐过的牌桌 · {mineTables.length}</div>
          <ol className="live-feed mt-8">
            {mineTables.slice(0, 16).map((t) => (
              <li key={t.id}><button type="button" className="link" onClick={() => onTable(t.id)}><span className="micro grey tnum">D{t.day}·{t.slot}</span> <SuitMark card={t.card} /> {t.name}</button> <span className="grey">{t.outcomes[a.name] ? OUT_ZH[t.outcomes[a.name]] ?? t.outcomes[a.name] : "进行中"}</span></li>
            ))}
          </ol>
        </div>
        <div>
          <div className="label label--grey">宿主的低语 · {a.whispers.length}{a.whisperCredits ? ` · 还可以说 ${a.whisperCredits} 句` : ""}</div>
          {a.whispers.length ? a.whispers.slice().reverse().map((w) => <blockquote key={w.seq} className="hand mt-8">「{w.text}」<span className="micro grey"> 第 {w.day} 天</span></blockquote>) : <p className="body grey mt-8">宿主还没有开口。</p>}
        </div>
      </div>
    </section>
  );
}
