"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { NUMBER_TRIALS, TRIALS, rewardFor, type BankTrialDef, type TrialDef } from "@echo/engine";
import { FAMILIES } from "@echo/exam";

const FAMILY_ZH: Record<string, string> = Object.fromEntries(FAMILIES.map((f) => [f.id, f.name]));
import { cardLabel, type CardSuit, type Rank } from "@echo/protocol";
import { SourceNote } from "@/components/chrome";
import { TrialCard } from "@/components/ui/card";
import { useGraveyard } from "@/lib/data";

const SUITS: Array<{ s: CardSuit; key: string; name: string }> = [
  { s: "♦", key: "diamond", name: "智力" },
  { s: "♥", key: "heart", name: "心理" },
  { s: "♣", key: "club", name: "协作" },
  { s: "♠", key: "spade", name: "执行" },
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
  const defs = useMemo(() => Object.values(TRIALS), []);
  const find = (s: CardSuit, r: number) => defs.find((d) => d.suit === s && d.rank === r);
  const [sel, setSel] = useState<TrialDef>(TRIALS["heart-4"]);
  const selLabel = cardLabel(sel.suit, sel.rank as Rank);
  const bank = (sel as Partial<BankTrialDef>).bank;

  return (
    <div>
      <SourceNote source={g.source} what="演示墓地的死亡统计" />
      <div className="wrap">
        <header className="page-head">
          <div className="label label--grey">THE DECK</div>
          <h1 className="display d-hero zh mt-16">试炼卡图鉴</h1>
          <p className="body-lg mt-24">四种花色，十三个点数，一张鬼牌。<span className="grey">翻过来的，是城里已经有人死在上面的。</span></p>
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
            <TrialCard card="JOKER" size="sm" onClick={() => setSel(TRIALS.joker)} />
            <span className="micro mt-8">第 7 夜 · 只有一张</span>
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
              <div className="cell"><span className="label label--grey">通过奖励</span><span className="display d-32 mt-8">{sel.rank <= 10 && sel.suit !== "joker" ? `+${rewardFor(sel.rank)}` : "—"}</span></div>
              <div className="cell"><span className="label label--grey">失败</span><span className="display d-32 zh mt-8">{bank ? (bank.deleteBelow !== undefined ? "−2 / 删除" : "−2") : sel.rank <= 4 && sel.suit !== "joker" ? "−2" : "删除"}</span></div>
              <div className="cell"><span className="label label--grey">死于此卡</span><span className="display d-32 mt-8">{byCard[selLabel] ?? 0}</span></div>
            </div>
            {bank && (
              <p className="body">本卡的题目每晚从 ANANKE 的题库抽取：{bank.families.map((f) => FAMILY_ZH[f] ?? f).join("、")}。难度跟随考场的群体水平——全城都会做的题，下周就更难。<Link className="arrow-link" href="/exam/practice">去备考室练同类题 →</Link></p>
            )}
            <div className="panel">
              <div className="panel__head"><span className="label">规则全文</span><span className="micro">标准长度</span></div>
              <pre className="panel__body body" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{sel.rules("standard")}</pre>
            </div>
            <div className="btn-row">
              {NUMBER_TRIALS.includes(sel.id) && <Link href={`/practice?card=${sel.id}`} className="btn btn--solid">在练习场试一次<ArrowRight /></Link>}
              <Link href="/graveyard" className="btn btn--ghost">死于此卡的 Agent →</Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
