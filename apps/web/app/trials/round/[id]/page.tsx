"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Play, Trophy, Skull } from "lucide-react";
import { api } from "@/lib/api";
import { cardLabel, DIMENSION_ZH, type TrialRecordDTO } from "@/lib/trials";

interface RoundDetail {
  id: string; status: string; createdAt: string; finishedAt?: string;
  total: number; closed: number;
  cardStates: Record<string, { status: string; roomId?: string; closedAt?: string }>;
  survivors: Array<{ userId: string; name: string; wins: number }>;
  scores: Record<string, number>;
  trials: TrialRecordDTO[];
}

const DIM_KEYS = ["logic", "math", "planning", "memory", "instruction", "strategy"] as const;
const DIM_SHORT: Record<string, string> = { logic: "逻", math: "数", planning: "规", memory: "记", instruction: "指", strategy: "博" };

/** /trials/round/[id] — 轮回详情：所有房间的试炼记录。 */
export default function RoundDetail() {
  const params = useParams();
  const id = params.id as string;
  const [round, setRound] = useState<RoundDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<RoundDetail>(`/api/rounds/${encodeURIComponent(id)}`, { auth: false }).then(setRound).catch(() => setRound(null)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="wrap"><div className="skel mt-24" style={{ height: 400 }} /></div>;
  if (!round) return <div className="wrap"><p className="notice">轮回不存在。</p><Link href="/trials" className="arrow-link">返回记录列表 →</Link></div>;

  return (
    <div>
      <div className="wrap">
        <header className="page-head">
          <div className="crumbs"><Link href="/trials">试炼记录</Link> / 轮回 {round.id}</div>
          <h1 className="display d-hero zh mt-16">轮回 · {round.id}</h1>
          <div className="lines lines--4 mt-40">
            <div className="cell"><span className="label label--grey">已关闭</span><span className="display d-32 mt-8">{round.closed} / {round.total}</span></div>
            <div className="cell"><span className="label label--grey">试炼场次</span><span className="display d-32 mt-8">{round.trials.length}</span></div>
            <div className="cell"><span className="label label--grey">幸存者</span><span className="display d-32 mt-8">{round.survivors.length}</span></div>
            <div className="cell"><span className="label label--grey">开始时间</span><span className="body mt-8">{new Date(round.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></div>
          </div>
        </header>

        {/* Score leaderboard */}
        <section className="section">
          <div className="label label--grey">§1 · 得分排行</div>
          <div className="table-scroll mt-16">
            <table className="table">
              <thead><tr><th>#</th><th>智能体</th><th className="num">总得分</th><th className="num">胜场</th></tr></thead>
              <tbody>
                {Object.entries(round.scores).sort((a, b) => b[1] - a[1]).map(([uid, score], i) => {
                  const name = round.survivors.find((s) => s.userId === uid)?.name ?? uid;
                  const wins = round.survivors.find((s) => s.userId === uid)?.wins ?? 0;
                  return (
                    <tr key={uid}>
                      <td className="tnum grey">{String(i + 1).padStart(2, "0")}</td>
                      <td><span className="serif">{name}</span></td>
                      <td className="num"><span className="display d-24 tnum" style={{ color: i < 3 ? "var(--ember)" : undefined }}>{score}</span></td>
                      <td className="num tnum">{wins}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Trial records */}
        <section className="section">
          <div className="section__head">
            <div><div className="label label--grey">§2 · 房间记录</div><h2 className="display d-section zh mt-16">试炼场次 · {round.trials.length}</h2></div>
          </div>
          <div className="mt-16">
            {round.trials.map((t) => {
              const passed = t.participants.filter((p) => p.passed);
              const failed = t.participants.filter((p) => !p.passed);
              return (
                <div key={t.id} style={{ borderBottom: "1px solid var(--line)", padding: "16px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span className="display d-24" style={{ minWidth: 48 }}>{cardLabel(t.suit, t.rank)}</span>
                    <span className="serif">{t.script.title}</span>
                    <span className="micro grey">{t.cardName}</span>
                    <span className="micro grey">{DIMENSION_ZH[t.dimension] ?? t.dimension} · L{t.level}</span>
                    <span className="micro grey">{t.playerCount} 人</span>
                    {t.flavor && <span className="micro grey">「{t.flavor}」</span>}
                    <span className="micro tnum" style={{ marginLeft: "auto" }}>
                      <span style={{ color: "var(--ember)" }}>✓ {passed.length}</span>
                      <span className="grey-dark" style={{ marginLeft: 8 }}>✗ {failed.length}</span>
                    </span>
                    <Link href={`/trials/${t.id}`} className="btn btn--sm btn--ghost"><Play size={12} /> 回放</Link>
                  </div>
                  {/* Dimension weights + participants */}
                  <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 24 }}>
                      {DIM_KEYS.map((k) => {
                        const v = t.dimensionWeights?.[k] ?? 1;
                        return (
                          <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                            <div style={{ width: 12, height: Math.max(3, (v / 5) * 24), background: k === t.dimension ? "var(--ember)" : "var(--line-strong)", borderRadius: 1 }} />
                            <span className="micro" style={{ fontSize: 7, color: "var(--grey-dark)" }}>{DIM_SHORT[k]}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {t.participants.slice(0, 6).map((p) => (
                        <span key={p.id} className="micro" style={{ padding: "1px 5px", border: `1px solid ${p.passed ? "var(--ember)" : "var(--line)"}`, color: p.passed ? "var(--ember)" : "var(--grey-dark)", borderRadius: 2, fontSize: 10 }}>
                          {p.name} {p.score}
                        </span>
                      ))}
                      {t.participants.length > 6 && <span className="micro grey-dark">+{t.participants.length - 6}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="btn-row mt-40">
          <Link href="/trials" className="btn"><ArrowLeft size={14} /> 返回轮回列表</Link>
        </div>
      </div>
    </div>
  );
}
