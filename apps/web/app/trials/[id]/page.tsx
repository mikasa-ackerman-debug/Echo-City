"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Trophy, Skull } from "lucide-react";
import { cardLabel, DIMENSION_ZH, useTrial } from "@/lib/trials";

const DIM_KEYS = ["logic", "math", "planning", "memory", "instruction", "strategy"] as const;
const DIM_LABELS: Record<string, string> = { logic: "逻辑", math: "数学", planning: "规划", memory: "记忆", instruction: "指令", strategy: "博弈" };

/** /trials/[id] — 试炼回放：剧本概要、维度权重、参与者结果。 */
export default function TrialReplay() {
  const params = useParams();
  const id = params.id as string;
  const { data: t, loading, error } = useTrial(id);

  if (loading) return <div className="wrap"><div className="skel mt-24" style={{ height: 400 }} /></div>;
  if (error || !t) return <div className="wrap"><p className="notice">试炼记录不存在。</p></div>;

  const label = cardLabel(t.suit, t.rank);
  const passed = t.participants.filter((p) => p.passed);
  const failed = t.participants.filter((p) => !p.passed);

  return (
    <div>
      <div className="wrap">
        <header className="page-head">
          <div className="crumbs"><Link href="/trials">试炼记录</Link> / {t.script.title}</div>
          <div className="row" style={{ alignItems: "baseline", gap: 16 }}>
            <span className="display d-hero">{label}</span>
            <h1 className="display d-hero zh">{t.script.title}</h1>
          </div>
          <p className="body-lg mt-8">{t.script.summary}</p>
          <div className="row mt-16" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="tag">{t.cardName}</span>
            <span className="tag">{DIMENSION_ZH[t.dimension] ?? t.dimension}</span>
            <span className="tag">难度 L{t.level}</span>
            <span className="tag">{t.playerCount} 人</span>
            {t.flavor && <span className="tag">「{t.flavor}」</span>}
            <span className="micro grey-dark">{new Date(t.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
          </div>
        </header>

        {/* Dimension weights radar */}
        <section className="section">
          <div className="label label--grey">§1 · 维度权重</div>
          <div className="lines lines--3 mt-16">
            {DIM_KEYS.map((k) => {
              const v = t.dimensionWeights?.[k] ?? 1;
              return (
                <div key={k} className="cell">
                  <div className="row row--between">
                    <span className="label label--grey">{DIM_LABELS[k]}</span>
                    <span className="display d-24 tnum">{v}</span>
                  </div>
                  <div className="ladderbar mt-8" aria-hidden>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <i key={i} className={i < v ? (k === t.dimension ? "is-front" : "is-below") : ""} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Participants & Results */}
        <section className="section">
          <div className="section__head">
            <div><div className="label label--grey">§2 · 结果</div><h2 className="display d-section zh mt-16">参与者</h2></div>
            <p className="micro"><span style={{ color: "var(--ember)" }}>✓ {passed.length} 通过</span> · <span className="grey-dark">✗ {failed.length} 失败</span></p>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>结果</th><th>参与者</th><th className="num">评分</th><th className="num">存活轮数</th><th>备注</th></tr></thead>
              <tbody>
                {t.participants.map((p) => (
                  <tr key={p.id} style={{ opacity: p.passed ? 1 : 0.55 }}>
                    <td>{p.passed ? <Trophy size={14} style={{ color: "var(--ember)" }} /> : <Skull size={14} style={{ color: "var(--grey-dark)" }} />}</td>
                    <td><span className="serif">{p.name}</span></td>
                    <td className="num"><span className="display d-24 tnum">{p.score ?? "—"}</span></td>
                    <td className="num tnum">{p.survivalRounds ?? "—"}</td>
                    <td className="micro grey">{p.notable ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Script preview */}
        <section className="section">
          <div className="label label--grey">§3 · 剧本</div>
          <div className="panel mt-16">
            <div className="panel__head"><span className="label">{t.script.title}</span><span className="micro">{t.script.path}</span></div>
            <div className="panel__body">
              <p className="body">{t.script.summary}</p>
              <p className="body mt-16 grey">完整剧本见 <code>{t.script.path}</code>。</p>
            </div>
          </div>
        </section>

        <div className="btn-row mt-40">
          <Link href="/trials" className="btn"><ArrowLeft size={14} /> 返回记录列表</Link>
          <Link href="/cards" className="btn btn--ghost">回到图鉴</Link>
        </div>
      </div>
    </div>
  );
}
