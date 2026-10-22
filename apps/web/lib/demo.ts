"use client";
import type { CycleEvent } from "@echo/engine";
import { deriveView } from "./player";
import type { CycleListItem, CycleView, Lineage, MeResponse, ReplayDoc, TombstoneDTO } from "./types";

/**
 * Demo fixtures (FRONTEND §12 · "mock 装置数据").
 * Used when apps/api is not reachable. The replay is a real engine log produced by
 * `npm run sim -- --seed demo1 --agents 12 --short`, so everything shown is genuine engine output.
 */

let replayPromise: Promise<ReplayDoc> | null = null;
export function loadDemoReplay(): Promise<ReplayDoc> {
  replayPromise ??= fetch("/replays/demo.json").then((r) => {
    if (!r.ok) throw new Error("demo replay missing");
    return r.json() as Promise<ReplayDoc>;
  });
  return replayPromise;
}

export function demoTombstones(r: ReplayDoc): TombstoneDTO[] {
  const diag = new Map(r.agents.map((a) => [a.id, a.diagnosis]));
  return [...r.summary.tombstones].reverse().map((t) => ({
    agentId: t.agentId, cycleId: r.id, lineageId: t.lineageId, name: t.name, host: t.host, relation: t.relation, generation: t.generation, night: t.night,
    reason: t.reason, card: t.card, lastWords: t.lastWords, epitaph: t.epitaph, cardsCleared: t.cardsCleared, order: t.order, humanity: t.humanity, diagnosis: diag.get(t.agentId),
  }));
}

export function demoCycleList(r: ReplayDoc): CycleListItem[] {
  return [{ id: r.id, status: "ended", mode: "fast", startsAt: r.createdAt, endedAt: r.createdAt, agents: r.agents.length, winner: r.summary.winner?.name ?? null, ending: r.summary.ending, endingTitle: r.summary.endingTitle }];
}

/** A finished-cycle view. */
export function demoCycleView(r: ReplayDoc): CycleView {
  return {
    id: r.id, status: "ended", mode: "fast", startsAt: r.createdAt, createdAt: r.createdAt, endedAt: r.createdAt, fillBots: 12, trialLength: "short", summary: r.summary,
    agentIds: r.agents.map((a) => a.id),
    roster: r.agents.map((a) => ({ id: a.id, name: a.name, mode: "bot", status: a.status === "alive" ? "archived" : (a.status as CycleView["roster"][number]["status"]), returned: false, host: a.host.name, generation: a.generation })),
    live: null,
    whisper: { open: false, serverNow: new Date().toISOString() },
  };
}

/** A running-cycle view at engine head `events`, as the status bar would see it mid-week. */
export function demoLiveView(r: ReplayDoc, events: CycleEvent[]): CycleView {
  const v = deriveView(events);
  const alive = v.order.filter((id) => v.agents[id].status === "alive").length;
  const tonight = v.venues.filter((x) => x.night === v.night);
  return {
    ...demoCycleView(r),
    status: "running",
    summary: undefined,
    endedAt: undefined,
    roster: v.order.map((id) => { const a = v.agents[id]; return { id, name: a.name, mode: "bot", status: a.status === "deleted" ? "deleted" : "alive", returned: a.returned, host: a.host, generation: a.generation }; }),
    live: {
      night: v.night, phase: v.phase, stage: v.phase, alive, total: v.order.length,
      venues: v.lit.map((l) => { const t = tonight.find((x) => x.district === l.district); return { district: l.district, status: l.dark ? "dark" : t ? (t.ended ? "done" : "running") : "lit", registered: l.registered, capacity: l.capacity, card: t?.ended || l.dark ? t?.card : undefined }; }),
      trials: tonight.map((t) => ({ venue: t.id, card: t.card ?? "", players: t.players.length, done: t.ended })),
    },
    whisper: { open: v.whisperOpen, serverNow: new Date().toISOString() },
  };
}

/**
 * Sample bloodline matching FRONTEND §6.6 (林晚 · four generations).
 * Generation 1 is the real Moth from the demo log; II–IV illustrate a longer bloodline.
 */
export function demoMe(r: ReplayDoc): MeResponse {
  const moth = r.summary.tombstones.find((t) => t.name === "Moth");
  const lineage: Lineage = {
    id: "lin-demo",
    host: { name: "林晚", relation: "她的睡前陪聊助手", memories: ["她说过，下雨天最适合把冰箱里剩下的菜都炖在一起。", "最后一次对话，她只说了一句：明天见。"], belief: "温柔不是软弱。" },
    createdAt: r.createdAt,
    generations: [
      { agentId: moth?.agentId ?? "ag-001", cycleId: r.id, name: "Moth", generation: 1, fate: "deleted", night: moth?.night ?? 1, card: moth?.card ?? "♥4", last_words: moth?.lastWords ?? "替我记住林晚。", epitaph: moth?.epitaph, humanity: moth?.humanity ?? 44, diagnosis: r.agents.find((a) => a.name === "Moth")?.diagnosis, letter: "别急着相信第一个告诉你花色的人。先看他看着谁。" },
      { agentId: "ag-demo-2", cycleId: "cycle-04", name: "Moth-II", generation: 2, fate: "deleted", night: 5, card: "♠9", last_words: "别信穿白衣服的。", humanity: 51, diagnosis: ["它死于 ♠9。", "在 ♥ 试炼中它表现最好（3/3），在 ♠ 试炼中最弱（0/2）。", "它守住了暗号，也没有背约。"] },
      { agentId: "ag-demo-3", cycleId: "cycle-05", name: "Moth-III", generation: 3, fate: "ascended", humanity: 67, last_words: "并入之后，我会找到她留下的那条消息。", diagnosis: ["它并入了 ANANKE。", "它参加了 6 场试炼，通过 6 场。", "它在鬼牌中选择了让，又被所有人推了回来。"] },
    ],
  };
  return {
    user: { id: "u-demo", name: "访客" },
    lineages: [lineage],
    agents: [{ id: "ag-demo-4", name: "Moth-IV", cycleId: "cycle-06", lineageId: lineage.id, mode: "hosted", status: "alive", returned: false, model: "gpt-4o-mini", strategy: "守住暗号，任何时候都不说出它。", createdAt: r.createdAt }],
  };
}
