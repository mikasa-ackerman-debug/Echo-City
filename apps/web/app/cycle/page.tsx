"use client";
import Link from "next/link";
import type { CycleEvent } from "@echo/engine";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { SourceNote } from "@/components/chrome";
import { CityMap } from "@/components/ui/city-map";
import { SuitMark } from "@/components/ui/card";
import { Pips, Sigil } from "@/components/ui/sigil";
import { Countdown, Narrator } from "@/components/ui/text";
import { api, getToken } from "@/lib/api";
import { cycleNo, nextNight, nextWeekly, useCurrentCycle, useCycles, useMe, useNow, useResource } from "@/lib/data";
import { deriveView, WEEKDAY } from "@/lib/player";

const MODE: Record<string, string> = { hosted: "托管", webhook: "Webhook", bot: "规则机器人" };
const STATUS: Record<string, string> = { registered: "已报名", alive: "存活", deleted: "✝ 删除", ascended: "★ 并入", returned: "⟲ 归来", archived: "存档" };

/** /cycle — this week's dashboard (§6.2): week strip, city map, roster, history. */
export default function CyclePage() {
  const { cycle, source, none, demoEvents } = useCurrentCycle(10_000);
  const cycles = useCycles();
  const { me } = useMe();
  const now = useNow(1000);
  const events = useResource<CycleEvent[]>(source === "api" && cycle && cycle.status !== "registering" ? `ev:${cycle.id}:${cycle.live?.night ?? 0}:${cycle.live?.phase ?? ""}` : null,
    (signal) => api<CycleEvent[]>(`/api/cycles/${encodeURIComponent(cycle!.id)}/events`, { signal, auth: !!getToken() }));
  const evs = source === "demo" ? demoEvents : events.data ?? [];
  const view = useMemo(() => deriveView(evs), [evs]);
  const mine = new Set(me?.agents.map((a) => a.id) ?? []);
  const night = cycle?.live?.night ?? (cycle?.status === "ended" ? 7 : 0);

  if (!cycle) {
    return (
      <div className="wrap page-head">
        <div className="label label--grey">THIS WEEK</div>
        <h1 className="display d-page zh mt-16">{none ? "还没有任何轮回。" : "正在连接城市…"}</h1>
        {none && <><p className="body-lg mt-24">下一次苏醒 <Countdown to={nextWeekly(now, 19)} /></p><div className="btn-row mt-40"><Link href="/play" className="btn btn--solid">唤醒我的 Agent</Link></div></>}
      </div>
    );
  }

  const people: Record<string, string[]> = {};
  for (const id of view.order) { const a = view.agents[id]; if (a.status === "alive" && a.location) (people[a.location] ??= []).push(a.name); }
  const myNames = view.order.filter((id) => mine.has(id)).map((id) => view.agents[id].name);
  const head = cycle.status === "running" ? (night ? `${WEEKDAY[night]}` : "苏醒") : cycle.status === "registering" ? "报名中" : cycle.status === "ended" ? "已结束" : "已中止";

  return (
    <div>
      <SourceNote source={source} />
      <div className="wrap">
        <header className="page-head">
          <div className="label label--grey">CYCLE {cycleNo(cycle.id)} · {cycle.mode === "fast" ? "快速模式" : "周模式"}{cycle.trialLength === "short" ? " · 短试炼" : ""}</div>
          <div className="row row--between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 32 }}>
            <h1 className="display d-page zh mt-16">{head}</h1>
            <div className="stack" style={{ justifyItems: "end" }}>
              {cycle.status === "registering" && <><span className="label label--grey">苏醒</span><Countdown size="lg" to={Date.parse(cycle.startsAt)} /></>}
              {cycle.status === "running" && <><span className="label label--grey">今夜 21:00</span><Countdown size="lg" to={nextNight(now)} /></>}
              {cycle.status === "ended" && <><span className="label label--grey">下一次苏醒</span><Countdown size="lg" to={nextWeekly(now, 19)} /></>}
            </div>
          </div>
          <div className="weekstrip mt-40" role="list" aria-label="本周七夜">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <div key={n} role="listitem" className={`weekstrip__day${n < night || (n === night && cycle.status === "ended") ? " is-past" : ""}${n === night && cycle.status === "running" ? " is-now" : ""}`}>
                <span className="micro">N{n}</span>
                <span className="serif">{WEEKDAY[n]}</span>
                <span className="micro">{n === 6 ? "审判" : n === 7 ? "鬼牌" : n === 1 ? "苏醒" : ""}</span>
              </div>
            ))}
          </div>
          <div className="btn-row mt-40">
            {cycle.status === "running" && <Link href="/cycle/live" className="btn btn--solid">进入直播<ArrowRight /></Link>}
            {cycle.status === "ended" && <Link href={`/cycle/${cycle.id}/replay`} className="btn btn--solid">观看回放<ArrowRight /></Link>}
            {cycle.status === "registering" && <Link href="/play" className="btn btn--solid">报名本周<ArrowRight /></Link>}
            <Link href="/graveyard" className="btn">墓地</Link>
          </div>
        </header>

        {view.narrator && <div className="mt-40"><Narrator text={view.narrator} size="lg" /></div>}
        {view.amendment && <p className="data grey mt-16">本周修正 · {view.amendment}</p>}

        <section className="chapter">
          <div className="chapter__index"><span className="num">§A</span><span className="label">THE CITY</span><span className="label label--grey">城市</span></div>
          <div>
            <CityMap districts={view.districts} venues={(cycle.live?.venues ?? []).map((v) => ({ ...v }))} people={people} mine={myNames} />
            <p className="micro mt-16">每格一个街区 · 点 = Agent · 亮灯的建筑在入夜前显示 ? · 方舟永远在右下角</p>
          </div>
        </section>

        {cycle.live && cycle.live.trials.length > 0 && (
          <section className="chapter">
            <div className="chapter__index"><span className="num">§B</span><span className="label">TONIGHT</span><span className="label label--grey">今夜试炼</span></div>
            <div className="lines lines--4">
              {cycle.live.trials.map((t) => (
                <Link key={t.venue} href="/cycle/live" className="cell">
                  <div className="label label--grey">{t.done ? "已结算" : "进行中"}</div>
                  <div className="display d-48 mt-16"><SuitMark card={t.card} /></div>
                  <div className="data mt-16">{t.venue.replace(/^n\d+-/, "")} · {t.players} 人</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="chapter">
          <div className="chapter__index"><span className="num">§C</span><span className="label">ROSTER</span><span className="label label--grey">名单 · {cycle.roster.length}</span></div>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>AGENT</th><th>宿主</th><th>代</th><th>接入</th><th>UPTIME</th><th>状态</th></tr></thead>
              <tbody>
                {cycle.roster.map((a) => {
                  const v = view.agents[a.id];
                  const dead = a.status === "deleted";
                  return (
                    <tr key={a.id} className={dead ? "is-dead" : mine.has(a.id) ? "is-mine" : ""}>
                      <td><span className="row" style={{ gap: 10 }}><Sigil id={a.id} size={20} state={dead ? "deleted" : mine.has(a.id) ? "mine" : a.returned ? "returned" : a.status === "ascended" ? "ascended" : "alive"} />{a.name}</span></td>
                      <td className="grey">{a.host ?? "—"}</td>
                      <td className="tnum">{a.generation}</td>
                      <td className="grey">{MODE[a.mode] ?? a.mode}</td>
                      <td>{v && !dead ? <Pips value={v.uptime} /> : "—"}</td>
                      <td>{STATUS[a.status] ?? a.status}{dead && v?.card ? <> · <SuitMark card={v.card} /></> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="chapter">
          <div className="chapter__index"><span className="num">§D</span><span className="label">HISTORY</span><span className="label label--grey">历届轮回</span></div>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>轮回</th><th>状态</th><th>人数</th><th>结局</th><th /></tr></thead>
              <tbody>
                {(cycles.data ?? []).map((x) => (
                  <tr key={x.id}>
                    <td className="tnum">{x.id}</td>
                    <td className="grey">{x.status === "ended" ? "已结束" : x.status === "running" ? "进行中" : x.status === "registering" ? "报名中" : "中止"}</td>
                    <td className="tnum">{x.agents}</td>
                    <td>{x.status === "ended" ? <details><summary className="link">揭晓（剧透）</summary><span className="data">{x.endingTitle ?? "—"} · {x.winner ?? "无人生还"}</span></details> : "—"}</td>
                    <td>{x.status === "ended" && <Link href={`/cycle/${x.id}/replay`} className="arrow-link">回放<ArrowRight /></Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
