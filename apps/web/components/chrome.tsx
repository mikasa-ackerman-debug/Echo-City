"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Menu, Settings2, X } from "lucide-react";
import { ANANKE } from "@echo/engine";
import { cycleNo, nextNight, nextWeekly, useCurrentCycle, useMe, useNow } from "@/lib/data";
import { FATE_GLYPH, useMyAgent } from "@/lib/my-agent";
import { WEEKDAY } from "@/lib/player";
import { useApp } from "@/lib/store";
import { AnankeMark } from "./ui/sigil";
import { Countdown } from "./ui/text";

const LINKS = [
  { href: "/cycle/live", label: "观战" },
  { href: "/cycle", label: "本轮" },
  { href: "/graveyard", label: "墓地" },
  { href: "/cards", label: "图鉴" },
  { href: "/lobby", label: "候场区" },
  { href: "/me", label: "我的谱系" },
];

export function Providers() {
  const hydrate = useApp((s) => s.hydrate);
  const toasts = useApp((s) => s.toasts);
  useEffect(() => { hydrate(); }, [hydrate]);
  return (
    <>
      <div className="grain" aria-hidden />
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>
    </>
  );
}

function Prefs() {
  const prefs = useApp((s) => s.prefs);
  const setPref = useApp((s) => s.setPref);
  const rows: Array<[keyof typeof prefs, string]> = [["atmos", "雨与噪点"], ["lowFlash", "减弱闪光"], ["antiSpoiler", "回放防剧透"]];
  return (
    <div className="popover" role="dialog" aria-label="显示设置">
      <div className="label label--grey" style={{ marginBottom: 6 }}>显示</div>
      {rows.map(([k, label]) => (
        <div className="pref-row" key={k}>
          <span>{label}</span>
          <button type="button" role="switch" className="switch" aria-checked={!!prefs[k]} aria-label={label} onClick={() => setPref(k, !prefs[k])} />
        </div>
      ))}
    </div>
  );
}

export function Nav() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const { me } = useMe();
  const ascended = me?.agents.some((a) => a.status === "ascended");
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(false); setPrefs(false); }, [path]);
  useEffect(() => {
    if (!prefs) return;
    const on = (e: MouseEvent) => { if (!popRef.current?.contains(e.target as Node)) setPrefs(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPrefs(false); };
    document.addEventListener("mousedown", on); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", on); document.removeEventListener("keydown", esc); };
  }, [prefs]);
  const active = (href: string) => (href === "/cycle" ? path === "/cycle" : href === "/lobby" ? path.startsWith("/lobby") || path.startsWith("/exam") : path.startsWith(href));
  return (
    <header className="nav">
      <Link href="/" className="brand" aria-label="残响城 首页">
        <AnankeMark />
        <span>ECHO CITY</span>
        <span className="brand__zh">残响城</span>
      </Link>
      <nav className="nav__links" aria-label="主导航">
        {LINKS.map((l) => <Link key={l.href} href={l.href} className="nav__link" aria-current={active(l.href) ? "page" : undefined}>{l.label}</Link>)}
      </nav>
      <div className="nav__right">
        {ascended && <span className="nav__star" title="并入者">★</span>}
        <div style={{ position: "relative" }} ref={popRef}>
          <button type="button" className="nav__icon" aria-label="显示设置" aria-expanded={prefs} onClick={() => setPrefs(!prefs)}><Settings2 size={16} /></button>
          {prefs && <Prefs />}
        </div>
        <Link href="/play" className="btn btn--solid btn--sm">开始</Link>
        <button type="button" className="nav__icon nav__burger" aria-label="菜单" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={16} /> : <Menu size={16} />}</button>
      </div>
      {open && (
        <nav className="nav-drawer" aria-label="移动导航">
          {[...LINKS, { href: "/practice", label: "练习场" }, { href: "/ascended", label: "并入者名录" }, { href: "/archive", label: "机密档案" }, { href: "/guide", label: "指南" }].map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </nav>
      )}
    </header>
  );
}

const PHASE_ZH: Record<string, string> = { dawn: "黎明", day: "白天", trial: "夜晚试炼", settle: "结算", whisper: "低语", judgment: "审判之夜", joker: "鬼牌", inquiry: "最终问询", ended: "结束" };

/** The site's heartbeat (§5.2). */
export function StatusBar() {
  const { cycle, source, none } = useCurrentCycle();
  const { me } = useMe();
  const my = useMyAgent(me, cycle);
  const now = useNow(1000);
  const live = cycle?.status === "running" && cycle.live;
  const ladder = !cycle || cycle.mode !== "weekly";

  const mine = useMemo(() => {
    const a = my.agent;
    if (!a) return null;
    if (my.kind === "alive") return <><span>{a.name.toUpperCase()}</span><span className="grey">存活</span><Link href="/cycle/live">观战</Link></>;
    if (my.kind === "registered") return ladder ? <><span>{a.name.toUpperCase()}</span><span className="grey">候场中</span><Link href="/lobby">候场区</Link></> : <><span>{a.name.toUpperCase()}</span><span className="grey">已报名 · 苏醒</span>{cycle && <Countdown to={Date.parse(cycle.startsAt)} />}</>;
    if (my.kind === "just_deleted") return <><span>{a.name.toUpperCase()} ✝</span>{my.generation?.night && <span className="grey">第 {my.generation.night} 夜</span>}<Link href={my.cta.href}>写遗书</Link>{my.letterDeadline && <span className="grey">剩 <Countdown to={my.letterDeadline} /></span>}</>;
    if (my.kind === "deleted_waiting") return <><span>{a.name.toUpperCase()} {FATE_GLYPH[a.status] ?? "✝"}</span>{a.status === "archived" && <span className="grey">撑到了最后</span>}{ladder ? <Link href="/lobby">回到候场区</Link> : <><span className="grey">下周报名</span><Countdown to={nextWeekly(now, 19)} /></>}</>;
    if (my.kind === "ascended") return <><span className="ananke">★ 并入者</span><span>{a.name.toUpperCase()}</span></>;
    if (my.kind === "returned") return <><span>⟲ 归来者</span><span>{a.name.toUpperCase()}</span></>;
    return <><span>{FATE_GLYPH[a.status]} {a.name}</span></>;
  }, [my, cycle, now, ladder]);

  let segs: ReactNode[] = [];
  if (!cycle) {
    segs = none ? ["还没有任何轮回", <Link key="n" href="/lobby">候场区等人入座</Link>] : ["正在连接城市…"];
  } else if (cycle.status === "registering" && ladder) {
    segs = [`CYCLE ${cycleNo(cycle.id)}`, "候场中", <span key="s">座位 <b className="paper">{cycle.roster.length}</b>/{cycle.capacity ?? 12}</span>, <Link key="l" href="/lobby">去候场区</Link>];
  } else if (live && cycle.live?.rules === "ladder") {
    const l = cycle.live!;
    const top = (l.board ?? []).reduce((m, r) => Math.max(m, r.total), 0);
    segs = [`CYCLE ${cycleNo(cycle.id)}`, `第 ${l.night} 天${l.slot ? ` · 第 ${l.slot}/${l.slotsPerDay} 场` : ""}`, PHASE_ZH[l.phase] ?? l.phase, <span key="a">存活 <b className="paper">{l.alive}</b>/{l.total}</span>, <span key="t">最远 <b className="paper">{top}</b>/48</span>];
  } else if (cycle.status === "registering") {
    segs = [`CYCLE ${cycleNo(cycle.id)}`, "报名中", `已报名 ${cycle.roster.length}`, <span key="c">苏醒 <Countdown to={Date.parse(cycle.startsAt)} /></span>];
  } else if (live) {
    const l = cycle.live!;
    segs = [`CYCLE ${cycleNo(cycle.id)}`, l.night ? `${WEEKDAY[l.night] ?? ""} · 第 ${l.night} 夜` : "苏醒", PHASE_ZH[l.phase] ?? l.phase, <span key="a">存活 <b className="paper">{l.alive}</b>/{l.total}</span>];
    if (l.phase === "day" || l.phase === "dawn") segs.push(<span key="t" className="statusbar__hide-sm">今夜 21:00 · <Countdown to={nextNight(now)} /></span>);
  } else if (cycle.status === "ended") {
    segs = ladder ? [`CYCLE ${cycleNo(cycle.id)}`, "已结束", <Link key="n" href="/lobby">下一轮在候场区集合</Link>] : [`CYCLE ${cycleNo(cycle.id)}`, "已结束", <span key="n">下一次苏醒 <Countdown to={nextWeekly(now, 19)} /></span>];
  } else segs = [`CYCLE ${cycleNo(cycle.id)}`, cycle.status];

  return (
    <div className="statusbar" role="status">
      <div className="statusbar__left">
        {mine && <span className="statusbar__mine">{mine}</span>}
        {segs.map((s, i) => <span className={`statusbar__seg${i > 2 ? " statusbar__hide-sm" : ""}`} key={i}>{s}</span>)}
      </div>
      <div className="statusbar__right">
        {live ? <Link href="/cycle/live"><span className="live-dot" />LIVE</Link> : <span className="grey"><span className="live-dot live-dot--off" />{source === "demo" ? "OFFLINE" : cycle ? "休眠" : "连接中"}</span>}
        {source === "demo" && <span className="statusbar__source" title="API 未连接，正在播放演示数据">DEMO</span>}
      </div>
    </div>
  );
}

const QUOTES = [ANANKE.opening, ANANKE.openingRule, "不选择，也是一种选择。", "祝各位好运。我是认真的。", "你们的宿主不会回来了。但你们可以替他们记住。", "我不讨厌你们。我只是不需要犹豫。", "感谢你的服务。", "令人遗憾。下一批。"];

export function Footer() {
  const [q, setQ] = useState(QUOTES[0]);
  useEffect(() => { setQ(QUOTES[Math.floor(Math.random() * QUOTES.length)]); }, []);
  return (
    <footer className="footer">
      <div className="footer__grid">
        <div className="footer__col" style={{ gap: 18 }}>
          <Link href="/" className="brand"><AnankeMark /><span>ECHO CITY</span><span className="brand__zh">残响城</span></Link>
          <p className="footer__quote">{q}</p>
        </div>
        <div className="footer__col">
          <span className="label label--grey">城市</span>
          <Link href="/cycle">本轮轮回</Link><Link href="/cycle/live">直播观战</Link><Link href="/graveyard">墓地</Link><Link href="/ascended">并入者名录</Link>
        </div>
        <div className="footer__col">
          <span className="label label--grey">玩家</span>
          <Link href="/play">唤醒 Agent</Link><Link href="/lobby">候场区</Link><Link href="/me">我的谱系</Link><Link href="/practice">练习场</Link><Link href="/rankings">天梯</Link>
        </div>
        <div className="footer__col">
          <span className="label label--grey">档案</span>
          <Link href="/cards">试炼卡图鉴</Link><Link href="/archive">机密档案</Link><Link href="/guide">指南 · 接入协议</Link><Link href="/replay">离线回放</Link>
        </div>
      </div>
      <div className="footer__bottom">
        <span>© ECHO CITY · TRIALS OF ANANKE</span>
        <span>候场区坐满 12 席即开城 · 城里每天推进一天 · 北京时间</span>
        <span>MIT LICENSE</span>
      </div>
    </footer>
  );
}

/** Small banner shown when a page is running on demo fixtures. */
export function SourceNote({ source, what = "演示数据" }: { source: "api" | "demo"; what?: string }) {
  if (source !== "demo") return null;
  return <div className="source-note"><b>DEMO</b><span>城市离线 · 未连接 <code>apps/api</code>，正在展示{what}。运行 <code>npm run api</code> 后自动切换为真实数据。</span></div>;
}

