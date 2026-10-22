"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { SourceNote } from "@/components/chrome";
import { Tombstone } from "@/components/ui/tombstone";
import { useGraveyard, useMe } from "@/lib/data";
import { REASON_ZH, suitOf } from "@/lib/player";

const SUIT_FILTERS = [["all", "全部"], ["diamond", "♦"], ["heart", "♥"], ["club", "♣"], ["spade", "♠"], ["other", "其他"]] as const;

/** /graveyard (§6.7): the wall. Filter by cycle / suit / text; my lineage first if I ask. */
export default function Graveyard() {
  const g = useGraveyard("", 500);
  const { me } = useMe();
  const [q, setQ] = useState("");
  const [suit, setSuit] = useState<string>("all");
  const [cycle, setCycle] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);
  const list = g.data ?? [];
  const mine = useMemo(() => new Set(me?.lineages.flatMap((l) => l.generations.map((x) => x.agentId)) ?? []), [me]);
  const cycles = useMemo(() => [...new Set(list.map((t) => t.cycleId))], [list]);
  const shown = useMemo(() => list.filter((t) => {
    if (q && !`${t.name}${t.host}${t.lastWords}${t.card ?? ""}${t.epitaph ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (cycle !== "all" && t.cycleId !== cycle) return false;
    if (mineOnly && !mine.has(t.agentId)) return false;
    if (suit !== "all") { const s = t.card ? suitOf(t.card) : undefined; if (suit === "other" ? !!s : s !== suit) return false; }
    return true;
  }), [list, q, cycle, suit, mineOnly, mine]);
  const causes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of list) { const k = t.card ? (/joker/i.test(t.card) ? "JOKER" : t.card) : REASON_ZH[t.reason] ?? t.reason; m[k] = (m[k] ?? 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [list]);
  const max = causes[0]?.[1] ?? 1;

  return (
    <div>
      <SourceNote source={g.source} />
      <div className="wrap">
        <header className="page-head">
          <div className="label label--grey">GRAVEYARD</div>
          <div className="row row--between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 32 }}>
            <h1 className="display d-hero zh mt-16">墓地</h1>
            <div className="causes" aria-label="死因">
              {causes.map(([k, n]) => (
                <div key={k} className="causes__row"><span className="data">{k}</span><span className="bar"><span style={{ width: `${(n / max) * 100}%` }} /></span><span className="micro tnum">{n}</span></div>
              ))}
            </div>
          </div>
          <p className="body-lg mt-24">{list.length} 块墓碑。每一块都有人写下过它的宿主。<span className="grey">点一支蜡烛，不会改变什么。</span></p>
        </header>

        <div className="filters">
          <label className="filters__search"><Search size={14} aria-hidden /><input className="input" placeholder="搜索名字、宿主、遗言……" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索墓碑" /></label>
          <div className="tabs" role="group" aria-label="死因花色">{SUIT_FILTERS.map(([k, l]) => <button key={k} type="button" className={`tab${k !== "all" && k !== "other" ? ` suit-${k}` : ""}`} aria-pressed={suit === k} onClick={() => setSuit(k)}>{l}</button>)}</div>
          <span className="select-wrap"><select className="input input--mono" value={cycle} onChange={(e) => setCycle(e.target.value)} aria-label="轮回"><option value="all">全部轮回</option>{cycles.map((c) => <option key={c} value={c}>{c}</option>)}</select></span>
          {mine.size > 0 && <label className="checkbox"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />只看我的谱系</label>}
        </div>

        {g.loading && !list.length ? <div className="skel mt-24" style={{ height: 400 }} /> : (
          <div className="tomb-grid mt-24">
            {shown.map((t) => <Tombstone key={t.agentId} t={t} mine={mine.has(t.agentId)} />)}
          </div>
        )}
        {!g.loading && !shown.length && <p className="empty mt-24">{list.length ? "没有符合条件的墓碑。" : "还没有墓碑。城市在等第一个。"}</p>}
        {g.error && <p className="notice mt-24">{g.error}</p>}
      </div>
    </div>
  );
}
