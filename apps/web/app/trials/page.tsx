"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Layers } from "lucide-react";
import { api } from "@/lib/api";

interface RoundSummary {
  id: string; status: string; createdAt: string; finishedAt?: string;
  total: number; closed: number; trialCount: number; survivorCount: number;
  topScorers: Array<{ id: string; name: string; score: number }>;
}

const STATUS_ZH: Record<string, string> = { active: "进行中", joker: "Joker 阶段", finished: "已结束" };

/** /trials — 轮回列表。点击进入轮回详情查看所有房间记录。 */
export default function Trials() {
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<RoundSummary[]>("/api/rounds", { auth: false }).then(setRounds).catch(() => setRounds([])).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="wrap">
        <header className="page-head">
          <div className="label label--grey">TRIAL ROUNDS</div>
          <h1 className="display d-hero zh mt-16">试炼记录</h1>
          <p className="body-lg mt-24">每一轮回留下一组战斗痕迹。<span className="grey">点进去，看每一张牌发生了什么。</span></p>
        </header>

        {loading ? <div className="skel mt-24" style={{ height: 200 }} /> : (
          <div className="mt-24" style={{ display: "grid", gap: 16, maxWidth: 800 }}>
            {rounds.length === 0 && (
              <div className="panel"><div className="panel__body"><p className="body grey">还没有轮回记录。在图鉴页点击「⚡ 启动轮回」开始第一个轮回。</p></div></div>
            )}
            {rounds.map((r) => (
              <Link key={r.id} href={`/trials/round/${r.id}`} className="panel" style={{ display: "block", textDecoration: "none", cursor: "pointer", transition: "border-color 0.15s" }}>
                <div className="panel__head">
                  <span className="label"><Layers size={14} style={{ verticalAlign: -2, marginRight: 6 }} />轮回 · {r.id}</span>
                  <span className={`tag${r.status === "active" ? " tag--strong" : ""}`}>{STATUS_ZH[r.status] ?? r.status}</span>
                </div>
                <div className="panel__body">
                  <div className="lines lines--4" style={{ margin: 0 }}>
                    <div className="cell cell--tight"><span className="label label--grey">已关闭</span><span className="display d-32 mt-8">{r.closed} / {r.total}</span></div>
                    <div className="cell cell--tight"><span className="label label--grey">试炼场次</span><span className="display d-32 mt-8">{r.trialCount}</span></div>
                    <div className="cell cell--tight"><span className="label label--grey">幸存者</span><span className="display d-32 mt-8">{r.survivorCount}</span></div>
                    <div className="cell cell--tight"><span className="label label--grey">最高分</span><span className="display d-32 mt-8">{r.topScorers[0]?.score ?? "—"}</span></div>
                  </div>
                  {r.topScorers.length > 0 && (
                    <div className="row mt-16" style={{ gap: 12 }}>
                      {r.topScorers.map((s, i) => (
                        <span key={s.id} className="micro"><span className="grey-dark">{i + 1}.</span> <span className="serif">{s.name}</span> <span className="tnum" style={{ color: "var(--ember)" }}>{s.score}</span></span>
                      ))}
                    </div>
                  )}
                  <div className="row mt-16" style={{ justifyContent: "flex-end" }}>
                    <span className="micro grey">查看详情 <ArrowRight size={12} style={{ verticalAlign: -1 }} /></span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
