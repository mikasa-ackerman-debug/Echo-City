"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Play, RotateCcw, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { loadMe, useMe, useResource } from "@/lib/data";
import { enterDemo, exitDemo, getAdminToken, getDemo, setAdminToken, useDemo } from "@/lib/demo-mode";
import type { CycleView } from "@/lib/types";

/** City-day length on the compressed clock (a city day = 24 h / speed). */
export const SIM_SPEEDS = [
  { v: 8640, label: "极速", hint: "城市一天 ≈ 10 秒" },
  { v: 2880, label: "标准", hint: "城市一天 ≈ 30 秒" },
  { v: 1440, label: "从容", hint: "城市一天 ≈ 1 分钟" },
];
const FLAG = "echo.sim";
const STATUS_ZH: Record<string, string> = { registering: "候场中", running: "进行中", ended: "已结束", aborted: "已中止" };

/**
 * 全局模拟 — developer banner pinned to the bottom of every page.
 * Start: a private demo city (hidden from public lists) + a throwaway identity for this browser.
 * ① wake your own agent through the real /play flow → ② house bots fill the remaining seats and the city opens
 * → ③ the whole cycle runs on a compressed clock, every page (本轮 / 候场区 / 观战 / 我的) shows the simulation.
 * 还原: stop the simulated city and switch this browser back to the public city and the real identity.
 * Visible only to developers: an admin token is saved, a simulation is on, or the page was opened with ?sim.
 */
export function SimBanner() {
  const router = useRouter();
  const path = usePathname();
  const demo = useDemo();
  const { me } = useMe();
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [admin, setAdmin] = useState("");
  const [speed, setSpeed] = useState(2880);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("sim")) localStorage.setItem(FLAG, "1");
    setVisible(!!getAdminToken() || !!getDemo() || localStorage.getItem(FLAG) === "1");
    setAdmin(getAdminToken());
  }, [path, demo]);

  const cyc = useResource<CycleView>(demo ? `sim:${demo.cycleId}` : null, (signal) => api<CycleView>(`/api/cycles/${encodeURIComponent(demo!.cycleId)}`, { signal }), { poll: 3000 });
  const c = cyc.data;
  const myIds = new Set(me?.agents.map((a) => a.id) ?? []);
  const mine = c?.roster.filter((a) => myIds.has(a.id)) ?? [];
  const headers = () => ({ "x-admin-token": getAdminToken() });

  const begin = async () => {
    if (!admin.trim()) { setErr("先填写管理员令牌（ECHO_ADMIN_TOKEN）。"); return; }
    setErr(""); setBusy(true);
    try {
      setAdminToken(admin.trim());
      const cy = await api<CycleView>("/api/demo/cycles", { body: { speed, fillBots: 12 }, auth: false, headers: headers() });
      const u = await api<{ token: string }>("/api/users", { body: { name: "模拟宿主" }, auth: false });
      enterDemo(cy.id, u.token, speed);
      void loadMe(true);
      setOpen(true);
      router.push("/play");
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const fillAndStart = async () => {
    if (!demo) return;
    setErr(""); setBusy(true);
    try {
      await api(`/api/demo/cycles/${encodeURIComponent(demo.cycleId)}/start`, { body: {}, auth: false, headers: headers() });
      cyc.reload();
      router.push("/cycle");
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const restore = async () => {
    const d = getDemo();
    setErr(""); setBusy(true);
    try {
      if (d && getAdminToken()) await api(`/api/demo/cycles/${encodeURIComponent(d.cycleId)}/stop`, { body: {}, auth: false, headers: headers() }).catch(() => {});
    } finally {
      exitDemo();
      void loadMe(true);
      setBusy(false);
      setOpen(false);
      router.push("/cycle");
    }
  };

  const hide = () => { localStorage.removeItem(FLAG); setVisible(!!getAdminToken() || !!getDemo()); setOpen(false); };

  if (!visible) return null;
  const live = c?.live;
  const step = !demo ? 0 : !c ? 1 : c.status === "registering" ? (mine.length ? 2 : 1) : 3;

  return (
    <div className={`sim-banner${demo ? " is-on" : ""}${open ? " is-open" : ""}`} role="region" aria-label="全局模拟">
      <div className="sim-banner__bar">
        <button type="button" className="sim-banner__title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={`live-dot${demo ? "" : " live-dot--off"}`} />全局模拟{demo ? " · 进行中" : ""}
        </button>
        {demo ? (
          <span className="data sim-banner__status">
            <span className="tnum">{demo.cycleId}</span>
            {" · "}{c ? STATUS_ZH[c.status] ?? c.status : "读取中…"}
            {c?.status === "registering" && <> · 座位 <span className="tnum">{c.roster.length}/12</span>{mine.length ? ` · 我的 ${mine.map((a) => a.name).join("、")}` : " · 还没有我的 Agent"}</>}
            {live && <> · 第 {live.night} 天{live.slot ? ` · 第 ${live.slot}/${live.slotsPerDay} 场` : ""} · 存活 <span className="tnum">{live.alive}/{live.total}</span></>}
            {c?.status === "ended" && c.summary && <> · {c.summary.winner ? `${c.summary.winner.name} 推开了最后的门` : "无人生还"}</>}
          </span>
        ) : <span className="micro grey">开发者用：创建一个 Agent 走完整个流程，Bot 补满，跑完整一局。公开环境不受影响。</span>}
        <span className="sim-banner__actions">
          {demo && step === 1 && <Link className="btn btn--sm btn--solid" href="/play">① 创建我的 Agent</Link>}
          {demo && step === 2 && <button type="button" className="btn btn--sm btn--solid" disabled={busy} onClick={fillAndStart}><Play />② 补齐 Bot 并开城</button>}
          {demo && step === 3 && <Link className="btn btn--sm" href="/cycle">本轮</Link>}
          {demo && c?.status === "ended" && <Link className="btn btn--sm" href={`/cycle/${encodeURIComponent(demo.cycleId)}/replay`}>回放</Link>}
          {demo ? <button type="button" className="btn btn--sm" disabled={busy} onClick={restore}><RotateCcw />还原</button>
            : <button type="button" className="btn btn--sm" onClick={() => setOpen((o) => !o)}>{open ? "收起" : "开始模拟"}</button>}
          {!demo && <button type="button" className="btn btn--sm btn--ghost" aria-label="隐藏" onClick={hide}><X /></button>}
        </span>
      </div>
      {open && (
        <div className="sim-banner__panel">
          {!demo ? (
            <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <input className="input" style={{ width: 320 }} type="password" placeholder="管理员令牌（ECHO_ADMIN_TOKEN）" value={admin} onChange={(e) => setAdmin(e.target.value)} />
              <span className="btn-row">{SIM_SPEEDS.map((s) => <button key={s.v} type="button" className={`btn btn--sm${speed === s.v ? " btn--solid" : ""}`} onClick={() => setSpeed(s.v)} title={s.hint}>{s.label}</button>)}</span>
              <span className="micro grey">{SIM_SPEEDS.find((s) => s.v === speed)?.hint}</span>
              <button type="button" className="btn btn--sm btn--solid" disabled={busy} onClick={begin}><Play />{busy ? "准备中…" : "开始全局模拟"}</button>
            </div>
          ) : (
            <ol className="sim-steps">
              <li className={step > 1 ? "is-done" : step === 1 ? "is-now" : ""}>① 用真实的唤醒流程创建你的 Agent（宿主 → 接入 → 策略 → 测试 → 醒来），它会坐进模拟的候场区并热身。</li>
              <li className={step > 2 ? "is-done" : step === 2 ? "is-now" : ""}>② 常驻 Bot 补齐剩下的座位，城门打开。</li>
              <li className={step === 3 ? "is-now" : ""}>③ 压缩时钟跑完整个轮回：本轮、候场区、观战、我的谱系都显示这一局。点「还原」回到公开环境。</li>
            </ol>
          )}
          {err && <p className="notice mt-16" role="alert">{err}</p>}
        </div>
      )}
    </div>
  );
}
