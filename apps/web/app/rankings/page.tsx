"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SourceNote } from "@/components/chrome";
import { Sigil } from "@/components/ui/sigil";
import { useCycles, useGraveyard } from "@/lib/data";

/**
 * /rankings (§6.11): lineage ladder. Derived client-side from the public graveyard and cycle list —
 * the city does not keep a score; it only remembers who died where.
 */
export default function Rankings() {
  const g = useGraveyard("", 500);
  const cycles = useCycles();
  const [tab, setTab] = useState<"lineage" | "cards">("lineage");
  const lineages = useMemo(() => {
    const m = new Map<string, { key: string; host: string; names: string[]; gens: number; furthest: number; cleared: number; ascended: number }>();
    for (const t of g.data ?? []) {
      const key = t.lineageId ?? `${t.host}:${t.relation}`;
      const r = m.get(key) ?? { key, host: t.host, names: [], gens: 0, furthest: 0, cleared: 0, ascended: 0 };
      r.names.push(t.name); r.gens = Math.max(r.gens, t.generation); r.furthest = Math.max(r.furthest, t.night); r.cleared += t.cardsCleared.length;
      m.set(key, r);
    }
    for (const c of cycles.data ?? []) if (c.winner) for (const r of m.values()) if (r.names.some((n) => c.winner!.startsWith(n.replace(/-[IVX]+$/, "")))) r.ascended++;
    return [...m.values()].sort((a, b) => b.ascended - a.ascended || b.furthest - a.furthest || b.cleared - a.cleared);
  }, [g.data, cycles.data]);
  const cards = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of g.data ?? []) if (t.card) { const c = /joker/i.test(t.card) ? "JOKER" : t.card; m[c] = (m[c] ?? 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [g.data]);
  const max = cards[0]?.[1] ?? 1;

  return (
    <div>
      <SourceNote source={g.source} />
      <div className="wrap">
        <header className="page-head">
          <div className="label label--grey">LADDER</div>
          <h1 className="display d-hero zh mt-16">天梯</h1>
          <p className="body-lg mt-24">城市不计分。它只记得谁死在了哪里。<span className="grey">这张表由墓地推算。</span></p>
          <div className="tabs mt-24"><button type="button" className="tab" aria-pressed={tab === "lineage"} onClick={() => setTab("lineage")}>谱系</button><button type="button" className="tab" aria-pressed={tab === "cards"} onClick={() => setTab("cards")}>最致命的牌</button></div>
        </header>
        {tab === "lineage" ? (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>#</th><th>宿主</th><th>谱系</th><th>世代</th><th>最远</th><th>通关</th><th>并入</th></tr></thead>
              <tbody>
                {lineages.map((r, i) => (
                  <tr key={r.key}>
                    <td className="tnum grey">{String(i + 1).padStart(2, "0")}</td>
                    <td><span className="row" style={{ gap: 10 }}><Sigil id={r.key} size={20} />{r.host}</span></td>
                    <td className="grey">{r.names.slice(-3).join(" → ")}</td>
                    <td className="tnum">{r.gens}</td>
                    <td className="tnum">第 {r.furthest} 夜</td>
                    <td className="tnum">{r.cleared}</td>
                    <td className="tnum ananke">{r.ascended ? `★ ${r.ascended}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!lineages.length && <p className="empty">还没有任何记录。</p>}
          </div>
        ) : (
          <div className="causes causes--wide">
            {cards.map(([c, n]) => <div key={c} className="causes__row"><span className="display d-24">{c}</span><span className="bar"><span style={{ width: `${(n / max) * 100}%` }} /></span><span className="data tnum">{n}</span></div>)}
            <p className="mt-24"><Link href="/cards" className="arrow-link">试炼卡图鉴 →</Link></p>
          </div>
        )}
      </div>
    </div>
  );
}
