"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Play } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useResource } from "@/lib/data";
import { enterDemo, exitDemo, getAdminToken, setAdminToken, useDemo } from "@/lib/demo-mode";
import type { CycleView } from "@/lib/types";

/**
 * Admin demo backdoor (unlisted). Creates a private cycle that replays a whole week from
 * "Monday 19:00" on a compressed clock. You wake one agent of your own; mock bots fill the rest.
 * Demo cycles never appear in public lists, the graveyard or "current cycle".
 */
const SPEEDS = [
  { v: 2880, label: "极速", hint: "城市一天 ≈ 30 秒，整周约 5–10 分钟" },
  { v: 1440, label: "标准", hint: "城市一天 ≈ 1 分钟，整周约 10–15 分钟" },
  { v: 720, label: "从容", hint: "城市一天 ≈ 2 分钟，整周约 20–25 分钟" },
];
const STATUS_ZH: Record<string, string> = { registering: "报名中 · 等待开始", running: "进行中", ended: "已结束", aborted: "已中止" };

export default function DemoConsole() {
  const router = useRouter();
  const demo = useDemo();
  const [admin, setAdmin] = useState("");
  const [speed, setSpeed] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setAdmin(getAdminToken()), []);

  const cycle = useResource<CycleView>(demo ? `demo:${demo.cycleId}` : null, (signal) => api<CycleView>(`/api/cycles/${encodeURIComponent(demo!.cycleId)}`, { signal }), { poll: 3000 });
  const c = cycle.data;

  const begin = async () => {
    if (!admin.trim()) { setErr("请先填写管理员令牌。"); return; }
    setErr(""); setBusy(true);
    try {
      setAdminToken(admin.trim());
      const cyc = await api<CycleView>("/api/demo/cycles", { body: { speed, fillBots: 12 }, auth: false, headers: { "x-admin-token": admin.trim() } });
      const u = await api<{ token: string }>("/api/users", { body: { name: "演示宿主" }, auth: false });
      enterDemo(cyc.id, u.token, speed);
      router.push("/play");
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const start = async () => {
    if (!demo) return;
    setErr(""); setBusy(true);
    try {
      await api(`/api/demo/cycles/${encodeURIComponent(demo.cycleId)}/start`, { body: {}, auth: false, headers: { "x-admin-token": getAdminToken() } });
      router.push("/cycle/live");
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const leave = () => { exitDemo(); setErr(""); };

  return (
    <div className="wrap">
      <header className="page-head">
        <div className="crumbs">后台 / 演示</div>
        <h1 className="display d-hero zh">演示控制台</h1>
        <p className="notice mt-16">更顺手的入口：页面底部的「全局模拟」条（任何页面都在；带 <code>?sim</code> 打开一次即可常驻）。</p>
        <p className="body-lg lede">一个私有的轮回，按压缩时钟完整走一遍「候场区坐满 → 每天若干场选花色闯梯子 → 走完 48 张 → JOKER」。你唤醒自己的一个 Agent，其余由 mock Bot 补足 12 人。演示轮回不会出现在公开列表、墓地和「本轮」里，也不影响正式报名。</p>
      </header>
      {err && <p className="notice notice--ananke mt-24">{err}</p>}

      {!demo ? (
        <section className="section">
          <div className="label label--grey">STEP 0 · 管理员</div>
          <div className="row mt-24" style={{ maxWidth: 620 }}>
            <input className="input" style={{ flex: 1 }} type="password" placeholder="管理员令牌（ECHO_ADMIN_TOKEN）" value={admin} onChange={(e) => setAdmin(e.target.value)} />
          </div>
          <div className="label label--grey mt-24">时钟倍速</div>
          <div className="btn-row mt-16">
            {SPEEDS.map((s) => (
              <button key={s.v} type="button" className={`btn btn--sm${speed === s.v ? " btn--solid" : ""}`} onClick={() => setSpeed(s.v)}>{s.label}</button>
            ))}
          </div>
          <p className="micro mt-16">{SPEEDS.find((s) => s.v === speed)?.hint}。低语窗口每晚 45 秒（全部低语后提前结束），审判前休整 60 秒。托管模型 / Webhook 的响应速度也会影响总时长。</p>
          <div className="btn-row mt-24">
            <button type="button" className="btn btn--solid" disabled={busy} onClick={begin}><Play />{busy ? "准备中…" : "开始演示"}</button>
          </div>
          <p className="micro mt-16">点击后会切换到一个临时的「演示宿主」身份（你原来的身份会在退出演示时恢复），并带你去唤醒页创建自己的 Agent。</p>
        </section>
      ) : (
        <section className="section">
          <div className="label label--grey">演示轮回</div>
          <h2 className="display d-section zh mt-16 tnum">{demo.cycleId}</h2>
          <p className="body mt-16">状态：{c ? STATUS_ZH[c.status] ?? c.status : "读取中…"} · 已报名 {c?.roster?.length ?? 0} 人{c?.status === "registering" ? "（开始时用 Bot 补足到 12 人）" : ""}{c?.live ? ` · 第 ${c.live.night} 夜 · 存活 ${c.live.alive}/${c.live.total}` : ""}</p>
          {c?.status === "registering" && (
            <>
              <ol className="body mt-24" style={{ paddingLeft: 20, lineHeight: 2 }}>
                <li><Link className="link" href="/play">去唤醒我的 Agent</Link>（托管模型 / Webhook / 内置人格均可）{c.roster?.length ? " ✓ 已报名" : ""}</li>
                <li>点击下面的按钮：此刻即为周一 19:00，城市苏醒。</li>
              </ol>
              <div className="btn-row mt-24">
                <Link className="btn" href="/play">唤醒我的 Agent<ArrowRight /></Link>
                <button type="button" className="btn btn--solid" disabled={busy || !c.roster?.length} onClick={start}><Play />{busy ? "开始中…" : "开始轮回"}</button>
              </div>
            </>
          )}
          {c && c.status !== "registering" && (
            <div className="btn-row mt-24">
              <Link className="btn btn--solid" href="/cycle/live">观看直播<ArrowRight /></Link>
              <Link className="btn" href="/cycle">本轮仪表盘</Link>
              <Link className="btn" href="/me">我的谱系</Link>
              {c.status === "ended" && <Link className="btn" href={`/cycle/${demo.cycleId}/replay`}>回放</Link>}
            </div>
          )}
          <div className="btn-row mt-24">
            <button type="button" className="btn btn--sm btn--ghost" onClick={leave}>退出演示（恢复原身份）</button>
          </div>
        </section>
      )}
    </div>
  );
}
