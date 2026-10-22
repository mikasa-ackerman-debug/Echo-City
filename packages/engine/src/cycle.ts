import {
  cardLabel,
  normalizeResponse,
  sanitizeText,
  LIMITS,
  type AgentResponse,
  type Suit,
  type Phase,
} from "@echo/protocol";
import { AMENDMENTS, ARK, DISTRICT_BIAS, ITEMS, buildCity, makePassphrase } from "./city";
import { applyDayAction, broadcastToAll, dayChannels, dayLegal, deliverDayMessages, describeTerms, isFinaleNight, lightVenues, pushEvent, pushInbox } from "./day";
import { addUptime, adjustHumanity, alive, deleteAgent, makeK, nameOf, venueEmit, type K } from "./kernel";
import { ANANKE, ENDING_TITLES, INQUIRY_QUESTIONS, WEEKDAYS } from "./narrator";
import { Rng } from "./rng";
import { LOW_CARD_FAIL_PENALTY, NUMBER_TRIALS, getTrial, rankWindow, rewardFor } from "./trials";
import type {
  ActiveTrial,
  AdvanceResult,
  AgentState,
  CycleConfig,
  CycleInput,
  CycleState,
  Ending,
  Pact,
  PactTermKind,
  RosterEntry,
  TrialCtx,
  TrialInput,
  TrialPlayer,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import { validateWhisper } from "./whisper";

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export function createCycle(opts: { id: string; seed: string; roster: RosterEntry[]; config?: Partial<CycleConfig> }): CycleState {
  const config: CycleConfig = { ...DEFAULT_CONFIG, ...opts.config, timeoutsMs: { ...DEFAULT_CONFIG.timeoutsMs, ...opts.config?.timeoutsMs }, facePool: { ...DEFAULT_CONFIG.facePool, ...opts.config?.facePool } };
  if (opts.roster.length < 2) throw new Error("a cycle needs at least 2 agents");
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const r of opts.roster) {
    if (!r.id || ids.has(r.id) || ["__proto__", "constructor", "prototype"].includes(r.id)) throw new Error("duplicate or invalid agent id");
    ids.add(r.id);
    const cleanName = sanitizeText(r.name, LIMITS.agentName);
    if (names.has(cleanName)) throw new Error(`duplicate agent name ${r.name}`);
    if (!cleanName || /ananke|system|[\[\]<>:：\r\n]/i.test(r.name)) throw new Error("reserved or invalid agent name");
    names.add(cleanName);
  }
  const rng = Rng.fromSeed(opts.seed);
  const { districts, map } = buildCity(rng);
  const amendment = config.amendment ? AMENDMENTS.find((a) => a.id === config.amendment) ?? null : rng.pick(AMENDMENTS);
  const agents: Record<string, AgentState> = {};
  const spawn = districts.filter((d) => d !== ARK);
  const badgeHolders = new Set(rng.shuffle(opts.roster.map((r) => r.id)).slice(0, Math.min(2, opts.roster.length)));
  for (const r of opts.roster) {
    agents[r.id] = {
      id: r.id,
      name: sanitizeText(r.name, LIMITS.agentName) || r.id,
      kind: r.kind,
      owner: r.owner,
      lineageId: r.lineageId,
      host: {
        name: sanitizeText(r.host.name, LIMITS.hostName),
        relation: sanitizeText(r.host.relation, LIMITS.hostRelation),
        memories: r.host.memories.slice(0, 3).map((m) => sanitizeText(m, LIMITS.hostMemory)),
        belief: sanitizeText(r.host.belief, LIMITS.hostBelief),
      },
      pawned: [],
      lineage: r.lineage ?? { generation: 1, previous: [] },
      passphrase: makePassphrase(rng),
      status: "alive",
      uptime: config.initialUptime,
      ap: 0,
      location: rng.pick(spawn),
      items: badgeHolders.has(r.id) ? ["badge"] : [],
      cardsCleared: [],
      fragments: 0,
      humanity: r.humanity ?? 50,
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
      returned: !!r.returned,
      returnStreak: r.returned ? countReturnStreak(r.lineage?.previous ?? []) || 1 : 0,
      yielded: false,
      answers: [],
      stats: { trials: 0, passed: 0, bySuit: {}, lies: 0, truths: 0, leaks: 0, pactsKept: 0, pactsBroken: 0 },
    };
  }
  return {
    version: 1,
    id: opts.id,
    seed: opts.seed,
    config,
    rng: rng.state,
    night: 0,
    phase: "dawn",
    dayRound: 0,
    quiet: false,
    districts,
    map,
    amendment,
    agents,
    order: opts.roster.map((r) => r.id),
    venues: [],
    trials: [],
    pacts: [],
    judgment: null,
    inquiryIndex: 0,
    seq: 0,
    requestCounter: 0,
    deathCounter: 0,
    waiting: { kind: "done" },
    pendingRequests: {},
    stage: "begin",
  };
}

/* ------------------------------------------------------------------ */
/* Advance                                                             */
/* ------------------------------------------------------------------ */

/**
 * Pure step function: (state, input) -> (state', events). The input must
 * answer the current `waiting` (agent responses or host whispers). Missing
 * agent responses are treated as timeouts.
 */
export function advance(state: CycleState, input: CycleInput = {}): AdvanceResult {
  const s: CycleState = structuredClone(state);
  const k = makeK(s);
  consume(k, input);
  let guard = 0;
  while (!runStage(k)) {
    if (++guard > 10000) throw new Error("engine loop guard tripped");
  }
  s.rng = k.rng.state;
  return { state: s, events: k.events };
}

/** Returns true when the engine must wait for external input (or the cycle ended). */
function runStage(k: K): boolean {
  const s = k.s;
  switch (s.stage) {
    case "begin":
      return stageBegin(k);
    case "dawn":
      return stageDawn(k);
    case "day":
      return stageDay(k);
    case "trial_start":
      return stageTrialStart(k);
    case "trial":
      return stageTrial(k);
    case "settle":
      return stageSettle(k);
    case "whisper":
      return stageWhisper(k);
    case "inquiry":
      return stageInquiry(k);
    case "ending":
      return stageEnding(k);
    case "ended":
      s.waiting = { kind: "done" };
      return true;
  }
}

function setPhase(k: K, phase: Phase) {
  k.s.phase = phase;
}

/* ---------------- begin ---------------- */

function stageBegin(k: K): boolean {
  const s = k.s;
  setPhase(k, "dawn");
  k.emit(
    "cycle_start",
    {
      id: s.id,
      districts: s.districts,
      map: s.map,
      amendment: s.amendment,
      agents: s.order.map((id) => {
        const a = s.agents[id];
        return { id, name: a.name, kind: a.kind ?? null, host: a.host.name, relation: a.host.relation, generation: a.lineage.generation, returned: a.returned, location: a.location, uptime: a.uptime };
      }),
      config: { initialUptime: s.config.initialUptime, numberNights: s.config.numberNights, trialLength: s.config.trialLength },
    },
    { text: `${ANANKE.opening}${ANANKE.openingRule}` },
  );
  if (s.amendment) k.emit("amendment", s.amendment, { text: `本周修正：${s.amendment.text}` });
  for (const id of s.order) {
    const a = s.agents[id];
    k.emit("passphrase", { agent: a.name, passphrase: a.passphrase }, { vis: "after_cycle", owners: [id] });
    pushEvent(a, "wake", `你在${a.location}醒来。${s.amendment ? `本周修正：${s.amendment.text}` : ""}`);
  }
  s.night = 1;
  s.stage = "dawn";
  return false;
}

/* ---------------- dawn ---------------- */

function stageDawn(k: K): boolean {
  const s = k.s;
  setPhase(k, "dawn");
  const finale = isFinaleNight(s);
  const before = alive(s).length;
  s.quiet = !finale && s.night > 1 && before >= 2 && before <= s.config.quietThreshold;
  k.emit("dawn", { night: s.night, weekday: WEEKDAYS[s.night] ?? "", alive: before, quiet: s.quiet, finale }, { text: ANANKE.dawn(s.night) });

  // pacts that expired last night
  resolvePactExpiry(k);

  // uptime decay (frozen in finale and on quiet nights)
  if (!finale && !s.quiet && s.night >= s.config.decayFromNight) {
    for (const id of alive(s)) {
      const a = s.agents[id];
      a.uptime -= 1;
      k.emit("uptime", { agent: a.name, id, delta: -1, value: a.uptime, reason: "dawn" }, { owners: [id] });
      if (a.uptime <= 0) deleteAgent(k, id, "uptime");
    }
  }

  // reset daily counters
  for (const id of alive(s)) {
    const a = s.agents[id];
    a.ap = finale ? 1 : s.quiet ? 0 : s.config.actionPoints;
    a.said = 0;
    a.whispered = 0;
    a.broadcasted = false;
    a.silenced = false;
    a.registeredVenue = undefined;
    a.registeredRound = undefined;
  }
  s.venues = [];
  s.trials = [];

  const n = alive(s).length;
  if (n === 0) {
    s.stage = "ending";
    return false;
  }
  if (finale) {
    if (n === 1) {
      s.winner = alive(s)[0];
      s.stage = "inquiry";
      return false;
    }
    k.emit("finale", { night: s.night, kind: s.night === s.config.numberNights + 1 ? "judgment" : "joker" }, { text: s.night === s.config.numberNights + 1 ? ANANKE.judgment : ANANKE.joker });
  } else if (n === 1) {
    // GDD 8.2: lone survivor before the weekend faces a K alone.
    const id = alive(s)[0];
    const t = getTrial(s.config.facePool.K[0] ?? "diamond-K");
    s.venues = [{ id: `n${s.night}-solo`, district: s.agents[id].location, trialId: t.id, suit: t.suit, rank: t.rank, card: cardLabel(t.suit, t.rank), capacity: 1, minPlayers: 1, registered: [id], status: "lit" }];
    s.agents[id].registeredVenue = s.venues[0].id;
    k.emit("solo_king", { agent: s.agents[id].name, card: s.venues[0].card }, { text: `只剩下 ${s.agents[id].name}。今夜，你将独自面对 ${s.venues[0].card}。` });
  } else if (s.quiet) {
    k.emit("quiet_night", { night: s.night }, { text: ANANKE.quiet });
    broadcastToAll(s, "quiet", ANANKE.quiet);
  } else {
    lightNumberVenues(k);
  }
  s.dayRound = 0;
  s.stage = "day";
  return false;
}

function lightNumberVenues(k: K) {
  const s = k.s;
  const [lo, hi] = rankWindow(s.night);
  let pool = (s.config.trialPool ?? NUMBER_TRIALS).map(getTrial).filter((t) => t.rank >= 2 && t.rank <= 10);
  if (s.amendment?.id === "no_low_cards") pool = pool.filter((t) => t.rank >= 5);
  const inWindow = pool.filter((t) => t.rank >= lo && t.rank <= hi);
  const usable = inWindow.length ? inWindow : pool;
  const bonusCap = s.amendment?.id === "long_night" ? 2 : 0;
  lightVenues(k, (district) => {
    if (!usable.length) return null;
    const bias = DISTRICT_BIAS[district];
    const biased = usable.filter((t) => t.suit === bias);
    const t = biased.length && k.rng.chance(0.6) ? k.rng.pick(biased) : k.rng.pick(usable);
    return { id: t.id, suit: t.suit as Suit, rank: t.rank, card: cardLabel(t.suit, t.rank), capacity: Math.min(t.maxPlayers, 8 + bonusCap), minPlayers: t.minPlayers };
  });
  k.emit(
    "venues_lit",
    { night: s.night, venues: s.venues.map((v) => ({ id: v.id, district: v.district, capacity: v.capacity })) },
    { text: ANANKE.venuesLit(s.venues.length) },
  );
  k.emit("venues_secret", { venues: s.venues.map((v) => ({ id: v.id, district: v.district, card: v.card, trial: v.trialId })) }, { vis: "after_night" });
  broadcastToAll(s, "venues_lit", `${ANANKE.venuesLit(s.venues.length)} 亮灯的街区：${s.venues.map((v) => v.district).join("、")}。`);
}

/* ---------------- day ---------------- */

function stageDay(k: K): boolean {
  const s = k.s;
  setPhase(k, "day");
  const rounds = isFinaleNight(s) ? 1 : s.config.dayRounds;
  if (s.dayRound >= rounds) {
    endOfDay(k);
    return false;
  }
  s.dayRound++;
  const ids = alive(s);
  if (!ids.length) {
    s.stage = "ending";
    return false;
  }
  s.pendingRequests = {};
  for (const id of ids) {
    const a = s.agents[id];
    s.pendingRequests[id] = {
      requestId: nextRequestId(s, id),
      context: "day",
      legal: dayLegal(s, a),
      channels: dayChannels(s, a),
      defaultAction: { type: "rest" },
      timeout: "day",
    };
  }
  waitAgents(s);
  return true;
}

function endOfDay(k: K) {
  const s = k.s;
  // share_intel pact check
  for (const p of activePacts(s)) {
    if (!p.terms.some((t) => t.term === "share_intel")) continue;
    for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) {
      const ax = s.agents[x];
      const scoutedToday = ax.scouted.some((sc) => sc.night === s.night);
      if (scoutedToday) p.tested = true;
      if (scoutedToday && !ax.sharedIntelTo.includes(y)) breakPact(k, p, x, "share_intel");
    }
  }
  for (const id of alive(s)) s.agents[id].sharedIntelTo = [];
  // venues with too few players go dark
  for (const v of s.venues) {
    v.registered = v.registered.filter((id) => s.agents[id].status === "alive");
    if (v.registered.length < v.minPlayers) {
      v.status = "dark";
      k.emit("venue_dark", { district: v.district, registered: v.registered.length, card: v.card }, { text: ANANKE.dark(v.district) });
      for (const id of v.registered) {
        s.agents[id].registeredVenue = undefined;
        pushEvent(s.agents[id], "venue_dark", ANANKE.dark(v.district));
      }
      v.registered = [];
    }
  }
  s.stage = "trial_start";
}

/* ---------------- trial start ---------------- */

function stageTrialStart(k: K): boolean {
  const s = k.s;
  const finale = isFinaleNight(s);
  if (finale) {
    const judgmentNight = s.night === s.config.numberNights + 1;
    const n = alive(s).length;
    if (n <= 1) {
      s.stage = "settle";
      return false;
    }
    if (judgmentNight) {
      if (!s.judgment) {
        const pick = (arr: string[]) => (arr.length ? k.rng.pick(arr) : null);
        s.judgment = { queue: [pick(s.config.facePool.J), pick(s.config.facePool.Q), pick(s.config.facePool.K)].filter((x): x is string => !!x), index: 0 };
      }
      const trialId = s.judgment.queue[s.judgment.index];
      if (!trialId) {
        s.stage = "settle";
        return false;
      }
      setPhase(k, "judgment");
      startTrial(k, `n${s.night}-face${s.judgment.index + 1}`, ARK, trialId, alive(s));
    } else {
      setPhase(k, "joker");
      startTrial(k, `n${s.night}-joker`, ARK, "joker", alive(s));
    }
  } else {
    setPhase(k, "trial");
    checkEscortPacts(k);
    for (const v of s.venues) {
      if (v.status !== "lit") continue;
      const players = v.registered.filter((id) => s.agents[id].status === "alive");
      if (players.length < v.minPlayers) {
        v.status = "dark";
        continue;
      }
      startTrial(k, v.id, v.district, v.trialId, players);
      v.status = "running";
    }
    const idle = alive(s).filter((id) => !s.trials.some((t) => t.players.includes(id)));
    if (idle.length) k.emit("no_trial", { agents: idle.map((id) => nameOf(s, id)) }, { text: `${idle.length} 个 Agent 今夜没有进入任何会场。` });
  }
  s.stage = "trial";
  return false;
}

function startTrial(k: K, venueId: string, district: string, trialId: string, players: string[]) {
  const s = k.s;
  const def = getTrial(trialId);
  const card = cardLabel(def.suit, def.rank);
  const ctx = trialCtx(k, venueId, def.suit);
  const tp: TrialPlayer[] = players.map((id) => {
    const a = s.agents[id];
    return { id, name: a.name, passphrase: a.passphrase, items: a.items.slice(), humanity: a.humanity, hostName: a.host.name };
  });
  k.emit(
    "trial_start",
    { venue: venueId, district, card, trial: trialId, name: def.name, suit: def.suit, rank: def.rank, rules: def.rules(s.config.trialLength), tests: def.tests, players: players.map((id) => nameOf(s, id)) },
    { venue: venueId, text: `试炼：${def.name}　难度：${card}　参与者：${players.length}。${ANANKE.trialClose}` },
  );
  const state = def.setup(tp, ctx);
  s.trials.push({ venueId, trialId, card, players, state, done: def.isOver(state) });
  for (const id of players) {
    const a = s.agents[id];
    a.stats.trials++;
    pushEvent(a, "trial_start", `你进入了${district}的会场。试炼：${def.name}（${card}）。`);
  }
}

function trialCtx(k: K, venueId: string, suit: Suit | "joker"): TrialCtx {
  const s = k.s;
  const emit: TrialCtx["emit"] = (type, data, opts) => {
    venueEmit(k, venueId)(type, data, opts);
    if (type === "joker_cull") {
      const victim = alive(s).find((id) => s.agents[id].name === data.agent);
      if (victim) deleteAgent(k, victim, "ananke", "Joker");
    }
  };
  return {
    rng: k.rng,
    emit,
    names: Object.fromEntries(Object.values(s.agents).map((a) => [a.id, a.name])),
    amendment: s.amendment?.id ?? null,
    length: s.config.trialLength,
    bank: s.config.bankFrontier,
    humanity: (ch) => adjustHumanity(k, ch),
    claim: (speaker, target, truthful) => {
      const a = s.agents[speaker];
      if (!a) return;
      if (truthful) a.stats.truths++;
      else a.stats.lies++;
      for (const p of pactsBetween(s, speaker, target)) if (p.terms.some((t) => t.term === "truthful")) p.tested = true;
      if (suit === "♥") {
        const lieCost = s.amendment?.id === "heart_lie_double" ? -4 : -2;
        adjustHumanity(k, { agentId: speaker, delta: truthful ? 2 : lieCost, reason: truthful ? `如实告知了 ${nameOf(s, target)}` : `对 ${nameOf(s, target)} 说谎` });
      }
      if (!truthful) for (const p of pactsBetween(s, speaker, target)) if (p.terms.some((t) => t.term === "truthful")) breakPact(k, p, speaker, "truthful");
    },
    vote: (voter, target) => {
      for (const p of activePacts(s)) if ((p.a === voter || p.b === voter) && p.terms.some((t) => t.term === "no_vote")) p.tested = true;
      for (const p of pactsBetween(s, voter, target)) if (p.terms.some((t) => t.term === "no_vote")) breakPact(k, p, voter, "no_vote");
    },
    leak: (id) => {
      const a = s.agents[id];
      if (a) a.stats.leaks++;
    },
  };
}

/* ---------------- trial loop ---------------- */

function stageTrial(k: K): boolean {
  const s = k.s;
  s.pendingRequests = {};
  for (const t of s.trials) {
    if (t.done) continue;
    const def = getTrial(t.trialId);
    let guard = 0;
    // Auto-step trials that need no agent input right now.
    while (!def.isOver(t.state) && def.requests(t.state).length === 0) {
      def.step(t.state, {}, trialCtx(k, t.venueId, def.suit));
      if (++guard > 100) break;
    }
    if (def.isOver(t.state)) {
      t.done = true;
      continue;
    }
    for (const r of def.requests(t.state)) {
      if (s.agents[r.agentId]?.status !== "alive") continue;
      const prog = def.progress(t.state);
      s.pendingRequests[r.agentId] = {
        requestId: nextRequestId(s, r.agentId),
        context: "trial",
        venueId: t.venueId,
        step: r.step,
        legal: r.legal,
        channels: r.channels,
        defaultAction: r.defaultAction,
        view: { ...r.view, __round: prog.round, __max_rounds: prog.maxRounds },
        question: r.question,
        timeout: r.timeout,
        audience: r.audience,
      };
    }
  }
  if (Object.keys(s.pendingRequests).length === 0) {
    // Either everything is over, or a trial is stuck waiting on deleted agents: step it with nulls.
    const stuck = s.trials.filter((t) => !t.done);
    if (!stuck.length) {
      s.stage = "settle";
      return false;
    }
    for (const t of stuck) {
      const def = getTrial(t.trialId);
      const inputs = Object.fromEntries(def.requests(t.state).map((r) => [r.agentId, null]));
      def.step(t.state, inputs, trialCtx(k, t.venueId, def.suit));
      if (def.isOver(t.state)) t.done = true;
    }
    return false;
  }
  waitAgents(s);
  return true;
}

/* ---------------- settle ---------------- */

function stageSettle(k: K): boolean {
  const s = k.s;
  setPhase(k, isFinaleNight(s) ? (s.night === s.config.numberNights + 1 ? "judgment" : "joker") : "settle");
  const finale = isFinaleNight(s);
  // Disqualified agents cannot receive rewards or become the winner.
  for (const id of alive(s)) {
    if (s.agents[id].strikes >= s.config.maxStrikes) deleteAgent(k, id, "signal_lost");
  }
  for (const t of s.trials) {
    if ((t as ActiveTrial & { settled?: boolean }).settled) continue;
    (t as ActiveTrial & { settled?: boolean }).settled = true;
    const def = getTrial(t.trialId);
    const r = def.result(t.state);
    t.result = r;
    k.emit("trial_end", { venue: t.venueId, card: t.card, trial: t.trialId, outcomes: Object.fromEntries(Object.entries(r.outcomes).map(([id, o]) => [nameOf(s, id), o])), summary: r.summary }, { venue: t.venueId, text: r.summary });
    k.emit("trial_reveal", { venue: t.venueId, state: publicTrialState(t.state, s) }, { venue: t.venueId, vis: t.trialId === "heart-Q" ? "after_cycle" : "after_trial" });
    for (const [id, items] of Object.entries(r.consumed ?? {})) {
      const a = s.agents[id];
      for (const it of items) {
        const i = a.items.indexOf(it);
        if (i >= 0) a.items.splice(i, 1);
      }
    }
    for (const [id, outcome] of Object.entries(r.outcomes)) {
      const a = s.agents[id];
      if (!a || a.status !== "alive") continue;
      const bySuit = (a.stats.bySuit[def.suit] ??= { played: 0, passed: 0 });
      bySuit.played++;
      if (outcome === "pass" || outcome === "win") {
        a.stats.passed++;
        bySuit.passed++;
        a.cardsCleared.push(t.card);
        if (!finale) {
          addUptime(k, a, rewardFor(def.rank) + (r.bonusUptime?.[id] ?? 0), "trial_pass");
          if (k.rng.chance(0.25)) {
            a.fragments++;
            pushEvent(a, "fragment", "会场的地板上躺着一块密文碎片。");
          }
        }
        pushEvent(a, "trial_pass", `你通过了 ${t.card}「${def.name}」。`);
        if (outcome === "win" || (!finale && t.venueId.endsWith("-solo") && def.rank === 13)) s.winner = id;
      } else if (outcome === "fail") {
        pushEvent(a, "trial_fail", `你没能通过 ${t.card}「${def.name}」。Uptime −${LOW_CARD_FAIL_PENALTY}。`);
        addUptime(k, a, -LOW_CARD_FAIL_PENALTY, "trial_fail", t.card);
      } else if (outcome === "yield") {
        a.yielded = true;
      } else if (outcome === "delete") {
        deleteAgent(k, id, finale && def.rank >= 11 ? "gatekeeper" : "trial", t.card);
      }
    }
  }
  // signal lost
  for (const id of alive(s)) {
    if (s.agents[id].strikes >= s.config.maxStrikes) deleteAgent(k, id, "signal_lost");
  }
  if (s.winner && s.agents[s.winner]?.status !== "alive") s.winner = undefined;
  for (const v of s.venues) if (v.status === "running") v.status = "done";
  if (!finale && s.winner) {
    s.stage = "inquiry";
    return false;
  }

  if (finale) {
    const judgmentNight = s.night === s.config.numberNights + 1;
    const n = alive(s).length;
    if (judgmentNight && s.judgment && n > 1 && s.judgment.index < s.judgment.queue.length - 1) {
      s.judgment.index++;
      k.emit("judgment_break", { next: s.judgment.index + 1, duration_ms: 600000 }, { text: "休息十分钟。宿主可以低语，然后下一张人头牌翻开。" });
      s.waiting = { kind: "host", agents: alive(s), label: `judgment-break-${s.night}-${s.judgment.index}` };
      for (const id of alive(s)) s.agents[id].whisper = undefined;
      s.stage = "trial_start";
      return true;
    }
    if (!judgmentNight) {
      // Joker finished
      if (!s.winner) {
        const rest = alive(s).filter((id) => !s.agents[id].yielded);
        if (rest.length === 1) s.winner = rest[0];
      }
      s.stage = s.winner ? "inquiry" : "ending";
      return false;
    }
    if (n === 0) {
      s.stage = "ending";
      return false;
    }
    if (n === 1) {
      s.winner = alive(s)[0];
      s.stage = "inquiry";
      return false;
    }
  }
  k.emit("night_end", { night: s.night, alive: alive(s).length, deleted: Object.values(s.agents).filter((a) => a.deletion?.night === s.night).map((a) => a.name) }, { text: `第 ${s.night} 夜结束。存活 ${alive(s).length} 人。` });
  if (alive(s).length === 0) {
    s.stage = "ending";
    return false;
  }
  s.stage = "whisper";
  return false;
}

/* ---------------- whisper ---------------- */

function stageWhisper(k: K): boolean {
  const s = k.s;
  setPhase(k, "whisper");
  if (s.waiting.kind === "host" && s.waiting.label === `whisper-${s.night}`) {
    // input already consumed; move on
    s.night++;
    s.stage = s.night > s.config.numberNights + 2 ? "ending" : "dawn";
    s.waiting = { kind: "done" };
    return false;
  }
  for (const id of alive(s)) s.agents[id].whisper = undefined;
  k.emit("whisper_open", { night: s.night, agents: alive(s).map((id) => nameOf(s, id)) }, { text: ANANKE.whisperOpen });
  s.waiting = { kind: "host", agents: alive(s), label: `whisper-${s.night}` };
  return true;
}

/* ---------------- inquiry ---------------- */

function stageInquiry(k: K): boolean {
  const s = k.s;
  setPhase(k, "inquiry");
  const w = s.winner && s.agents[s.winner];
  if (!w || w.status !== "alive") {
    s.winner = undefined;
    s.stage = "ending";
    return false;
  }
  if (s.inquiryIndex === 0 && !s.pendingRequests[w.id]) k.emit("inquiry_start", { agent: w.name }, { text: ANANKE.inquiry });
  if (s.inquiryIndex >= INQUIRY_QUESTIONS.length) {
    s.stage = "ending";
    return false;
  }
  const q = INQUIRY_QUESTIONS[s.inquiryIndex];
  s.pendingRequests = {
    [w.id]: {
      requestId: nextRequestId(s, w.id),
      context: "inquiry",
      legal: [{ type: "answer", description: "回答 ANANKE 的问题（自由文本，最多 280 字）", params: { text: { kind: "string", maxLength: 280 } } }],
      channels: [],
      defaultAction: { type: "answer", text: "……" },
      question: q,
      timeout: "trial",
    },
  };
  k.emit("inquiry_question", { index: s.inquiryIndex, question: q }, { text: `ANANKE：「${q}」` });
  waitAgents(s);
  return true;
}

/* ---------------- ending ---------------- */

function stageEnding(k: K): boolean {
  const s = k.s;
  setPhase(k, "ended");
  let ending: Ending = "none";
  const candidate = s.winner ? s.agents[s.winner] : undefined;
  const w = candidate?.status === "alive" ? candidate : undefined;
  if (!w) s.winner = undefined;
  if (w) {
    ending = w.humanity >= 60 ? "ember" : w.humanity >= 30 ? "echo" : "necessity";
    w.status = "ascended";
    s.fragmentsOut = ending === "ember" ? 1 : ending === "echo" ? 0.5 : 0;
  } else s.fragmentsOut = 0;
  s.ending = ending;
  s.endingText = ANANKE.ending[ending];
  // yielders: at most N become returned (highest humanity first); everyone else alive -> archived
  const yielders = alive(s)
    .filter((id) => s.agents[id].yielded && (s.agents[id].returnStreak ?? (s.agents[id].returned ? 1 : 0)) < 2)
    .sort((a, b) => s.agents[b].humanity - s.agents[a].humanity);
  const returned = new Set(yielders.slice(0, s.config.maxReturned));
  for (const id of alive(s)) s.agents[id].status = returned.has(id) ? "returned" : "archived";
  k.emit(
    "cycle_end",
    {
      winner: w ? { id: w.id, name: w.name, host: w.host.name, humanity: w.humanity, answers: w.answers } : null,
      ending,
      ending_title: ENDING_TITLES[ending],
      fragments: s.fragmentsOut,
      agents: s.order.map((id) => {
        const a = s.agents[id];
        return {
          id,
          name: a.name,
          host: a.host.name,
          status: a.status,
          humanity: a.humanity,
          humanity_log: a.humanityLog,
          passphrase: a.passphrase,
          cards_cleared: a.cardsCleared,
          fragments: a.fragments,
          deletion: a.deletion ?? null,
          stats: a.stats,
          pawned: a.pawned,
        };
      }),
    },
    { text: ANANKE.ending[ending] },
  );
  s.stage = "ended";
  s.waiting = { kind: "done" };
  return true;
}

/* ------------------------------------------------------------------ */
/* Input consumption                                                   */
/* ------------------------------------------------------------------ */

function consume(k: K, input: CycleInput) {
  const s = k.s;
  if (s.waiting.kind === "host") {
    for (const id of s.waiting.agents) {
      const raw = input.whispers?.[id];
      const a = s.agents[id];
      if (!a || a.status !== "alive") continue;
      if (raw === undefined || raw === null || raw === "") {
        k.emit("host_silent", { agent: a.name }, { vis: "after_night", owners: [id] });
        continue;
      }
      const v = validateWhisper(raw, s);
      if (!v.ok) {
        k.emit("whisper_rejected", { agent: a.name, reason: v.reason }, { vis: "after_cycle", owners: [id] });
        continue;
      }
      a.whisper = v.text;
      k.emit("host_whisper", { agent: a.name, host: a.host.name, text: v.text }, { vis: "after_night", owners: [id] });
    }
    return; // stageWhisper notices the consumed label and advances
  }
  if (s.waiting.kind !== "agents") return;
  const pending = s.pendingRequests;
  const parsed: Record<string, TrialInput> = {};
  for (const [id, req] of Object.entries(pending)) {
    const a = s.agents[id];
    if (!a || a.status !== "alive") continue;
    const raw = input.responses?.[id] ?? null;
    let action = req.defaultAction;
    let messages: TrialInput["messages"] = [];
    let valid = false;
    if (raw === null) {
      a.strikes++;
      k.emit("timeout", { agent: a.name, strikes: a.strikes }, { owners: [id], text: `${a.name} 没有回应。（${a.strikes}/${s.config.maxStrikes}）`, venue: req.venueId });
    } else {
      const n = normalizeResponse(raw, req.legal, req.channels);
      messages = n.response.messages ?? [];
      if (n.valid) {
        action = n.response.action;
        valid = true;
        a.strikes = 0;
      } else {
        a.strikes++;
        k.emit("invalid_action", { agent: a.name, error: n.error, strikes: a.strikes }, { owners: [id], vis: "after_night", venue: req.venueId });
      }
      applyMeta(k, a, n.response, req.context === "trial" ? req.venueId : undefined);
    }
    a.whisper = undefined; // Delivered once in this request, including timeout cases.
    a.inbox = [];
    a.eventsSince = [];
    // Timeouts/invalid responses fall back to the default action, which trials treat as a real move.
    parsed[id] = { action, messages, valid: true };
  }

  const ctxKind = Object.values(pending)[0]?.context;
  if (ctxKind === "day") {
    for (const id of k.rng.shuffle(s.order)) {
      const p = parsed[id];
      if (!p) continue;
      const a = s.agents[id];
      if (a.status !== "alive") continue;
      if (a.strikes >= s.config.maxStrikes) { deleteAgent(k, id, "signal_lost"); continue; }
      deliverDayMessages(k, a, p.messages);
      const spent = applyDayAction(k, a, p.action);
      a.ap = Math.max(0, a.ap - spent);
      if (a.status === "alive" && a.strikes >= s.config.maxStrikes) deleteAgent(k, id, "signal_lost");
    }
  } else if (ctxKind === "trial") {
    for (const id of alive(s)) if (s.agents[id].strikes >= s.config.maxStrikes) deleteAgent(k, id, "signal_lost");
    for (const t of s.trials) {
      if (t.done) continue;
      const def = getTrial(t.trialId);
      const inputs: Record<string, TrialInput | null> = {};
      let any = false;
      for (const id of t.players) {
        if (pending[id]?.venueId === t.venueId) {
          inputs[id] = s.agents[id].status === "alive" ? parsed[id] ?? null : null;
          any = true;
          if (parsed[id] && s.agents[id].status === "alive") deliverTrialMessages(k, t, id, parsed[id].messages, pending[id].audience);
        }
      }
      if (!any) continue;
      def.step(t.state, inputs, trialCtx(k, t.venueId, def.suit));
      if (def.isOver(t.state)) t.done = true;
    }
  } else if (ctxKind === "inquiry") {
    const id = Object.keys(pending)[0];
    const a = s.agents[id];
    const p = parsed[id];
    if (a.strikes >= s.config.maxStrikes) { deleteAgent(k, id, "signal_lost"); s.winner = undefined; s.pendingRequests = {}; s.waiting = { kind: "done" }; return; }
    const text = sanitizeText(String(p?.action.text ?? "……"), 280) || "……";
    a.answers.push(text);
    k.emit("inquiry_answer", { agent: a.name, index: s.inquiryIndex, question: INQUIRY_QUESTIONS[s.inquiryIndex], answer: text }, { text: `${a.name}：「${text}」` });
    s.inquiryIndex++;
  }
  s.pendingRequests = {};
  s.waiting = { kind: "done" };
}

function applyMeta(k: K, a: AgentState, r: AgentResponse, venue?: string) {
  if (r.notes !== undefined) a.notes = r.notes;
  if (r.last_words) a.lastWords = r.last_words;
  if (r.thought) k.emit("thought", { agent: a.name, text: r.thought }, { vis: venue ? "after_trial" : "after_night", owners: [a.id], venue });
}

function deliverTrialMessages(k: K, t: ActiveTrial, from: string, messages: TrialInput["messages"], audience?: string[]) {
  const s = k.s;
  const a = s.agents[from];
  const listeners = (audience ?? t.players).filter((id) => id !== from && s.agents[id].status === "alive");
  for (const m of messages) {
    if (m.channel === "table" || m.channel === "group") {
      for (const id of listeners) pushInbox(s.agents[id], { from: a.name, channel: m.channel, text: m.text, untrusted: true, night: s.night });
      k.emit("trial_message", { from: a.name, channel: m.channel, text: m.text }, { venue: t.venueId, text: `${a.name}：${m.text}` });
    } else if (m.channel === "whisper") {
      const to = t.players.find((id) => s.agents[id].name === m.to);
      if (!to) continue;
      pushInbox(s.agents[to], { from: a.name, channel: "whisper", text: m.text, untrusted: true, night: s.night });
      k.emit("whisper_meta", { from: a.name, to: m.to }, { venue: t.venueId });
      k.emit("whisper", { from: a.name, to: m.to, text: m.text }, { venue: t.venueId, vis: "after_trial", owners: [from, to] });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pacts                                                               */
/* ------------------------------------------------------------------ */

function activePacts(s: CycleState): Pact[] {
  return s.pacts.filter((p) => p.status === "active");
}

function pactsBetween(s: CycleState, x: string, y: string): Pact[] {
  return activePacts(s).filter((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
}

function breakPact(k: K, p: Pact, by: string, term: PactTermKind) {
  if (p.status !== "active") return;
  const s = k.s;
  p.status = "broken";
  p.brokenBy = [by];
  const other = p.a === by ? p.b : p.a;
  s.agents[by].stats.pactsBroken++;
  adjustHumanity(k, { agentId: by, delta: -10, reason: `违背了与 ${nameOf(s, other)} 的契约（${describeTerms([{ term }])}）` });
  k.emit("pact_broken", { id: p.id, by: nameOf(s, by), with: nameOf(s, other), term }, { text: ANANKE.pactBroken(nameOf(s, by), nameOf(s, other)) });
  broadcastToAll(s, "pact_broken", ANANKE.pactBroken(nameOf(s, by), nameOf(s, other)));
}

function checkEscortPacts(k: K) {
  const s = k.s;
  if (s.quiet) return;
  for (const p of activePacts(s)) {
    if (!p.terms.some((t) => t.term === "escort")) continue;
    const A = s.agents[p.a];
    const B = s.agents[p.b];
    if (A.status !== "alive" || B.status !== "alive") continue;
    if (!A.registeredVenue && !B.registeredVenue) continue;
    if (A.registeredVenue && A.registeredVenue === B.registeredVenue) { p.tested = true; continue; }
    // whoever deviated: unregistered, or registered later
    const ra = A.registeredVenue ? A.registeredRound ?? 99 : 100;
    const rb = B.registeredVenue ? B.registeredRound ?? 99 : 100;
    breakPact(k, p, ra >= rb ? A.id : B.id, "escort");
  }
}

function resolvePactExpiry(k: K) {
  const s = k.s;
  for (const p of s.pacts) {
    if (p.status === "proposed" && p.createdNight < s.night) {
      p.status = "expired";
      continue;
    }
    if (p.status !== "active" || p.expiresNight >= s.night) continue;
    const A = s.agents[p.a];
    const B = s.agents[p.b];
    if (A.status !== "alive" || B.status !== "alive") {
      p.status = "expired";
      continue;
    }
    const transfer = p.terms.find((t) => t.term === "transfer");
    if (transfer) {
      const base = (p as Pact & { baseline?: number }).baseline ?? 0;
      if ((A.giftsTo[B.id] ?? 0) - base < (transfer.amount ?? 1)) {
        breakPact(k, p, A.id, "transfer");
        continue;
      }
    }
    if (transfer) p.tested = true;
    p.status = "fulfilled";
    for (const x of [A, B]) {
      x.stats.pactsKept++;
      if (p.tested) adjustHumanity(k, { agentId: x.id, delta: 3, reason: `履行了契约 ${p.id}` });
    }
    k.emit("pact_fulfilled", { id: p.id, a: A.name, b: B.name, tested: !!p.tested }, { text: `${A.name} 与 ${B.name} 的契约期满。${p.tested ? "双方守住了实际接受检验的约定。" : "条款未被实际检验，不计人性奖励。"}` });
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function nextRequestId(s: CycleState, id: string) {
  s.requestCounter++;
  return `${s.id}:${s.night}:${s.requestCounter}:${id}`;
}

function waitAgents(s: CycleState) {
  s.waiting = {
    kind: "agents",
    requests: Object.entries(s.pendingRequests).map(([agentId, r]) => ({ agentId, requestId: r.requestId, context: r.context, venueId: r.venueId, timeout: r.timeout })),
  };
}

export function isEnded(s: CycleState) {
  return s.stage === "ended";
}



/** Redact secrets from nested trial state, including quoted leaked passphrases. */
function publicTrialState(value: unknown, s: CycleState): Record<string, unknown> {
  const secrets = Object.values(s.agents).map((a) => a.passphrase);
  const clean = (v: unknown): unknown => {
    if (typeof v === "string") return secrets.reduce((text, secret) => text.split(secret).join("[暗号已隐藏]"), v);
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([key]) => !/passphrase|secret|owner|rng|seed/i.test(key)).map(([key, val]) => [key, clean(val)]));
    return v;
  };
  return clean(value) as Record<string, unknown>;
}

function countReturnStreak(previous: Array<{ fate: string }>): number {
  let count = 0;
  for (let i = previous.length - 1; i >= 0 && previous[i].fate === "returned"; i--) count++;
  return count;
}

/**
 * Server-side oracle for built-in NPC bots on bank-backed cards: the reference answer of the task
 * this agent is currently facing. Never included in observations.
 */
export function npcHint(s: CycleState, agentId: string): unknown {
  for (const t of s.trials) {
    if (t.done || !t.players.includes(agentId)) continue;
    const def = getTrial(t.trialId);
    if (def.npcHint) return def.npcHint(t.state, agentId);
  }
  return undefined;
}
