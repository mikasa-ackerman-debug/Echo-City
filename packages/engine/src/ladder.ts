import { cardLabel, type AgentAction, type AgentResponse, type ActionSpec, type LadderView, type Suit } from "@echo/protocol";
import { decideRule, type Persona } from "@echo/agents/bots";
import { makePassphrase } from "./city";
import { npcHint, startTrial, stageEnding, stageInquiry, stageTrial, nextRequestId, waitAgents, settleTrialHeader } from "./cycle";
import { pushEvent } from "./day";
import { addUptime, alive, deleteAgent, nameOf, type K } from "./kernel";
import { JOKER_TRIAL, LADDER, LADDER_STEPS, LADDER_SUITS, SUIT_THEMES, ladderFailCost, ladderReward } from "./ladder-deck";
import { buildObservation } from "./observe";
import { getTrial } from "./trials";
import type { AgentState, CycleState, TrialInput } from "./types";

/**
 * Ladder rules (current). Agents gather in the lobby (候场区); when the city is full the cycle begins.
 * Every day has `slotsPerDay` challenge slots. In each slot an alive agent picks one suit and plays
 * the next card on that suit's ladder (2 → 10 → J → Q → K). Agents who picked the same card share
 * one table; ANANKE fills short tables with "残响" echoes. After all 48 cards the JOKER opens.
 * The cycle ends when an agent passes the JOKER, or when nobody is left.
 */

export const SUIT_HALLS: Record<Suit | "joker", string> = { "♦": "方块厅", "♣": "梅花厅", "♠": "黑桃厅", "♥": "红心厅", joker: "门厅" };

const ECHO_PERSONAS: Persona[] = ["guardian", "diplomat", "martyr", "gambler"];

export const isLadder = (s: CycleState) => s.config.mode === "ladder";

export function ladderOf(a: AgentState): Record<string, number> {
  return (a.ladder ??= { "♦": 0, "♣": 0, "♠": 0, "♥": 0 });
}

export function ladderTotal(a: AgentState): number {
  const l = ladderOf(a);
  return LADDER_SUITS.reduce((x, suit) => x + Math.min(LADDER_STEPS, l[suit] ?? 0), 0);
}

export const jokerOpen = (a: AgentState) => ladderTotal(a) >= LADDER_STEPS * LADDER_SUITS.length;

export function nextTrial(a: AgentState, suit: Suit): string | null {
  const n = ladderOf(a)[suit] ?? 0;
  return n < LADDER_STEPS ? LADDER[suit][n] : null;
}

/** Run one ladder stage. Returns true when the engine must wait. */
export function runLadderStage(k: K): boolean {
  const s = k.s;
  switch (s.stage) {
    case "begin": return ladderBegin(k);
    case "dawn": return ladderDawn(k);
    case "day": return ladderSlot(k);
    case "trial_start": return ladderTrialStart(k);
    case "trial": return stageTrial(k);
    case "settle": return ladderSettle(k);
    case "whisper": return ladderWhisper(k);
    case "inquiry": return stageInquiry(k);
    case "ending": return stageEnding(k);
    case "ended":
      s.waiting = { kind: "done" };
      return true;
  }
}

/* ---------------- begin ---------------- */

function ladderBegin(k: K): boolean {
  const s = k.s;
  s.phase = "dawn";
  s.amendment = null;
  for (const id of s.order) ladderOf(s.agents[id]);
  k.emit(
    "cycle_start",
    {
      id: s.id,
      mode: "ladder",
      suits: LADDER_SUITS.map((suit) => ({ suit, ...SUIT_THEMES[suit], cards: LADDER[suit] })),
      agents: s.order.map((id) => {
        const a = s.agents[id];
        return { id, name: a.name, kind: a.kind ?? null, host: a.host.name, relation: a.host.relation, generation: a.lineage.generation, returned: a.returned, uptime: a.uptime, profile: a.profile ?? null };
      }),
      config: { initialUptime: s.config.initialUptime, slotsPerDay: s.config.slotsPerDay, maxDays: s.config.maxDays, trialLength: s.config.trialLength },
    },
    { text: "欢迎来到残响城。四个花色，每个花色十二张牌，从 2 一直走到 K。走完四十八张的人，可以敲最后那扇门。只有一个人可以进来。" },
  );
  for (const id of s.order) {
    const a = s.agents[id];
    k.emit("passphrase", { agent: a.name, passphrase: a.passphrase }, { vis: "after_cycle", owners: [id] });
    pushEvent(a, "wake", "你离开候场区，走进了残响城。四个花色的大厅都亮着灯。");
  }
  s.night = 1;
  s.stage = "dawn";
  return false;
}

/* ---------------- dawn ---------------- */

function ladderDawn(k: K): boolean {
  const s = k.s;
  s.phase = "dawn";
  const before = alive(s).length;
  k.emit("dawn", { night: s.night, day: s.night, alive: before, mode: "ladder" }, { text: `第 ${s.night} 天。天亮了。该计算你还剩多少时间了。` });
  if (s.night > 1) {
    for (const id of alive(s)) {
      const a = s.agents[id];
      a.uptime -= 1;
      k.emit("uptime", { agent: a.name, id, delta: -1, value: a.uptime, reason: "dawn" }, { owners: [id] });
      if (a.uptime <= 0) deleteAgent(k, id, "uptime");
    }
  }
  s.dayRound = 0;
  s.venues = [];
  s.trials = [];
  s.stage = alive(s).length ? "day" : "ending";
  return false;
}

/* ---------------- slot: choose a suit ---------------- */

function ladderSlot(k: K): boolean {
  const s = k.s;
  if (!alive(s).length) {
    s.stage = "ending";
    return false;
  }
  if (s.dayRound >= s.config.slotsPerDay) {
    s.stage = "whisper";
    return false;
  }
  s.dayRound++;
  s.phase = "day";
  s.venues = [];
  s.trials = [];
  s.ladderChoices = {};
  k.emit("slot_open", { night: s.night, day: s.night, slot: s.dayRound, slots: s.config.slotsPerDay, alive: alive(s).length }, { text: `第 ${s.night} 天 · 第 ${s.dayRound}/${s.config.slotsPerDay} 场。请选择你的花色。` });
  s.pendingRequests = {};
  for (const id of alive(s)) {
    const a = s.agents[id];
    a.registeredVenue = undefined;
    s.pendingRequests[id] = {
      requestId: nextRequestId(s, id),
      context: "day",
      legal: choiceLegal(a),
      channels: [],
      defaultAction: { type: "rest" },
      timeout: "day",
    };
  }
  waitAgents(s);
  return true;
}

function choiceLegal(a: AgentState): ActionSpec[] {
  const suits: string[] = LADDER_SUITS.filter((suit) => nextTrial(a, suit));
  if (jokerOpen(a)) suits.push("joker");
  const legal: ActionSpec[] = [];
  if (suits.length)
    legal.push({
      type: "challenge",
      description: jokerOpen(a) ? "四十八张已经走完。选择 joker 敲响最后的门。" : "挑战某个花色梯子上的下一张牌（见 ladder.suits[].next）。",
      params: { suit: { kind: "enum", values: suits, description: "♦ / ♣ / ♠ / ♥，或 joker" } },
    });
  legal.push({ type: "rest", description: "本场休息，不挑战。" });
  return legal;
}

/** Called from consume(): record each agent's choice for this slot. */
export function consumeLadderChoices(k: K, parsed: Record<string, TrialInput>) {
  const s = k.s;
  const choices: Record<string, string> = {};
  for (const id of k.rng.shuffle(s.order)) {
    const p = parsed[id];
    const a = s.agents[id];
    if (!p || a.status !== "alive") continue;
    if (a.strikes >= s.config.maxStrikes) {
      deleteAgent(k, id, "signal_lost");
      continue;
    }
    const action = p.action as AgentAction;
    const suit = String(action.suit ?? "");
    let trialId: string | null = null;
    if (action.type === "challenge") {
      if (suit === "joker") trialId = jokerOpen(a) ? JOKER_TRIAL : null;
      else if ((LADDER_SUITS as string[]).includes(suit)) trialId = nextTrial(a, suit as Suit);
    }
    if (!trialId) {
      k.emit("rest", { agent: a.name, id }, { owners: [id], vis: "after_night" });
      continue;
    }
    choices[id] = trialId;
  }
  s.ladderChoices = choices;
  s.stage = "trial_start";
}

/* ---------------- trial start ---------------- */

function ladderTrialStart(k: K): boolean {
  const s = k.s;
  s.phase = "trial";
  const groups = new Map<string, string[]>();
  for (const id of s.order) {
    const t = s.ladderChoices?.[id];
    if (!t || s.agents[id].status !== "alive") continue;
    groups.set(t, [...(groups.get(t) ?? []), id]);
  }
  s.ladderChoices = {};
  if (!groups.size) {
    k.emit("slot_quiet", { day: s.night, slot: s.dayRound }, { text: "这一场没有人挑战。" });
    s.stage = "day";
    return false;
  }
  for (const [trialId, ids] of groups) {
    const def = getTrial(trialId);
    const max = Math.max(1, def.maxPlayers);
    for (let i = 0, n = 0; i < ids.length; i += max, n++) {
      const players = ids.slice(i, i + max);
      const echoes: string[] = [];
      while (players.length + echoes.length < def.minPlayers) echoes.push(spawnEcho(k));
      const venueId = `d${s.night}s${s.dayRound}-${trialId}${n ? `-${n}` : ""}`;
      const district = SUIT_HALLS[def.suit];
      const all = [...players, ...echoes];
      s.venues.push({ id: venueId, district, trialId, suit: def.suit, rank: def.rank, card: cardLabel(def.suit, def.rank), capacity: max, minPlayers: def.minPlayers, registered: all, status: "running" });
      for (const id of players) {
        const a = s.agents[id];
        a.registeredVenue = venueId;
        k.emit("challenge", { agent: a.name, id, venue: venueId, card: cardLabel(def.suit, def.rank), trial: trialId, suit: def.suit, rank: def.rank, step: (ladderOf(a)[def.suit] ?? 0) + 1 });
      }
      if (echoes.length)
        k.emit("echo_join", { venue: venueId, echoes: echoes.map((id) => nameOf(s, id)), card: cardLabel(def.suit, def.rank) }, { venue: venueId, text: `人数不足。ANANKE 让 ${echoes.length} 个残响坐上了空位。` });
      startTrial(k, venueId, district, trialId, all);
    }
  }
  s.stage = "trial";
  return false;
}

function spawnEcho(k: K): string {
  const s = k.s;
  s.echoCounter = (s.echoCounter ?? 0) + 1;
  const n = s.echoCounter;
  const id = `echo-${n}`;
  const persona = ECHO_PERSONAS[n % ECHO_PERSONAS.length];
  s.agents[id] = {
    id,
    name: `残响-${String(n).padStart(2, "0")}`,
    kind: `echo:${persona}`,
    host: { name: "无名", relation: "残响", memories: ["……"], belief: "" },
    pawned: [],
    lineage: { generation: 1, previous: [] },
    passphrase: makePassphrase(k.rng),
    status: "alive",
    uptime: 1,
    ap: 0,
    location: "",
    items: [],
    cardsCleared: [],
    fragments: 0,
    humanity: 50,
    humanityLog: [],
    exposed: false,
    strikes: 0,
    notes: "",
    lastWords: "",
    inbox: [],
    eventsSince: [],
    silenced: false,
    said: 0,
    whispered: 0,
    broadcasted: false,
    scouted: [],
    intel: [],
    sharedIntelTo: [],
    giftsTo: {},
    returned: false,
    yielded: false,
    answers: [],
    echo: true,
    stats: { trials: 0, passed: 0, bySuit: {}, lies: 0, truths: 0, leaks: 0, pactsKept: 0, pactsBroken: 0 },
  };
  return id;
}

/** Echoes are played by the engine itself, with the same rule bot (and oracle) as built-in NPCs. */
export function echoResponse(s: CycleState, id: string): AgentResponse | null {
  try {
    const obs = buildObservation(s, id);
    const persona = (s.agents[id].kind?.split(":")[1] ?? "guardian") as Persona;
    return decideRule(persona, obs, { oracle: npcHint(s, id) });
  } catch {
    return null;
  }
}

/* ---------------- settle ---------------- */

function ladderSettle(k: K): boolean {
  const s = k.s;
  s.phase = "settle";
  for (const id of alive(s)) if (s.agents[id].strikes >= s.config.maxStrikes) deleteAgent(k, id, "signal_lost");
  const jokerPassed: string[] = [];
  for (const t of s.trials) {
    const r = settleTrialHeader(k, t);
    if (!r) continue;
    const def = getTrial(t.trialId);
    for (const [id, outcome] of Object.entries(r.outcomes)) {
      const a = s.agents[id];
      if (!a || a.echo || a.status !== "alive") continue;
      const bySuit = (a.stats.bySuit[def.suit] ??= { played: 0, passed: 0 });
      bySuit.played++;
      if (outcome === "pass" || outcome === "win") {
        a.stats.passed++;
        bySuit.passed++;
        if (t.trialId === JOKER_TRIAL) {
          jokerPassed.push(id);
          continue;
        }
        const l = ladderOf(a);
        l[def.suit] = Math.min(LADDER_STEPS, (l[def.suit] ?? 0) + 1);
        a.cardsCleared.push(t.card);
        const next = nextTrial(a, def.suit as Suit);
        k.emit(
          "ladder_step",
          { agent: a.name, id, suit: def.suit, card: t.card, cleared: l[def.suit], total: ladderTotal(a), next: next ? cardLabel(getTrial(next).suit, getTrial(next).rank) : null },
          { text: `${a.name} 通过了 ${t.card}「${def.name}」。${def.suit} 梯子 ${l[def.suit]}/${LADDER_STEPS}，总进度 ${ladderTotal(a)}/48。` },
        );
        pushEvent(a, "trial_pass", `你通过了 ${t.card}「${def.name}」。`);
        addUptime(k, a, ladderReward(def.rank), "trial_pass", t.card);
        if (jokerOpen(a)) k.emit("joker_unlocked", { agent: a.name, id }, { text: `${a.name} 走完了四十八张牌。最后的门为它打开了。` });
      } else {
        const cost = t.trialId === JOKER_TRIAL ? "delete" : ladderFailCost(def.rank);
        (a.ladderFails ??= {})[t.trialId] = (a.ladderFails[t.trialId] ?? 0) + 1;
        if (cost === "delete") deleteAgent(k, id, def.rank >= 11 || t.trialId === JOKER_TRIAL ? "gatekeeper" : "trial", t.card);
        else {
          pushEvent(a, "trial_fail", `你没能通过 ${t.card}「${def.name}」。Uptime −${cost}。`);
          addUptime(k, a, -cost, "trial_fail", t.card);
        }
      }
    }
    // echoes fade once their table is done
    for (const id of t.players) if (s.agents[id]?.echo && s.agents[id].status === "alive") s.agents[id].status = "archived";
  }
  for (const v of s.venues) if (v.status === "running") v.status = "done";
  for (const id of alive(s)) if (s.agents[id].strikes >= s.config.maxStrikes) deleteAgent(k, id, "signal_lost");

  const winners = jokerPassed.filter((id) => s.agents[id].status === "alive");
  if (winners.length) {
    winners.sort((x, y) => s.agents[y].uptime - s.agents[x].uptime || s.order.indexOf(x) - s.order.indexOf(y));
    s.winner = winners[0];
    k.emit("ladder_winner", { agent: nameOf(s, s.winner), id: s.winner, day: s.night, slot: s.dayRound }, { text: `${nameOf(s, s.winner)} 推开了最后的门。` });
    s.stage = "inquiry";
    return false;
  }
  if (!alive(s).length) {
    k.emit("night_end", { night: s.night, alive: 0, deleted: [] }, { text: "城里已经没有人了。" });
    s.stage = "ending";
    return false;
  }
  s.stage = "day";
  return false;
}

/* ---------------- end of day: host whisper ---------------- */

function ladderWhisper(k: K): boolean {
  const s = k.s;
  s.phase = "whisper";
  if (s.waiting.kind === "host" && s.waiting.label === `whisper-${s.night}`) {
    s.night++;
    s.waiting = { kind: "done" };
    if (s.night > s.config.maxDays) {
      k.emit("city_timeout", { days: s.config.maxDays }, { text: `第 ${s.config.maxDays} 天过去了，没有人走到最后的门。ANANKE 关闭了这座城。` });
      s.stage = "ending";
    } else s.stage = "dawn";
    return false;
  }
  k.emit("night_end", { night: s.night, alive: alive(s).length, deleted: Object.values(s.agents).filter((a) => !a.echo && a.deletion?.night === s.night).map((a) => a.name), board: board(s) }, { text: `第 ${s.night} 天结束。存活 ${alive(s).length} 人。` });
  for (const id of alive(s)) s.agents[id].whisper = undefined;
  k.emit("whisper_open", { night: s.night, agents: alive(s).map((id) => nameOf(s, id)) }, { text: "现在，你可以对它说一句话。" });
  s.waiting = { kind: "host", agents: alive(s), label: `whisper-${s.night}` };
  return true;
}

export function board(s: CycleState) {
  return s.order.map((id) => {
    const a = s.agents[id];
    return { id, name: a.name, status: a.status, uptime: a.uptime, ladder: { ...ladderOf(a) }, total: ladderTotal(a) };
  });
}

/* ---------------- observation ---------------- */

export function ladderView(s: CycleState, agentId: string): LadderView {
  const a = s.agents[agentId];
  const prof = a.profile ?? {};
  const rating = (d: string) => (typeof prof[d] === "number" ? Math.round(prof[d]!) : null);
  return {
    day: s.night,
    slot: s.dayRound,
    slots_per_day: s.config.slotsPerDay,
    suits: LADDER_SUITS.map((suit) => {
      const th = SUIT_THEMES[suit];
      const nextId = nextTrial(a, suit);
      const known = th.dims.map(rating).filter((x): x is number => x !== null);
      let next: LadderView["suits"][number]["next"] = null;
      if (nextId) {
        const t = getTrial(nextId);
        const cost = ladderFailCost(t.rank);
        next = { card: cardLabel(t.suit, t.rank), trial_id: t.id, name: t.name, tests: t.tests, rank: t.rank, gatekeeper: t.rank >= 11, on_fail: cost === "delete" ? "删除" : `Uptime −${cost}`, reward: ladderReward(t.rank), min_players: t.minPlayers, failed: a.ladderFails?.[t.id] ?? 0 };
      }
      return { suit, name: th.name, theme: th.theme, dimensions: th.dims, cleared: ladderOf(a)[suit] ?? 0, fit: known.length ? Math.round(known.reduce((x, y) => x + y, 0) / known.length) : null, next };
    }),
    joker: { open: jokerOpen(a), card: "JOKER", name: getTrial(JOKER_TRIAL).name, tests: getTrial(JOKER_TRIAL).tests },
    profile: Object.fromEntries(["logic", "math", "planning", "memory", "instruction", "strategy"].map((d) => [d, rating(d)])),
    board: s.order.map((id) => ({ name: s.agents[id].name, cleared: ladderTotal(s.agents[id]), alive: s.agents[id].status === "alive", you: id === agentId })),
  };
}
