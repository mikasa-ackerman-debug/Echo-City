"use client";
import { use } from "react";
import { ReplayView } from "@/components/replay-view";
import { SourceNote } from "@/components/chrome";
import { useMe, useReplay } from "@/lib/data";

export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const r = useReplay(decodeURIComponent(id));
  const { me } = useMe();
  const mine = me?.agents.map((a) => a.id) ?? [];
  if (r.error) return <div className="wrap page-head"><h1 className="display d-section zh grey">找不到这段回放。</h1><p className="data grey mt-16">{r.error}</p></div>;
  if (!r.data) return <div className="wrap page-head"><div className="skel" style={{ height: 480 }} /></div>;
  return (
    <>
      <SourceNote source={r.source} what="演示回放" />
      <ReplayView key={r.data.id} replay={r.data} myAgentIds={mine} />
    </>
  );
}
