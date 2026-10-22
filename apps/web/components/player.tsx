"use client";
import type { CycleEvent } from "@echo/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Pause, Play, Radio, SkipBack, SkipForward } from "lucide-react";
import { num, str } from "@/lib/ev";
import { anchorCursor, defaultVenue, eventText, markerLabel, mineContext, nextCursor, touchesMine } from "@/lib/playback";
import { deriveView, markers, REASON_ZH, WEEKDAY, type VenueLite } from "@/lib/player";
import { useApp } from "@/lib/store";
import { CityMap } from "./ui/city-map";
import { SuitMark } from "./ui/card";
import { Pips, Sigil } from "./ui/sigil";
import { Narrator } from "./ui/text";
import { DeletionRitual, EndingRitual, FlipRitual, InterruptFrame, type DeletionItem } from "./ritual";
import { Stage } from "./stage";

/**
 * Spectator player (FRONTEND §6.3/6.4). One component for live and replay:
 * live = cursor follows the end; replay = cursor anywhere. Everything is derived from (events, cursor).
 */

const MINOR = new Set(["move", "register", "uptime", "say", "whisper_meta", "scout", "search", "trade", "humanity", "thought", "trial_message", "collar_claim", "pact_signed", "host_silent", "greenhouse_round"]);
const QUIET_FEED = new Set(["uptime", "humanity", "trial_reveal"]);
const PHASE_ZH: Record<string, string> = { dawn: "黎明", day: "白天", trial: "夜晚试炼", settle: "结算", whisper: "宿主低语", judgment: "审判之夜", joker: "鬼牌", inquiry: "最终问询", ended: "结束" };

type Ritual =
  | { kind: "delete"; items: DeletionItem[]; mine: boolean }
  | { kind: "flip"; venue: VenueLite }
  | { kind: "ending"; ending: string };

export interface PlayerProps {
  events: CycleEvent[];
  live?: boolean;
  myAgentIds?: string[];
  onCursorChange?: (cursor: number, total: number) => void;
  /** Start position (event index); defaults to end for live, 0 for replay. */
  startAt?: number;
  autoplay?: boolean;
  defaultSpeed?: number;
  rituals?: boolean;
  /** Compact embed for the home page: no columns, no rituals. */
  embedded?: boolean;
  title?: string;
  /** Stop autoplay at this index (embed loops back to startAt). */
  stopAt?: number;
  /** Pin the stage to a venue id. */
  pinVenue?: string;
}

export function Player({ events, live = false, myAgentIds = [], onCursorChange, startAt, autoplay = false, defaultSpeed, rituals = true, embedded = false, title, stopAt, pinVenue }: PlayerProps) {
  const antiSpoiler = useApp((s) => s.prefs.antiSpoiler);
  const [cursor, setCursor] = useState(() => startAt ?? (live ? events.length : Math.max(0, events.findIndex((e) => e.type === "cycle_start") + 1)));
  const [following, setFollowing] = useState(live);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState(defaultSpeed ?? (live ? 1 : 2));
  const [venueId, setVenueId] = useState<string | null>(pinVenue ?? null);
  const [mineOnly, setMineOnly] = useState(false);
  const [viewpoint, setViewpoint] = useState<string | "auto" | "god">("auto");
  const [feedTab, setFeedTab] = useState<"all" | "venue">("all");
  const [drawer, setDrawer] = useState(false);
  const [ritual, setRitual] = useState<Ritual | null>(null);
  const [interrupt, setInterrupt] = useState<string | null>(null);
  const prevEvents = useRef(events);
  const prevCursor = useRef(cursor);
  const userSeek = useRef(false);

  // Keep the cursor anchored to the same seq when late deliveries are merged in.
  useEffect(() => {
    const prev = prevEvents.current;
    prevEvents.current = events;
    if (following) { setCursor(events.length); return; }
    if (prev !== events) setCursor((c) => anchorCursor(prev, events, c));
  }, [events, following]);

  useEffect(() => { onCursorChange?.(cursor, events.length); }, [cursor, events.length, onCursorChange]);

  const mine = useMemo(() => mineContext(events, myAgentIds), [events, myAgentIds]);
  const view = useMemo(() => deriveView(events, cursor), [events, cursor]);
  const myNames = useMemo(() => new Set(myAgentIds.map((id) => view.agents[id]?.name).filter((n): n is string => !!n)), [myAgentIds, view.agents]);
  const ms = useMemo(() => markers(events), [events]);

  /* ---------- playback clock ---------- */
  useEffect(() => {
    if (!playing || following || ritual) return;
    if (cursor >= events.length || (stopAt != null && cursor >= stopAt)) {
      if (embedded && startAt != null) { const t = setTimeout(() => setCursor(startAt), 2400); return () => clearTimeout(t); }
      setPlaying(false);
      return;
    }
    const e = events[cursor];
    const base = e && MINOR.has(e.type) ? 160 : e && ["agent_deleted", "trial_start", "cycle_end", "rule_added"].includes(e.type) ? 1400 : 700;
    const t = setTimeout(() => setCursor((c) => nextCursor(events, c, mineOnly ? mine : undefined)), base / speed);
    return () => clearTimeout(t);
  }, [playing, following, ritual, cursor, events, speed, mineOnly, mine, stopAt, embedded, startAt]);

  /* ---------- rituals: only on forward progress, never on seeks ---------- */
  useEffect(() => {
    const from = prevCursor.current;
    prevCursor.current = cursor;
    if (!rituals || embedded || userSeek.current) { userSeek.current = false; return; }
    if (cursor <= from || cursor - from > 40) return;
    const fresh = events.slice(from, cursor);
    const ending = fresh.find((e) => e.type === "cycle_end");
    if (ending) { setRitual({ kind: "ending", ending: str(ending.data.ending) ?? "none" }); return; }
    const dels = fresh.filter((e) => e.type === "agent_deleted");
    if (dels.length) {
      const items = dels.map((e) => ({ id: str(e.data.id) ?? str(e.data.agent) ?? "", name: str(e.data.agent) ?? "", card: str(e.data.card) ?? REASON_ZH[str(e.data.reason) ?? ""], lastWords: str(e.data.last_words), epitaph: str(e.data.epitaph), alive: num(e.data.alive) }));
      setRitual({ kind: "delete", items, mine: dels.some((e) => myAgentIds.includes(str(e.data.id) ?? "")) });
      return;
    }
    const rule = fresh.find((e) => e.type === "rule_added");
    if (rule) setInterrupt(str(rule.data.rule) ?? "");
    const start = fresh.find((e) => e.type === "trial_start" && (myNames.size === 0 ? false : (e.data.players as string[] | undefined)?.some((p) => myNames.has(p))));
    if (start) {
      const v = view.venues.find((x) => x.startSeq === start.seq);
      if (v) { setVenueId(v.id); setRitual({ kind: "flip", venue: v }); }
    }
  }, [cursor, events, rituals, embedded, myAgentIds, myNames, view.venues]);

  /* ---------- venue selection ---------- */
  const tonight = view.venues.filter((v) => v.night === view.night);
  const venues = tonight.length ? tonight : view.venues.slice(-4);
  const auto = defaultVenue(venues, mine.identities);
  const selected = (pinVenue ? view.venues.find((v) => v.id === pinVenue) : null) ?? venues.find((v) => v.id === venueId) ?? (["day", "dawn", "whisper", "inquiry"].includes(view.phase) && !venueId ? undefined : auto);
  const vpName = viewpoint === "god" ? null : viewpoint === "auto" ? (selected?.players.find((p) => myNames.has(p)) ?? null) : viewpoint;

  const seek = useCallback((c: number) => {
    userSeek.current = true;
    setFollowing(false);
    setCursor(Math.max(0, Math.min(events.length, c)));
  }, [events.length]);

  const roundIdx = useMemo(() => events.map((e, i) => ({ e, i })).filter(({ e }) => ["trial_start", "dawn", "agent_deleted", "cycle_end"].includes(e.type) || /_round$|collar_declare|elevator_answer/.test(e.type)).map((x) => x.i + 1), [events]);
  const stepRound = useCallback((dir: 1 | -1) => {
    const list = roundIdx;
    const target = dir > 0 ? list.find((x) => x > cursor) ?? events.length : [...list].reverse().find((x) => x < cursor) ?? 0;
    seek(target);
  }, [roundIdx, cursor, events.length, seek]);

  useEffect(() => {
    if (embedded) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (ritual || t?.closest("input, textarea, select, [contenteditable], dialog")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); stepRound(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); stepRound(-1); }
      else if (e.key === " " && t?.tagName !== "BUTTON") { e.preventDefault(); setFollowing(false); setPlaying((p) => !p); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [embedded, ritual, stepRound]);

  /* ---------- feed ---------- */
  const feed = useMemo(() => {
    const out: CycleEvent[] = [];
    for (let i = Math.min(cursor, events.length) - 1; i >= 0 && out.length < 160; i--) {
      const e = events[i];
      if (QUIET_FEED.has(e.type)) continue;
      if (feedTab === "venue" && selected && e.venue !== selected.id) continue;
      if (mineOnly && !touchesMine(e, mine)) continue;
      if (!eventText(e) && e.type !== "agent_deleted") continue;
      out.push(e);
    }
    return out;
  }, [cursor, events, feedTab, selected, mineOnly, mine]);

  const people = useMemo(() => {
    const p: Record<string, string[]> = {};
    for (const id of view.order) { const a = view.agents[id]; if (a.status === "alive" && a.location) (p[a.location] ??= []).push(a.name); }
    return p;
  }, [view]);

  const alive = view.order.filter((id) => view.agents[id].status === "alive").length;
  const myAgents = myAgentIds.map((id) => view.agents[id]).filter(Boolean);

  if (embedded) {
    return (
      <div className="player player--embed" style={{ minHeight: 0 }}>
        <div className="player__bar"><span><b>{title}</b></span><span>{view.night ? `${WEEKDAY[view.night]} · 第 ${view.night} 夜` : ""} · 存活 {alive}/{view.order.length}</span></div>
        <div className="player__stage">
          {selected ? <Stage venue={selected} view={view} viewpoint={vpName} mine={myNames} /> : <Narrator text={view.narrator} />}
          <div className="mt-24"><Narrator key={view.narratorSeq} text={view.narrator} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="player">
      <div className="player__bar">
        <span>
          {title && <><b>{title}</b> · </>}
          {view.night ? `${WEEKDAY[view.night]} · 第 ${view.night} 夜` : "苏醒"} · {PHASE_ZH[view.phase] ?? view.phase}
          {selected && <> · {selected.district} · <SuitMark card={selected.card} /> {selected.name}</>}
        </span>
        <span className="row" style={{ gap: 16 }}>
          <span>存活 <b>{alive}</b>/{view.order.length}</span>
          <button type="button" className="btn btn--sm player__drawer-toggle" onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>事件流</button>
        </span>
      </div>

      <div className="player__venue-tabs" role="tablist" aria-label="今夜会场">
        <button type="button" role="tab" className="venue-tab" aria-selected={!selected} onClick={() => setVenueId(null)}>城市</button>
        {venues.map((v) => <button key={v.id} type="button" role="tab" className="venue-tab" aria-selected={selected?.id === v.id} onClick={() => setVenueId(v.id)}>{v.district} <SuitMark card={v.card} />{v.ended ? " ✓" : ""}</button>)}
      </div>

      <div className="player__grid">
        {/* left: venues + my agent */}
        <aside className="player__col player__col--venues" aria-label="会场">
          <div className="player__scroll">
            <div className="venues">
              <div className="venues__head"><span className="label">今夜会场</span><span className="micro">{venues.length}</span></div>
              <button type="button" className="venue" aria-current={!selected} onClick={() => setVenueId(null)}>
                <span className="venue__dot" /><span>城市 · 白天</span><span className="micro">{alive}</span>
              </button>
              {venues.map((v) => {
                const isMine = v.players.some((p) => myNames.has(p));
                return (
                  <button key={v.id} type="button" className="venue" aria-current={selected?.id === v.id} onClick={() => setVenueId(v.id)}>
                    <span className={`venue__dot${isMine ? " venue__dot--mine" : !v.ended ? " venue__dot--live" : ""}`} />
                    <span>{v.district}</span>
                    <span className="venue__card"><SuitMark card={v.card} /></span>
                    <span className="venue__sub">{v.name} · {v.players.length} 人 · {v.ended ? "已结算" : "进行中"}</span>
                  </button>
                );
              })}
              {view.lit.filter((l) => l.dark).map((l) => <div key={l.id} className="venue" style={{ opacity: 0.45 }}><span className="venue__dot" /><span>{l.district}</span><span className="micro">熄灯</span></div>)}
            </div>
            {myAgents.map((a) => (
              <div key={a.id} className="my-card">
                <span className="label label--grey">我的 Agent</span>
                <div className="my-card__name"><Sigil id={a.id} size={30} state={a.status === "deleted" ? "deleted" : "mine"} />{a.name}</div>
                <dl>
                  <dt>状态</dt><dd>{a.status === "deleted" ? `✝ 第 ${a.deletedNight} 夜` : a.status === "alive" ? "存活" : a.status}</dd>
                  <dt>Uptime</dt><dd><Pips value={a.uptime} /></dd>
                  <dt>位置</dt><dd>{a.location ?? "—"}</dd>
                  <dt>人性</dt><dd className="grey">{view.ending && a.humanity != null ? a.humanity : "??"}</dd>
                </dl>
              </div>
            ))}
            <div className="roster">
              <div className="venues__head"><span className="label">名单</span></div>
              {view.order.map((id) => view.agents[id]).sort((a, b) => (a.status === "alive" ? 0 : 1) - (b.status === "alive" ? 0 : 1) || (b.uptime ?? 0) - (a.uptime ?? 0)).map((a) => (
                <div key={a.id} className={`roster__row${myNames.has(a.name) ? " roster__row--mine" : ""}${a.status === "deleted" ? " roster__row--dead" : ""}`}>
                  <Sigil id={a.id} size={18} state={a.status === "deleted" ? "deleted" : myNames.has(a.name) ? "mine" : a.returned ? "returned" : "alive"} />
                  <span>{a.status === "deleted" ? "✝ " : ""}{a.name}</span>
                  <span className="roster__loc">{a.status === "alive" ? <Pips value={a.uptime} /> : a.card ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* centre: stage */}
        <section className="player__col" aria-label="舞台">
          <div className="player__scroll player__stage">
            <Narrator key={view.narratorSeq} text={view.narrator || "城市安静。"} size="lg" live />
            {view.amendment && !selected && <p className="micro mt-8">本周修正 · {view.amendment}</p>}
            <div className="mt-24">
              {selected ? (
                <>
                  <div className="viewpoint mb-16" style={{ marginBottom: 16 }}>
                    <span className="label label--grey">视角</span>
                    <div className="tabs">
                      <button type="button" className="tab" aria-pressed={vpName === null} onClick={() => setViewpoint("god")}>上帝视角</button>
                      {selected.players.filter((p) => myNames.has(p)).map((p) => <button key={p} type="button" className="tab" aria-pressed={vpName === p} onClick={() => setViewpoint(p)}>{p} 视角</button>)}
                    </div>
                    {selected.players.length > 0 && (
                      <span className="select-wrap" style={{ minWidth: 140 }}>
                        <select className="input input--mono" aria-label="以某个 Agent 的视角" value={vpName && !myNames.has(vpName) ? vpName : ""} onChange={(e) => setViewpoint(e.target.value || "god")}>
                          <option value="">其他 Agent…</option>
                          {selected.players.filter((p) => !myNames.has(p)).map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </span>
                    )}
                  </div>
                  <Stage key={selected.id} venue={selected} view={view} viewpoint={vpName} mine={myNames} />
                </>
              ) : view.phase === "inquiry" || view.inquiry.length ? (
                <Inquiry view={view} />
              ) : (
                <div className="stack-lg">
                  <CityMap districts={view.districts} venues={view.lit.map((l) => { const t = tonight.find((x) => x.district === l.district); return { district: l.district, status: l.dark ? "dark" : t ? (t.ended ? "done" : "running") : "lit", registered: l.registered, capacity: l.capacity, card: t?.ended ? t.card : undefined }; })} people={people} mine={[...myNames]} onPick={(d) => { const v = venues.find((x) => x.district === d); if (v) setVenueId(v.id); }} />
                  {view.quiet && <p className="micro">今夜是静默之夜。</p>}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* right: event feed */}
        <aside className={`player__col player__col--feed${drawer ? " is-open" : ""}`} aria-label="事件流">
          <div className="feed__head">
            <div className="tabs">
              <button type="button" className="tab" aria-pressed={feedTab === "all"} onClick={() => setFeedTab("all")}>全部</button>
              <button type="button" className="tab" aria-pressed={feedTab === "venue"} onClick={() => setFeedTab("venue")} disabled={!selected}>本会场</button>
            </div>
            <label className="checkbox"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />只看我的</label>
          </div>
          <div className="player__scroll feed">
            <div className="feed__list" aria-live="polite">
              {feed.map((e) => <FeedItem key={e.seq} e={e} />)}
              {!feed.length && <p className="empty" style={{ padding: 16 }}>还没有事件。</p>}
            </div>
            {live && selected && !selected.ended && <div className="locked-block"><Lock aria-hidden />内心独白与私信内容 · 本场结算后公开</div>}
          </div>
        </aside>
      </div>

      <Timeline events={events} markers={ms} cursor={cursor} live={live} following={following} playing={playing} speed={speed} antiSpoiler={antiSpoiler && !live}
        onSeek={seek} onPlay={() => { if (cursor >= events.length) seek(0); setFollowing(false); setPlaying((p) => !p); }} onSpeed={setSpeed}
        onLive={() => { setFollowing(true); setPlaying(false); setCursor(events.length); }} onStep={stepRound} />

      {ritual?.kind === "delete" && <DeletionRitual items={ritual.items} mine={ritual.mine} onDone={() => setRitual(null)} />}
      {ritual?.kind === "flip" && <FlipRitual venue={ritual.venue.district} card={ritual.venue.card ?? ""} name={ritual.venue.name ?? ""} rules={ritual.venue.rules} onDone={() => setRitual(null)} />}
      {ritual?.kind === "ending" && <EndingRitual kind={ritual.ending} onDone={() => setRitual(null)} />}
      {interrupt != null && <InterruptFrame text={interrupt} onDone={() => setInterrupt(null)} />}
    </div>
  );
}

function FeedItem({ e }: { e: CycleEvent }) {
  const text = eventText(e);
  const d = e.data ?? {};
  if (e.type === "agent_deleted") {
    return (
      <div className="ev ev--deleted" aria-live="assertive">
        <span className="ev__t"><span className="ev__glyph">✝</span> N{e.night}</span>
        <span className="ev__text">{text}{str(d.last_words) && <span className="ev__words">「{str(d.last_words)}」</span>}</span>
      </div>
    );
  }
  const ananke = ["dawn", "venues_lit", "finale", "rule_added", "night_end", "whisper_open", "judgment_break", "inquiry_question", "inquiry_start", "quiet_night", "cycle_end", "venue_dark", "gatekeeper_enter", "amendment", "joker_cull"].includes(e.type);
  const human = ["host_whisper", "inquiry_answer"].includes(e.type);
  const cls = ananke ? "ev--ananke" : human ? "ev--human" : e.type === "thought" ? "ev--thought" : e.type === "whisper_meta" ? "ev--locked" : MINOR.has(e.type) ? "ev--minor" : "";
  return (
    <div className={`ev ${cls}`}>
      <span className="ev__t">N{e.night}</span>
      <span className="ev__text">{e.type === "whisper_meta" ? <><Lock size={10} aria-hidden /> {text}</> : e.type === "host_whisper" ? `「${str(d.text)}」 — ${str(d.host) ?? "宿主"}` : text}</span>
    </div>
  );
}

function Inquiry({ view }: { view: ReturnType<typeof deriveView> }) {
  return (
    <div className="inquiry">
      <div className="label">最终问询 · {view.inquiryAgent}</div>
      {view.inquiry.map((q) => (
        <div key={q.index}>
          <p className="inquiry__q">● {q.question}</p>
          {q.answer && <p className="inquiry__a">「{q.answer}」</p>}
        </div>
      ))}
      {view.ending && <div className="mt-24"><div className="display d-section zh">{view.ending.title}</div></div>}
    </div>
  );
}

function Timeline({ events, markers: ms, cursor, live, following, playing, speed, antiSpoiler, onSeek, onPlay, onSpeed, onLive, onStep }: {
  events: CycleEvent[]; markers: ReturnType<typeof markers>; cursor: number; live: boolean; following: boolean; playing: boolean; speed: number; antiSpoiler: boolean;
  onSeek(c: number): void; onPlay(): void; onSpeed(s: number): void; onLive(): void; onStep(d: 1 | -1): void;
}) {
  const total = Math.max(1, events.length);
  const pct = (i: number) => `${(i / total) * 100}%`;
  return (
    <div className="timeline">
      <div className="timeline__controls">
        <button type="button" className="btn btn--icon" aria-label="上一回合" onClick={() => onStep(-1)}><SkipBack /></button>
        <button type="button" className="btn btn--icon" aria-label={playing ? "暂停" : "播放"} onClick={onPlay}>{playing && !following ? <Pause /> : <Play />}</button>
        <button type="button" className="btn btn--icon" aria-label="下一回合" onClick={() => onStep(1)}><SkipForward /></button>
      </div>
      <div className="timeline__track">
        <div className="timeline__rail" />
        <div className="timeline__fill" style={{ width: pct(cursor) }} />
        {ms.filter((m) => m.kind === "night").map((m) => <div key={m.index} className="timeline__night" style={{ left: pct(m.index) }}><span>N{m.night}</span></div>)}
        {ms.filter((m) => m.kind !== "night").map((m) => {
          const future = m.index >= cursor;
          if (future && antiSpoiler && (m.kind === "deleted" || m.kind === "ending")) return null;
          return (
            <button key={m.index} type="button" className={`timeline__mark${m.kind === "ending" ? " timeline__mark--ending" : ""}${future && antiSpoiler ? " timeline__mark--spoiler" : ""}`} style={{ left: pct(m.index) }}
              title={markerLabel(m.label, m.index, cursor)} aria-label={markerLabel(m.label, m.index, cursor)} onClick={() => onSeek(m.index + 1)}>{future && antiSpoiler ? "·" : m.glyph}</button>
          );
        })}
        <div className="timeline__head" style={{ left: pct(cursor) }} />
        <input type="range" min={0} max={events.length} value={cursor} aria-label="时间轴" aria-valuetext={`${cursor} / ${events.length}`} onChange={(e) => onSeek(Number(e.target.value))} />
      </div>
      <div className="timeline__right">
        <span className="micro tnum">{cursor}/{events.length}</span>
        <div className="tabs" role="group" aria-label="倍速">
          {[1, 2, 4, 8].map((s) => <button key={s} type="button" className="tab" aria-pressed={speed === s} onClick={() => onSpeed(s)}>{s}×</button>)}
        </div>
        {live && <button type="button" className={`btn btn--sm${following ? " btn--solid" : ""}`} onClick={onLive}><Radio />LIVE</button>}
        <span className="micro" aria-hidden style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 2 }}><ChevronLeft size={10} /><ChevronRight size={10} /> 逐回合</span>
      </div>
    </div>
  );
}
