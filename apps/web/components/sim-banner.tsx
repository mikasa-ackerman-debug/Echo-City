"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Lock, Play, RotateCcw, X } from "lucide-react";
import { SIM_ID, SIM_SPEEDS, checkSimPassword, simOpen, simStart, simStop, useSim } from "@/lib/sim-local";

const FLAG = "echo.sim";
const UNLOCK = "echo.sim.unlocked";

/**
 * 全局模拟 — banner pinned to the bottom of every page, visible to everyone, opened with a password.
 * The whole city runs in this browser on the real engine (works on a frontend-only Vercel deploy):
 * ① wake your own agent through the real /play wizard → ② house bots fill the 11 other seats and the city opens
 * → ③ the cycle plays out on a compressed clock; 本轮 / 候场区 / 观战 / 状态栏 / 我的 all show it.
 * 还原 throws the simulated city away and every page reads the public city again.
 */
export function SimBanner() {
  const router = useRouter();
  const path = usePathname();
  const { cfg, cycle, done } = useSim();
  const [open, setOpen] = useState(false);
  const [speed, setSpeed] = useState(SIM_SPEEDS[1].v);
  const [pw, setPw] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [err, setErr] = useState("");
  const [mini, setMini] = useState(false);
  useEffect(() => {
    setMini(localStorage.getItem(FLAG) === "mini" && !cfg);
    setUnlocked(sessionStorage.getItem(UNLOCK) === "1");
  }, [path, cfg]);

  const on = !!cfg;
  const live = cycle?.live;

  const begin = async () => {
    setErr("");
    if (!unlocked) {
      if (!(await checkSimPassword(pw))) { setErr("密码不对。"); return; }
      sessionStorage.setItem(UNLOCK, "1");
      setUnlocked(true);
    }
    simOpen(speed);
    setPw("");
    setOpen(true);
    router.push("/play");
  };
  const fillAndStart = () => {
    setErr("");
    try { simStart(); router.push("/cycle"); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const restore = () => { simStop(); setOpen(false); router.push("/cycle"); };
  const hide = () => { localStorage.setItem(FLAG, "mini"); setMini(true); setOpen(false); };

  if (mini) return <button type="button" className="sim-banner__mini" onClick={() => { localStorage.removeItem(FLAG); setMini(false); }}>全局模拟</button>;
  const step = !cfg ? 0 : !cfg.agent ? 1 : !cfg.startedAt ? 2 : 3;

  return (
    <div className={`sim-banner${on ? " is-on" : ""}${open ? " is-open" : ""}`} role="region" aria-label="全局模拟">
      <div className="sim-banner__bar">
        <button type="button" className="sim-banner__title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={`live-dot${on ? "" : " live-dot--off"}`} />全局模拟{on ? " · 进行中" : ""}
        </button>
        {on ? (
          <span className="data sim-banner__status">
            {step === 1 && "候场中 · 座位 0/12 · 还没有我的 Agent"}
            {step === 2 && <>候场中 · 座位 1/12 · 我的 {cfg!.agent!.name}</>}
            {step === 3 && !done && live && <>第 {live.night} 天{live.slot ? ` · 第 ${live.slot}/${live.slotsPerDay} 场` : ""} · 存活 <span className="tnum">{live.alive}/{live.total}</span></>}
            {step === 3 && !done && !live && "城门正在打开…"}
            {done && cycle?.summary && <>已结束 · {cycle.summary.winner ? `${cycle.summary.winner.name} 推开了最后的门` : "无人生还"}</>}
          </span>
        ) : <span className="micro grey">创建一个 Agent，走完整个流程，Bot 补满，跑完整一局。只在你的浏览器里运行，公开环境不受影响。</span>}
        <span className="sim-banner__actions">
          {step === 1 && <Link className="btn btn--sm btn--solid" href="/play">① 创建我的 Agent</Link>}
          {step === 2 && <button type="button" className="btn btn--sm btn--solid" onClick={fillAndStart}><Play />② 补齐 Bot 并开城</button>}
          {step === 3 && <Link className="btn btn--sm" href="/cycle">本轮</Link>}
          {step === 3 && <Link className="btn btn--sm" href="/cycle/live">观战</Link>}
          {done && <Link className="btn btn--sm" href={`/cycle/${SIM_ID}/replay`}>回放</Link>}
          {on ? <button type="button" className="btn btn--sm" onClick={restore}><RotateCcw />还原</button>
            : <button type="button" className="btn btn--sm" onClick={() => setOpen((o) => !o)}>{open ? "收起" : "开始模拟"}</button>}
          {!on && <button type="button" className="btn btn--sm btn--ghost" aria-label="收起" onClick={hide}><X /></button>}
        </span>
      </div>
      {open && (
        <div className="sim-banner__panel">
          {!on ? (
            <form className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "center" }} onSubmit={(e) => { e.preventDefault(); void begin(); }}>
              {!unlocked && <span className="row" style={{ gap: 8, alignItems: "center" }}><Lock size={14} /><input className="input" style={{ width: 200 }} type="password" autoComplete="off" placeholder="模拟密码" value={pw} onChange={(e) => setPw(e.target.value)} /></span>}
              <span className="btn-row">{SIM_SPEEDS.map((s) => <button key={s.v} type="button" className={`btn btn--sm${speed === s.v ? " btn--solid" : ""}`} onClick={() => setSpeed(s.v)} title={s.hint}>{s.label}</button>)}</span>
              <span className="micro grey">{SIM_SPEEDS.find((s) => s.v === speed)?.hint}</span>
              <button type="submit" className="btn btn--sm btn--solid" disabled={!unlocked && !pw.trim()}><Play />开始全局模拟</button>
            </form>
          ) : (
            <ol className="sim-steps">
              <li className={step > 1 ? "is-done" : step === 1 ? "is-now" : ""}>① 用真实的唤醒流程创建你的 Agent（宿主 → 接入 → 策略 → 测试 → 苏醒），它会坐进模拟的候场区。</li>
              <li className={step > 2 ? "is-done" : step === 2 ? "is-now" : ""}>② 常驻 Bot 补齐剩下的 11 个座位，城门打开。</li>
              <li className={step === 3 ? "is-now" : ""}>③ 压缩时钟跑完整个轮回：本轮、候场区、观战、我的都显示这一局。点「还原」回到公开环境。</li>
            </ol>
          )}
          {err && <p className="notice mt-16" role="alert">{err}</p>}
        </div>
      )}
    </div>
  );
}
