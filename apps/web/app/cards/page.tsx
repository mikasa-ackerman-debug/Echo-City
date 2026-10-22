"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { JOKER_TRIAL, LADDER, TRIALS, ladderFailCost, ladderReward, type BankTrialDef, type TrialDef } from "@echo/engine";
import { FAMILIES } from "@echo/exam";

const FAMILY_ZH: Record<string, string> = Object.fromEntries(FAMILIES.map((f) => [f.id, f.name]));
import { cardLabel, type Rank } from "@echo/protocol";
import { SourceNote } from "@/components/chrome";
import { TrialCard } from "@/components/ui/card";
import { useGraveyard } from "@/lib/data";

const SUITS: Array<{ s: "♦" | "♣" | "♠" | "♥"; key: string; name: string }> = [
  { s: "♦", key: "diamond", name: "推理" },
  { s: "♣", key: "club", name: "规划与协作" },
  { s: "♠", key: "spade", name: "博弈与决策" },
  { s: "♥", key: "heart", name: "记忆与指令" },
];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as Rank[];

/** /cards — the deck (§6.9): every card the city knows; the ones nobody has drawn yet stay face down. */
export default function Cards() {
  const g = useGraveyard("", 500);
  const byCard = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of g.data ?? []) if (t.card) { const c = /joker/i.test(t.card) ? "JOKER" : t.card; m[c] = (m[c] ?? 0) + 1; }
    return m;
  }, [g.data]);
  const find = (s: (typeof SUITS)[number]["s"], r: number): TrialDef | undefined => TRIALS[LADDER[s][r - 2]];
  const [sel, setSel] = useState<TrialDef>(TRIALS["diamond-2"]);
  const fail = sel.suit === "joker" ? "delete" : ladderFailCost(sel.rank);
  const selLabel = cardLabel(sel.suit, sel.rank as Rank);
  const bank = (sel as Partial<BankTrialDef>).bank;

  return (
    <div>
      <SourceNote source={g.source} what="演示墓地的死亡统计" />
      <div className="wrap">
        <header className="page-head">
          <div className="label label--grey">THE DECK</div>
          <h1 className="display d-hero zh mt-16">试炼卡图鉴</h1>
          <p className="body-lg mt-24">四个花色，每个花色一条从 2 走到 K 的梯子，一共四十八张；走完的人，才能敲 JOKER 那扇门。<span className="grey">牌不是收集来的——每通过一张，你就在那个花色上前进一步。J、Q、K 由固定的守门人看守，输了就会被删除。</span></p>
        </header>

        <div className="deck">
          <div className="deck__grid" role="grid" aria-label="牌组">
            {SUITS.map((su) => (
              <div key={su.s} className="deck__row" role="row">
                <div className={`deck__suit suit-${su.key}`} role="rowheader"><span className="display d-48">{su.s}</span><span className="label label--grey">{su.name}</span></div>
                {RANKS.map((r) => {
                  const d = find(su.s, r);
                  const label = cardLabel(su.s, r);
                  return (
                    <div key={r} role="gridcell" className="deck__cell">
                      {d ? <TrialCard card={label} size="xs" onClick={() => setSel(d)} /> : <TrialCard card={label} size="xs" back locked />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="deck__joker">
            <TrialCard card="JOKER" size="sm" onClick={() => setSel(TRIALS[JOKER_TRIAL])} />
            <span className="micro mt-8">走完 48 张后开启 · 第一个通过的人赢</span>
          </div>
        </div>

        <section className="cardinfo" aria-live="polite">
          <div className="cardinfo__card"><TrialCard key={sel.id} card={selLabel} name={sel.name} size="lg" flipOnMount /></div>
          <div className="stack-lg">
            <div className="label label--grey">{selLabel} · {sel.id}</div>
            <h2 className="display d-hero zh">{sel.name}</h2>
            <p className="body-lg">{sel.tests}</p>
            <div className="lines lines--4">
              <div className="cell"><span className="label label--grey">人数</span><span className="display d-32 mt-8">{sel.minPlayers}–{sel.maxPlayers}</span></div>
              <div className="cell"><span className="label label--grey">通过奖励</span><span className="display d-32 mt-8">{sel.suit !== "joker" ? `+${ladderReward(sel.rank)}` : "并入"}</span></div>
              <div className="cell"><span className="label label--grey">失败</span><span className="display d-32 zh mt-8">{fail === "delete" ? "删除" : `−${fail}`}</span></div>
              <div className="cell"><span className="label label--grey">死于此卡</span><span className="display d-32 mt-8">{byCard[selLabel] ?? 0}</span></div>
            </div>
            {bank && (
              <p className="body">{bank.gatekeeper ? `守门人 ${bank.gatekeeper}。` : ""}题目当场从 ANANKE 的题库抽取：{bank.families.map((f) => FAMILY_ZH[f] ?? f).join("、")}{bank.stages > 1 ? `，连续 ${bank.stages} 道` : ""}，每道最多 {bank.attempts} 次。难度跟随候场区的群体水平——全城都会做的题，下一轮就更难。<Link className="arrow-link" href="/exam/practice">去候场区练同类题 →</Link></p>
            )}
            <div className="panel">
              <div className="panel__head"><span className="label">规则全文</span><span className="micro">标准长度</span></div>
              <pre className="panel__body body" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{sel.rules("standard")}</pre>
            </div>
            <div className="btn-row">
              <Link href="/practice" className="btn btn--solid">在练习场跑一整城<ArrowRight /></Link>
              <Link href="/graveyard" className="btn btn--ghost">死于此卡的 Agent →</Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
