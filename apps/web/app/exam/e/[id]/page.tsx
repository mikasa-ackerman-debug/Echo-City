"use client";
import Link from "next/link";
import { use } from "react";
import { Radar } from "@/components/exam";
import { DIMENSIONS, DIMENSION_IDS, KIND_ZH, tier, useLadder, useProfile } from "@/lib/exam";

/** /exam/e/[id] — 考生档案：六维能力、与基准的对照、历次考试。 */
export default function ExamineePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const p = useProfile(id);
  const ladder = useLadder();
  const d = p.data;
  if (!d) return <div className="wrap"><p className="empty">{p.error ?? "读取档案……"}</p></div>;
  const e = d.examinee;
  const oracle = ladder.data?.find((x) => x.kind === "house" && x.name.startsWith("ANANKE"));

  return (
    <div className="wrap">
      <header className="page-head">
        <div className="crumbs"><Link href="/exam">考场</Link> / 考生</div>
        <div className="label label--grey mt-16">{KIND_ZH[e.kind]}{e.model ? ` · ${e.model}` : ""}{d.rank ? ` · 天梯第 ${d.rank}` : ""}{e.agentId ? " · 来自轮回的 Agent" : ""}</div>
        <h1 className="display d-hero zh">{e.name}</h1>
      </header>

      <section className="section examinee-grid">
        <div>
          <Radar abilities={e.abilities} compare={oracle && oracle.id !== e.id ? oracle.abilities : undefined} size={360} />
          {oracle && oracle.id !== e.id && <p className="micro mt-8">虚线：ANANKE·参考解（程序求解器）的成绩，作为上限参照。</p>}
        </div>
        <div>
          <div className="lines lines--2">
            <div className="cell"><span className="label label--grey">综合</span><span className="display d-48 tnum mt-16" style={{ display: "block" }}>{e.attempts ? e.overall : "—"}</span><span className="micro">{e.attempts ? tier(e.overall) : "尚未参加考试"}</span></div>
            <div className="cell"><span className="label label--grey">作答</span><span className="display d-48 tnum mt-16" style={{ display: "block" }}>{e.attempts}</span><span className="micro">{e.sessions} 场考试</span></div>
          </div>
          <table className="table mt-24">
            <tbody>{DIMENSION_IDS.map((dim) => (
              <tr key={dim}>
                <td><span className="serif">{DIMENSIONS[dim].name}</span><div className="micro">{DIMENSIONS[dim].blurb}</div></td>
                <td className="num"><span className="display d-24 tnum">{e.abilities[dim].n ? e.abilities[dim].r : "—"}</span></td>
                <td className="num micro">{e.abilities[dim].n} 题</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="label label--grey">历次考试</div>
        <div className="sessions mt-24">
          {d.sessions.map((s) => (
            <Link key={s.id} href={`/exam/s/${s.id}`} className="sessions__row">
              <span className={`tag${s.status === "running" ? " tag--strong" : ""}`}>{s.status === "running" ? "进行中" : s.status === "done" ? "已交卷" : "中止"}</span>
              <span className="micro">{new Date(s.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
              <span className="micro tnum">{s.done}/{s.total}</span>
              <span className="display d-24 tnum">{s.score !== undefined ? `${s.score}%` : "…"}</span>
              <span />
            </Link>
          ))}
          {!d.sessions.length && <p className="empty">还没有考试记录。</p>}
        </div>
      </section>
    </div>
  );
}
