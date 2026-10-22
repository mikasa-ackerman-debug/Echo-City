"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { CycleView, LineageGeneration, MeResponse, PublicAgent, TombstoneDTO } from "./types";

/**
 * myAgentState (FRONTEND §9): one global state that drives the home hero,
 * the status bar and the main call-to-action. Every visit opens on *your* story.
 */
export type MyAgentKind = "guest" | "no_lineage" | "registered" | "alive" | "just_deleted" | "deleted_waiting" | "ascended" | "returned";

export interface MyAgentState {
  kind: MyAgentKind;
  agent?: PublicAgent;
  generation?: LineageGeneration;
  hostName?: string;
  tomb?: TombstoneDTO;
  /** epoch ms when the 24h letter window closes */
  letterDeadline?: number;
  cta: { label: string; href: string };
}

const LETTER_WINDOW = 24 * 3600_000;

export function deriveMyAgent(me: MeResponse | null, cycle: CycleView | null, tomb?: TombstoneDTO | null, now = Date.now()): MyAgentState {
  if (!me) return { kind: "guest", cta: { label: "唤醒我的 Agent", href: "/play" } };
  if (!me.lineages.length) return { kind: "no_lineage", cta: { label: "唤醒我的 Agent", href: "/play" } };
  const agents = [...me.agents].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const hostOf = (lineageId?: string) => me.lineages.find((l) => l.id === lineageId)?.host.name;

  const alive = agents.find((a) => a.status === "alive");
  if (alive) return { kind: "alive", agent: alive, hostName: hostOf(alive.lineageId), cta: { label: "进入直播", href: "/cycle/live" } };
  const registered = agents.find((a) => a.status === "registered" && (!cycle || cycle.id === a.cycleId || cycle.status === "registering"));
  if (registered) return { kind: "registered", agent: registered, hostName: hostOf(registered.lineageId), cta: { label: "修改策略", href: "/play" } };

  const latest = agents[0];
  const gen = latest ? me.lineages.flatMap((l) => l.generations).find((g) => g.agentId === latest.id) : undefined;
  if (latest?.status === "deleted") {
    const at = tomb?.deletedAt ? Date.parse(tomb.deletedAt) : NaN;
    if (Number.isFinite(at) && now - at < LETTER_WINDOW && !tomb?.letter) {
      return { kind: "just_deleted", agent: latest, generation: gen, tomb: tomb ?? undefined, hostName: hostOf(latest.lineageId), letterDeadline: at + LETTER_WINDOW, cta: { label: "写遗书", href: `/me/agent/${latest.id}` } };
    }
    return { kind: "deleted_waiting", agent: latest, generation: gen, tomb: tomb ?? undefined, hostName: hostOf(latest.lineageId), cta: { label: "唤醒下一代", href: "/play" } };
  }
  if (latest?.status === "ascended") return { kind: "ascended", agent: latest, generation: gen, hostName: hostOf(latest.lineageId), cta: { label: "唤醒下一代", href: "/play" } };
  if (latest?.status === "returned") return { kind: "returned", agent: latest, generation: gen, hostName: hostOf(latest.lineageId), cta: { label: "直接报名", href: "/play" } };
  return { kind: "deleted_waiting", agent: latest, generation: gen, hostName: hostOf(latest?.lineageId), cta: { label: "唤醒下一代", href: "/play" } };
}

/** Hook form: also fetches the latest tombstone for the 24h letter window. */
export function useMyAgent(me: MeResponse | null, cycle: CycleView | null): MyAgentState {
  const latestDeleted = useMemo(() => me?.agents.filter((a) => a.status === "deleted").sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]?.id, [me]);
  const [tomb, setTomb] = useState<TombstoneDTO | null>(null);
  useEffect(() => {
    if (!latestDeleted) { setTomb(null); return; }
    let alive = true;
    api<TombstoneDTO>(`/api/tombstones/${latestDeleted}`, { auth: false }).then((t) => alive && setTomb(t)).catch(() => {});
    return () => { alive = false; };
  }, [latestDeleted]);
  return useMemo(() => deriveMyAgent(me, cycle, tomb), [me, cycle, tomb]);
}

export const FATE_GLYPH: Record<string, string> = { deleted: "✝", ascended: "★", returned: "⟲", archived: "○", alive: "⏳", registered: "◌" };
export const FATE_ZH: Record<string, string> = { deleted: "已删除", ascended: "并入", returned: "归来", archived: "存档", alive: "存活", registered: "已报名" };
