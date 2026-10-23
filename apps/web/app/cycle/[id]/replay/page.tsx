"use client";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { Player } from "@/components/player";
import { ReplayView } from "@/components/replay-view";
import { SourceNote } from "@/components/chrome";
import { useMe, useReplay } from "@/lib/data";

export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const r = useReplay(decodeURIComponent(id));
  const { me } = useMe();
  const mine = me?.agents.map((a) => a.id) ?? [];
  const [venue, setVenue] = useState<string | null>(null);
  useEffect(() => { setVenue(new URLSearchParams(window.location.search).get("venue")); }, []);
  // Single-table replay: from the moment the table was set to its settlement, pinned to that table.
  const clip = useMemo(() => {
    if (!venue || !r.data) return null;
    const evs = r.data.events;
    const start = evs.findIndex((e) => e.type === "trial_start" && (e.venue === venue || e.data?.venue === venue));
    if (start < 0) return null;
    const endRel = evs.slice(start).findIndex((e) => e.type === "trial_end" && (e.venue === venue || e.data?.venue === venue));
    const card = String(evs[start].data?.card ?? ""), name = String(evs[start].data?.name ?? "");
    return { startAt: Math.max(0, start - 3), stopAt: endRel < 0 ? evs.length : start + endRel + 2, card, name, day: evs[start].night };
  }, [venue, r.data]);
  if (r.error) return <div className="wrap page-head"><h1 className="display d-section zh grey">找不到这段回放。</h1><p className="data grey mt-16">{r.error}</p></div>;
  if (!r.data) return <div className="wrap page-head"><div className="skel" style={{ height: 480 }} /></div>;
  return (
    <>
      <SourceNote source={r.source} what="演示回放" />
      {clip ? (
        <>
          <div className="wrap"><div className="notice mt-24"><span>单场回放 · 第 {clip.day} 天 · {clip.card}「{clip.name}」</span><Link className="btn btn--sm" href={`/cycle/${encodeURIComponent(r.data.id)}/replay`} onClick={() => setVenue(null)}>回看整场</Link><Link className="btn btn--sm" href="/cycle">返回本轮</Link></div></div>
          <Player key={`${r.data.id}:${venue}`} events={r.data.events} myAgentIds={mine} startAt={clip.startAt} stopAt={clip.stopAt} pinVenue={venue!} autoplay title={`${r.data.id.toUpperCase()} · ${clip.card} 单场回放`} />
        </>
      ) : <ReplayView key={r.data.id} replay={r.data} myAgentIds={mine} />}
    </>
  );
}
