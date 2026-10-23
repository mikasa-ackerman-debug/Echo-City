"use client";
import { advance, buildObservation, createCycle, diagnose, npcHint, summarize, validateWhisper, type CycleEvent, type CycleState } from "@echo/engine";
import { decideRule, PERSONAS, personaProfile, type Persona } from "@echo/agents/bots";
import { create } from "zustand";
import { deriveLadderLive } from "./ladder-live";
import { releaseOrder, releasedAt } from "./playback";
import type { CycleView, LadderRow, LobbyView, MeResponse, PublicAgent, ReplayDoc } from "./types";

/**
 * 全局模拟 — a whole city run by the real engine inside this browser (no API server needed, works on Vercel).
 * You create one agent through the normal wizard, house bots fill the other 11 seats, and the cycle plays out on
 * a compressed clock. While it is on, every page (本轮 / 候场区 / 观战 / 状态栏 / 我的) reads this city instead of
 * the public one. 还原 throws it away. Only the config is persisted; the city is replayed deterministically from
 * its seed (plus the whispers you wrote), so a page reload picks up where it was.
 */

export const SIM_ID = "sim-local";
const KEY = "echo.sim.local";
/** sha256("stepfun"). A demo gate, not a security boundary: everything runs client-side. */
const PASS_HASH = "2c348893efb2316e5f1753dd68e3da88bce6847ff8c7b6ea083fe1fd46d7061a";
const MY_ID = "sim-me";
const BOT_NAMES = ["Basil", "Halo", "Iris", "Juno", "Kite", "Lark", "Vex", "Wren", "Yara", "Zed", "Onyx"];
const PERSONA_IDS = Object.keys(PERSONAS) as Persona[];

export const SIM_SPEEDS = [
  { v: 120, label: "极速", hint: "约 1 分钟跑完一局" },
  { v: 40, label: "标准", hint: "约 3 分钟跑完一局" },
  { v: 15, label: "从容", hint: "约 7 分钟跑完一局" },
];

export interface SimAgent { name: string; persona: Persona; strategy: string; host: { name: string; relation: string; memories: string[]; belief: string } }
export interface SimConfig {
  seed: string;
  /** events released per second */
  rate: number;
  createdAt: number;
  agent?: SimAgent;
  startedAt?: number;
  /** whisper label → text (already handed over), and the one waiting for the next window */
  whispers: Record<string, string>;
  pending?: string;
}

interface SimStore {
  cfg: SimConfig | null;
  visible: CycleEvent[];
  cycle: CycleView | null;
  done: boolean;
  credits: number;
}

export const useSim = create<SimStore>(() => ({ cfg: null, visible: [], cycle: null, done: false, credits: 0 }));

/* ---------------- persistence ---------------- */

function load(): SimConfig | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
}
function save(cfg: SimConfig | null) {
  if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg)); else localStorage.removeItem(KEY);
  rt = null;
  useSim.setState({ cfg });
  refresh();
  ensureTimer();
  window.dispatchEvent(new Event("echo:auth"));
}

export async function checkSimPassword(pw: string): Promise<boolean> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw.trim()));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("") === PASS_HASH;
}

/* ---------------- lifecycle ---------------- */

export function simOpen(rate: number) {
  save({ seed: Math.random().toString(36).slice(2, 10), rate, createdAt: Date.now(), whispers: {} });
}
export function simRegister(agent: SimAgent) {
  const cfg = useSim.getState().cfg;
  if (!cfg) throw new Error("全局模拟没有开启");
  if (cfg.startedAt) throw new Error("模拟城市已经开城");
  save({ ...cfg, agent });
}
export function simWithdraw() {
  const cfg = useSim.getState().cfg;
  if (cfg && !cfg.startedAt) save({ ...cfg, agent: undefined });
}
export function simStart() {
  const cfg = useSim.getState().cfg;
  if (!cfg?.agent) throw new Error("先创建你的 Agent");
  save({ ...cfg, startedAt: Date.now() });
}
export function simStop() { save(null); }

export function simWhisper(text: string): string | null {
  const cfg = useSim.getState().cfg;
  if (!cfg || !rt) return "模拟城市还没有开城";
  if (cfg.pending) return "上一句低语还没送到，它会在下一场之前听见";
  if ((rt.state.agents[MY_ID]?.whisperCredits ?? 0) <= 0) return "还没有可用的低语：它每在一个花色上走过 4 张牌，你才能说一句";
  const v = validateWhisper(text, rt.state);
  if (!v.ok) return v.reason;
  save({ ...cfg, pending: v.text });
  return null;
}

/* ---------------- the engine, live ---------------- */

interface Runtime { key: string; state: CycleState; events: CycleEvent[]; input: Parameters<typeof advance>[1]; done: boolean; personas: Record<string, Persona> }
let rt: Runtime | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function boot(cfg: SimConfig): Runtime {
  const a = cfg.agent!;
  const personas: Record<string, Persona> = { [MY_ID]: a.persona };
  const roster = [
    { id: MY_ID, name: a.name, host: a.host, kind: `bot:${a.persona}`, profile: personaProfile(a.persona) },
    ...BOT_NAMES.filter((n) => n !== a.name).slice(0, 11).map((name, i) => {
      const p = PERSONA_IDS[(i * 5 + cfg.seed.length) % PERSONA_IDS.length];
      personas[`sim-bot-${i}`] = p;
      return { id: `sim-bot-${i}`, name, host: { name: "常驻", relation: "常驻 Bot", memories: ["城里总要有人陪着。"], belief: PERSONAS[p].motto }, kind: `bot:${p}`, profile: personaProfile(p) };
    }),
  ];
  const state = createCycle({ id: SIM_ID, seed: cfg.seed, roster, config: { mode: "ladder", slotsPerDay: 8 } });
  return { key: `${cfg.seed}:${cfg.startedAt}`, state, events: [], input: {}, done: false, personas };
}

/** Advance the engine until at least `target` events exist (or the city is over). */
function pump(cfg: SimConfig, target: number) {
  if (!rt || rt.key !== `${cfg.seed}:${cfg.startedAt}`) rt = boot(cfg);
  const r = rt;
  let changed = false;
  for (let guard = 0; guard < 50000 && !r.done && r.events.length < target; guard++) {
    const out = advance(r.state, r.input);
    r.state = out.state;
    r.events.push(...out.events);
    const w = r.state.waiting;
    if (w.kind === "done") { r.done = true; break; }
    if (w.kind === "host") {
      let text = cfg.whispers[w.label];
      if (text === undefined && cfg.pending && w.agents.includes(MY_ID)) {
        text = cfg.pending;
        cfg = { ...cfg, whispers: { ...cfg.whispers, [w.label]: text }, pending: undefined };
        changed = true;
      }
      r.input = { whispers: text && w.agents.includes(MY_ID) ? { [MY_ID]: text } : {} };
      continue;
    }
    if (w.kind === "agents") {
      const responses: Record<string, ReturnType<typeof decideRule>> = {};
      for (const q of w.requests) responses[q.agentId] = decideRule(r.personas[q.agentId] ?? "guardian", buildObservation(r.state, q.agentId, 5000), { oracle: npcHint(r.state, q.agentId) });
      r.input = { responses };
      continue;
    }
    r.input = {};
  }
  if (changed) { localStorage.setItem(KEY, JSON.stringify(cfg)); useSim.setState({ cfg }); }
}

function refresh() {
  const cfg = useSim.getState().cfg;
  if (!cfg) { useSim.setState({ visible: [], cycle: null, done: false, credits: 0 }); return; }
  if (!cfg.startedAt) { useSim.setState({ visible: [], cycle: lobbyCycle(cfg), done: false, credits: 0 }); return; }
  const target = Math.floor(((Date.now() - cfg.startedAt) / 1000) * cfg.rate) + 1;
  pump(cfg, target);
  const r = rt!;
  const n = Math.min(target, r.events.length);
  const headSeq = r.events[n - 1]?.seq ?? 0;
  const over = r.done && n >= r.events.length;
  const visible = over ? r.events : releasedAt(releaseOrder(r.events.slice(0, n), [MY_ID]), headSeq);
  const prev = useSim.getState();
  if (prev.visible.length === visible.length && prev.done === over) return;
  useSim.setState({ visible, done: over, cycle: runningCycle(cfg, visible, r.state, over), credits: r.state.agents[MY_ID]?.whisperCredits ?? 0 });
}

function ensureTimer() {
  const cfg = useSim.getState().cfg;
  const want = !!cfg?.startedAt && !useSim.getState().done;
  if (want && !timer) timer = setInterval(() => { refresh(); if (useSim.getState().done) ensureTimer(); }, 400);
  if (!want && timer) { clearInterval(timer); timer = null; }
}

if (typeof window !== "undefined") {
  const cfg = load();
  if (cfg) { useSim.setState({ cfg }); setTimeout(() => { refresh(); ensureTimer(); }, 0); }
}

/* ---------------- views for the rest of the site ---------------- */

const baseCycle = (cfg: SimConfig): CycleView => ({
  id: SIM_ID, status: "registering", mode: "daily", rules: "ladder", capacity: 12, startsAt: new Date(cfg.createdAt).toISOString(), createdAt: new Date(cfg.createdAt).toISOString(),
  fillBots: 12, trialLength: "standard", agentIds: cfg.agent ? [MY_ID] : [],
  roster: cfg.agent ? [{ id: MY_ID, name: cfg.agent.name, mode: "bot", status: "registered", returned: false, host: cfg.agent.host.name, generation: 1 }] : [],
  live: null, whisper: { open: false, serverNow: new Date().toISOString() },
});

function lobbyCycle(cfg: SimConfig): CycleView { return baseCycle(cfg); }

function runningCycle(cfg: SimConfig, visible: CycleEvent[], state: CycleState, over: boolean): CycleView {
  const live = deriveLadderLive(visible);
  const alive = live.agents.filter((a) => a.status === "alive").length;
  const board: LadderRow[] = live.agents.map((a) => ({ name: a.name, status: a.status, ladder: a.ladder as LadderRow["ladder"], total: a.total }));
  const last = visible[visible.length - 1];
  return {
    ...baseCycle(cfg),
    status: over ? "ended" : "running",
    startsAt: new Date(cfg.startedAt!).toISOString(),
    endedAt: over ? new Date().toISOString() : undefined,
    summary: over ? summarize(state) : undefined,
    agentIds: live.agents.map((a) => a.id),
    roster: live.agents.map((a) => ({ id: a.id, name: a.name, mode: "bot", status: a.status, returned: false, host: a.host, generation: 1 })),
    live: over ? null : { night: live.day, phase: last?.phase ?? "day", stage: last?.phase ?? "day", alive, total: live.agents.length, venues: [], trials: live.tables.filter((t) => t.day === live.day && t.slot === live.slot).map((t) => ({ venue: t.id, card: t.card, players: t.players.length, done: t.ended })), rules: "ladder", slot: live.slot, slotsPerDay: live.slotsPerDay, board },
  };
}

export function simLobby(cfg: SimConfig): LobbyView {
  return {
    id: SIM_ID, status: cfg.startedAt ? "running" : "registering", capacity: 12, seated: cfg.agent ? 1 : 0, fillAt: null,
    agents: cfg.agent ? [{ id: MY_ID, name: cfg.agent.name, mode: "bot", kind: `bot:${cfg.agent.persona}`, profile: personaProfile(cfg.agent.persona), createdAt: new Date(cfg.createdAt).toISOString(), warmup: null }] : [],
  };
}

export function simAgent(cfg: SimConfig, cycle: CycleView | null): PublicAgent | null {
  if (!cfg.agent) return null;
  const st = cycle?.roster.find((r) => r.id === MY_ID)?.status ?? "registered";
  return { id: MY_ID, name: cfg.agent.name, cycleId: SIM_ID, lineageId: "sim-lineage", mode: "bot", status: st, returned: false, persona: cfg.agent.persona, strategy: cfg.agent.strategy, createdAt: new Date(cfg.createdAt).toISOString() };
}

export function simMe(cfg: SimConfig, cycle: CycleView | null): MeResponse {
  const a = simAgent(cfg, cycle);
  return { user: { id: "sim-user", name: "模拟宿主" }, lineages: [], agents: a ? [a] : [] };
}

export function simReplay(): ReplayDoc | null {
  const cfg = useSim.getState().cfg;
  if (!cfg?.startedAt || !rt) return null;
  const s = rt.state;
  return {
    format: "echo-replay/1", id: SIM_ID, seed: cfg.seed, createdAt: new Date(cfg.startedAt).toISOString(), districts: s.districts, map: s.map, amendment: s.amendment,
    agents: s.order.map((id) => { const a = s.agents[id]; return { id, name: a.name, kind: a.kind ?? null, host: { name: a.host.name, relation: a.host.relation, belief: a.host.belief }, generation: a.lineage.generation, status: a.status, diagnosis: diagnose(a) }; }),
    events: useSim.getState().visible,
    summary: summarize(s),
  };
}

/** Local connection test: the rule bot answers a real observation from a throwaway city. */
export function simTest(persona: Persona): { ok: boolean; ms: number; response: unknown } {
  const t = performance.now();
  const roster = [0, 1].map((i) => ({ id: `t${i}`, name: `T${i}`, host: { name: "h", relation: "r", memories: ["m"], belief: "b" } }));
  let s = createCycle({ id: "sim-test", seed: "t", roster, config: { mode: "ladder", slotsPerDay: 8 } });
  for (let i = 0; i < 20 && s.waiting.kind !== "agents"; i++) s = advance(s, {}).state;
  const response = s.waiting.kind === "agents" ? decideRule(persona, buildObservation(s, "t0", 5000)) : { action: { type: "rest" } };
  return { ok: true, ms: Math.round(performance.now() - t), response };
}
