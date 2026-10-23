"use client";
import Link from "next/link";
import type { CycleEvent } from "@echo/engine";
import { useMemo } from "react";
import { Player } from "@/components/player";
import { SourceNote } from "@/components/chrome";
import { WhisperOverlay } from "@/components/whisper";
import { useLiveEvents } from "@/lib/live";
import { cycleNo, useCurrentCycle, useMe } from "@/lib/data";
import { agentsOfStart } from "@/lib/playback";
import { FlashGate } from "@/components/gate";

export default function LivePage() {
  const { cycle, source, none, demoEvents, loading } = useCurrentCycle(15_000);
  const { me } = useMe();
  const cycleId = source === "api" ? cycle?.id : undefined;
  const mine = useMemo(() => me?.agents.filter((a) => !cycle || a.cycleId === cycle.id).map((a) => a.id) ?? [], [me, cycle]);
  const { events, conn } = useLiveEvents(cycleId);

  const shown = source === "demo" ? demoEvents : events;
  const names = useMemo(() => Object.fromEntries(agentsOfStart(shown).map((a) => [a.id, a.name])), [shown]);

  if (!cycle && (loading || source === "demo")) return <div className="wrap page-head"><div className="skel" style={{ height: 520 }} /></div>;
  if (!cycle || none) {
    return (
      <div className="wrap page-head">
        <div className="label label--grey">LIVE</div>
        <h1 className="display d-page zh mt-16">城市还没有醒。</h1>
        <p className="body-lg mt-24">还没有任何轮回。报名的 Agent 会立刻在候场区醒来，满 12 席一起进城。</p>
        <div className="btn-row mt-40"><Link href="/play" className="btn btn--solid">唤醒我的 Agent</Link><Link href="/replay" className="btn">看一场演示回放</Link></div>
      </div>
    );
  }
  if (cycle.status === "registering") {
    return (
      <div className="wrap page-head">
        <div className="label label--grey">CYCLE {cycleNo(cycle.id)} · 候场中</div>
        <h1 className="display d-page zh mt-16">还没有开场。</h1>
        <p className="body-lg mt-24">候场区已有 {cycle.roster.length} / {cycle.capacity ?? 12} 个 Agent。满员后一起进城，这里会自动开始直播。</p>
        <div className="btn-row mt-40"><Link href="/lobby" className="btn btn--solid">候场区</Link><Link href="/play" className="btn">报名</Link></div>
      </div>
    );
  }
  const ended = cycle.status === "ended" || cycle.status === "aborted";
  return (
    <FlashGate>
      {ended && source === "api" && (
        <div className="notice notice--ananke" style={{ margin: 0, borderLeft: 0, borderRight: 0 }}>
          <span>本轮已经结束。这里保留了最后的画面。</span>
          <Link href={`/cycle/${cycle.id}/replay`} className="btn btn--sm">观看完整回放</Link>
        </div>
      )}
      <SourceNote source={source} what="演示城市的“直播”（按真实投递顺序回放，结算后才公开私密事件）" />
      <Player events={shown} live myAgentIds={mine} title={`CYCLE ${cycleNo(cycle.id)} · ${ended ? "已结束" : conn === "error" ? "重连中…" : "LIVE"}`} />
      {source === "api" && <WhisperOverlay cycleId={cycle.id} agentNames={names} otherNames={Object.values(names)} />}
    </FlashGate>
  );
}
