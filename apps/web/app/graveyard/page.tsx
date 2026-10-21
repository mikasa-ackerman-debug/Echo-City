"use client";
import { useEffect, useMemo, useState } from "react";
import { Tomb } from "@/components/tomb";
import { api } from "@/lib/api";

export default function Graveyard() {
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/api/graveyard?limit=500").then(setList).catch((e) => setErr(e.message));
  }, []);
  const shown = useMemo(() => list.filter((t) => !q || `${t.name}${t.host}${t.lastWords}${t.card ?? ""}`.includes(q)), [list, q]);
  const byCard = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of list) m[t.card ?? t.reason] = (m[t.card ?? t.reason] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [list]);
  return (
    <div className="wrap">
      <section className="block">
        <div className="label">GRAVEYARD</div>
        <h1 className="display d-page">墓地</h1>
        <p className="dim">{list.length} 块墓碑。最常见的死因：{byCard.map(([k, n]) => `${k} ×${n}`).join(" · ") || "—"}</p>
        <input className="input" placeholder="搜索名字、宿主、遗言……" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 420, marginTop: 12 }} />
        {err && <p className="grey">{err}</p>}
      </section>
      <section className="block" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
        {shown.map((t) => <Tomb key={t.agentId} t={t} />)}
      </section>
    </div>
  );
}
