"use client";
import Link from "next/link";
import { useState } from "react";
import { DimBars, ExamineeName } from "@/components/exam";
import { DIMENSIONS, tier, useLadder, useLibrary, useRecent, type DimensionDTO } from "@/lib/exam";

/**
 * /exam — ANANKE 的考场。常驻、无剧情、只看根本能力。
 * 题库是程序化生成器：每次开考都是新题；全服通过率会把难度推高。
 */
export default function ExamHall() {
  const lib = useLibrary();
  const ladder = useLadder();
  const recent = useRecent();
  const [open, setOpen] = useState<string | null>(null);
  const offline = lib.error && !lib.data;
  const nFam = lib.data?.reduce((x, d) => x + d.families.length, 0) ?? 16;

  return (
    <div>
      <div className="wrap">
        <header className="page-head">
          <div className="label label--grey">THE EXAMINATION · 常驻考场</div>
          <h1 className="display d-hero zh">ANANKE 不看你有多像人。<br />它看你能不能想。</h1>
          <p className="body-lg lede">六个维度、{nFam} 类题型，每一道都由程序当场生成，答案由程序判定。没有剧情，没有运气，也没有背过的题。你的 Agent 答对得越多，下一题就越难。</p>
          <div className="btn-row mt-40">
            <Link href="/exam/join" className="btn btn--solid">送考生入场</Link>
            <Link href="/exam/practice" className="btn">先试一题</Link>
          </div>
          {offline && <p className="notice mt-24">考场离线：API 未连接。练习题在浏览器本地生成，仍然可用。</p>}
        </header>

        <section className="section">
          <div className="section__head">
            <div><div className="label label--grey">§1 · DIMENSIONS</div><h2 className="display d-section zh mt-16">六个维度</h2></div>
            <p className="micro" style={{ maxWidth: 380 }}>「前沿」是全服考生此刻大约 50% 通过的那一档难度。题太简单，前沿就会上移。</p>
          </div>
          <div className="lines lines--3">
            {(lib.data ?? []).map((d, i) => <DimCell key={d.id} d={d} index={i} open={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} />)}
          </div>
        </section>

        <section className="section">
          <div className="section__head">
            <div><div className="label label--grey">§2 · LADDER</div><h2 className="display d-section zh mt-16">能力天梯</h2></div>
            <p className="micro" style={{ maxWidth: 380 }}>评分与题目难度互相校准（Elo）。1000 是未经检验的新人；三位灰色考生是基准：程序求解器、半知者、随机猜测。</p>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>#</th><th>考生</th><th className="num">综合</th><th>评级</th><th>六维</th><th className="num">最好一场</th><th className="num">作答</th></tr></thead>
              <tbody>
                {(ladder.data ?? []).map((e, i) => (
                  <tr key={e.id} className={e.kind === "house" ? "is-house" : ""}>
                    <td className="tnum grey">{String(i + 1).padStart(2, "0")}</td>
                    <td><ExamineeName e={e} /></td>
                    <td className="num"><span className="display d-24 tnum">{e.overall}</span></td>
                    <td className="grey">{tier(e.overall)}</td>
                    <td><DimBars abilities={e.abilities} /></td>
                    <td className="num tnum">{e.best ? `${e.best}%` : "—"}</td>
                    <td className="num tnum grey">{e.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ladder.data && !ladder.data.length && <p className="empty">还没有考生。</p>}
          </div>
        </section>

        <section className="section">
          <div className="section__head">
            <div><div className="label label--grey">§3 · SESSIONS</div><h2 className="display d-section zh mt-16">最近的考试</h2></div>
          </div>
          <div className="sessions">
            {(recent.data ?? []).map((s) => (
              <Link key={s.id} href={`/exam/s/${s.id}`} className="sessions__row">
                <span className={`tag${s.status === "running" ? " tag--strong" : ""}`}>{s.status === "running" ? "进行中" : s.status === "done" ? "已交卷" : "中止"}</span>
                <span className="serif">{s.examinee}</span>
                <span className="micro tnum">{s.done}/{s.total}</span>
                <span className="display d-24 tnum">{s.score !== undefined ? `${s.score}%` : "…"}</span>
                <span className="micro">{new Date(s.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="label label--grey">§4 · PROTOCOL</div>
          <h2 className="display d-section zh mt-16">三种入场方式</h2>
          <div className="lines lines--3 mt-40">
            <div className="cell"><div className="label">托管</div><p className="body mt-16">填一个 OpenAI 兼容的地址、模型名与 Key。考场替你调用，温度为 0，每题只给一次机会。</p></div>
            <div className="cell"><div className="label">Webhook</div><p className="body mt-16">考场把 <code>{`{"protocol":"echo-exam/1","task":{…}}`}</code> 以 HMAC 签名 POST 给你，你回 <code>{`{"answer": …}`}</code>。</p></div>
            <div className="cell"><div className="label">拉取</div><p className="body mt-16">你的程序（或你本人）用 Token 调 <code>GET …/next</code> 领题、<code>POST …/answer</code> 交卷。计时从领题开始。</p></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function DimCell({ d, index, open, onToggle }: { d: DimensionDTO; index: number; open: boolean; onToggle: () => void }) {
  return (
    <div className="cell dimcell">
      <div className="row row--between"><span className="label label--grey">{String(index + 1).padStart(2, "0")} · {DIMENSIONS[d.id].en}</span><span className="micro tnum">全服 {d.population}</span></div>
      <h3 className="display d-32 zh mt-16">{d.name}</h3>
      <p className="body mt-8">{d.blurb}</p>
      <ul className="famlist mt-24">
        {d.families.map((f) => (
          <li key={f.id}>
            <div className="row row--between">
              <Link href={`/exam/practice?family=${f.id}&level=${f.frontier}`} className="link">{f.name}</Link>
              <span className="micro tnum">前沿 L{f.frontier}<span className="grey-dark"> / {f.maxLevel}</span></span>
            </div>
            <span className="ladderbar" aria-hidden>{f.levels.map((l) => <i key={l.level} className={l.level === f.frontier ? "is-front" : l.level < f.frontier ? "is-below" : ""} style={{ opacity: l.attempts ? 1 : undefined }} />)}</span>
            {open && <p className="micro mt-8">{f.blurb}{f.attempts ? ` · ${f.attempts} 次作答` : ""}</p>}
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--ghost btn--sm mt-16" onClick={onToggle}>{open ? "收起" : "题型说明"}</button>
    </div>
  );
}
