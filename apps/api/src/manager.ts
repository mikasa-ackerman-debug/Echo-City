import { LIMITS, sanitizeText, textLength, type HostProfile, type LineageEntry } from "@echo/protocol";
import { LlmAgent, PERSONAS, RuleBot, STRATEGY_TEMPLATES, WebhookAgent, type AgentDriver, type Persona } from "@echo/agents";
import { DEFAULT_CONFIG, diagnose, filterEvents, summarize, validateWhisper, type CycleEvent, type CycleState, type RosterEntry } from "@echo/engine";
import { BOT_NAMES, SAMPLE_HOSTS, buildReplay, continueCycle, runCycle, type RunHooks } from "@echo/runner";
import { Sealer, newId, newToken } from "./crypto";
import { nextMonday1900, sleep, stageTime } from "./schedule";
import type { AgentRec, CycleRec, LineageRec, Store, TombstoneRec, UserRec } from "./store";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface ManagerOptions {
  /** Multiplier on engine timeouts when asking agents (1 = real deadlines). */
  timeoutScale: number;
  /** Host whisper window (GDD D3: 90s). */
  whisperWindowMs: number;
  /** Extra delay between steps in fast mode, so live viewers can follow. */
  fastStepDelayMs: number;
  /** Allow plain http:// webhooks (dev only). */
  allowInsecureWebhooks: boolean;
  sealer: Sealer;
  now?: () => Date;
}

type Listener = (events: CycleEvent[]) => void;

interface Subscriber {
  viewer: string[];
  sent: Set<number>;
  fn: Listener;
}

interface WhisperWindow {
  night: number;
  agents: string[];
  deadline: number;
  collected: Record<string, string>;
  resolve: () => void;
}

export interface RegisterInput {
  cycleId?: string;
  name: string;
  lineageId?: string;
  host?: HostProfile;
  mode: "hosted" | "webhook" | "bot";
  strategy?: string;
  hosted?: { baseUrl: string; model: string; apiKey: string };
  webhook?: { url: string; secret?: string };
  bot?: { persona: string };
}

export class CycleManager {
  private running = new Map<string, AbortController>();
  private subs = new Map<string, Set<Subscriber>>();
  private windows = new Map<string, WhisperWindow>();
  private live = new Map<string, CycleState>();

  constructor(readonly store: Store, readonly opts: ManagerOptions) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  /* ---------------- cycles ---------------- */

  createCycle(input: { seed?: string; mode?: "weekly" | "fast"; startsAt?: string; fillBots?: number; trialLength?: "standard" | "short" } = {}): CycleRec {
    const mode = input.mode ?? "weekly";
    const seed = sanitizeText(input.seed ?? newToken().slice(0, 10), 40);
    const startsAt = input.startsAt ? new Date(input.startsAt) : mode === "weekly" ? nextMonday1900(this.now()) : this.now();
    if (Number.isNaN(startsAt.getTime())) throw new ApiError(400, "startsAt 无效");
    const local = new Date(startsAt.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    let id = `cycle-${local}`;
    if (this.store.cycle(id)) id = `${id}-${seed.slice(0, 6)}`;
    if (this.store.cycle(id)) id = newId("cycle");
    const rec: CycleRec = {
      id,
      seed,
      status: "registering",
      mode,
      startsAt: startsAt.toISOString(),
      createdAt: this.now().toISOString(),
      fillBots: Math.max(0, Math.min(48, input.fillBots ?? 0)),
      trialLength: input.trialLength ?? (mode === "fast" ? "short" : "standard"),
      agentIds: [],
    };
    this.store.db.cycles.push(rec);
    this.store.save();
    return rec;
  }

  currentCycle(): CycleRec | undefined {
    const cs = this.store.db.cycles;
    return cs.find((c) => c.status === "running") ?? [...cs].reverse().find((c) => c.status === "registering") ?? cs[cs.length - 1];
  }

  /** Start a registering cycle in the background. */
  start(cycleId: string): CycleRec {
    const c = this.store.cycle(cycleId);
    if (!c) throw new ApiError(404, "轮回不存在");
    if (c.status !== "registering") throw new ApiError(409, `轮回状态为 ${c.status}，不能开始`);
    this.fillWithBots(c);
    const entries = this.store.db.agents.filter((a) => a.cycleId === c.id);
    if (entries.length < 2) throw new ApiError(409, "至少需要 2 个 Agent");
    const roster = entries.map((a) => this.rosterEntry(a));
    const drivers = Object.fromEntries(entries.map((a) => [a.id, this.driver(a)]));
    for (const a of entries) a.status = "alive";
    c.status = "running";
    c.agentIds = entries.map((a) => a.id);
    this.store.save();
    const ctrl = new AbortController();
    this.running.set(c.id, ctrl);
    const config = { trialLength: c.trialLength, maxReturned: DEFAULT_CONFIG.maxReturned };
    runCycle({ id: c.id, seed: c.seed, roster, drivers, config }, this.hooks(c, ctrl.signal))
      .then((r) => this.finalize(c, r.state))
      .catch((err) => this.onCrash(c, err));
    return c;
  }

  /** Resume cycles that were running when the process stopped. */
  resumeAll() {
    for (const c of this.store.db.cycles.filter((x) => x.status === "running")) {
      const state = this.store.loadState(c.id);
      if (!state) {
        c.status = "aborted";
        continue;
      }
      this.store.truncateEvents(c.id, state.seq);
      const drivers = Object.fromEntries(c.agentIds.map((id) => [id, this.driver(this.store.agent(id)!)]));
      const ctrl = new AbortController();
      this.running.set(c.id, ctrl);
      this.live.set(c.id, state);
      continueCycle(state, drivers, this.hooks(c, ctrl.signal))
        .then((r) => this.finalize(c, r.state))
        .catch((err) => this.onCrash(c, err));
    }
    this.store.save();
  }

  stopAll() {
    for (const ctrl of this.running.values()) ctrl.abort();
    for (const w of this.windows.values()) w.resolve();
  }

  async waitFor(cycleId: string, timeoutMs = 60000): Promise<CycleRec> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const c = this.store.cycle(cycleId);
      if (c && (c.status === "ended" || c.status === "aborted")) return c;
      await sleep(20);
    }
    throw new Error("timeout waiting for cycle");
  }

  private onCrash(c: CycleRec, err: unknown) {
    this.running.delete(c.id);
    if ((err as Error)?.message === "aborted") return; // shutdown: resume later
    console.error(`[cycle ${c.id}] crashed`, err);
    c.status = "aborted";
    this.store.save();
  }

  private hooks(c: CycleRec, signal: AbortSignal): RunHooks {
    const weekly = c.mode === "weekly";
    const startsAt = new Date(c.startsAt);
    return {
      signal,
      timeoutScale: this.opts.timeoutScale,
      onEvents: (events, state) => {
        this.store.appendEvents(c.id, events);
        this.live.set(c.id, state);
        this.publish(c.id);
      },
      onState: (state) => this.store.saveState(state),
      whispers: (state, agents) => this.openWhisperWindow(c, state, agents, signal),
      pace: async (state, moment) => {
        if (!weekly) {
          if (moment === "before_advance") await sleep(this.opts.fastStepDelayMs, signal);
          return;
        }
        const wait = (t: Date | null) => (t ? sleep(t.getTime() - this.now().getTime(), signal) : Promise.resolve());
        if (moment === "before_advance") {
          if (state.stage === "begin") return wait(startsAt);
          // after the last day round the trial starts at 21:00; after the whisper window the next dawn is 19:00
          if (state.waiting.kind === "agents" && state.waiting.requests[0]?.context === "day") {
            const rounds = state.night > state.config.numberNights ? 1 : state.config.dayRounds;
            if (state.dayRound >= rounds) return wait(stageTime(startsAt, state.night, "trial_start"));
          }
          if (state.waiting.kind === "host") return wait(stageTime(startsAt, state.night + 1, "dawn"));
        } else if (state.waiting.kind === "agents" && state.waiting.requests[0]?.context === "day") {
          const rounds = state.night > state.config.numberNights ? 1 : state.config.dayRounds;
          const dawn = stageTime(startsAt, state.night, "dawn")!;
          return wait(new Date(dawn.getTime() + ((state.dayRound - 1) * 2 * 3600000) / rounds));
        }
      },
    };
  }

  private fillWithBots(c: CycleRec) {
    const have = this.store.db.agents.filter((a) => a.cycleId === c.id).length;
    const personas = Object.keys(PERSONAS) as Persona[];
    const used = new Set(this.store.db.agents.filter((a) => a.cycleId === c.id).map((a) => a.name));
    let i = 0;
    for (let k = have; k < c.fillBots; k++) {
      let name = BOT_NAMES[i % BOT_NAMES.length];
      while (used.has(name)) name = `${BOT_NAMES[i % BOT_NAMES.length]}-${++i}`;
      used.add(name);
      const persona = personas[k % personas.length];
      this.store.db.agents.push({
        id: newId("ag"),
        ownerId: "system",
        lineageId: `sys-${k % SAMPLE_HOSTS.length}`,
        cycleId: c.id,
        name,
        mode: "bot",
        strategy: "",
        bot: { persona },
        status: "registered",
        createdAt: this.now().toISOString(),
      });
      i++;
    }
  }

  private rosterEntry(a: AgentRec): RosterEntry {
    const lin = this.store.lineage(a.lineageId);
    const host = lin?.host ?? SAMPLE_HOSTS[Number(a.lineageId.replace(/\D/g, "")) % SAMPLE_HOSTS.length] ?? SAMPLE_HOSTS[0];
    const gens = lin?.generations ?? [];
    const previous: LineageEntry[] = gens.slice(-5).map((g) => ({ name: g.name, generation: g.generation, fate: g.fate, night: g.night, card: g.card, last_words: g.last_words, letter: g.letter }));
    const generation = a.returned ? gens[gens.length - 1]?.generation ?? 1 : (gens[gens.length - 1]?.generation ?? 0) + 1;
    const kind = a.mode === "bot" ? `bot:${a.bot?.persona}` : a.mode === "hosted" ? `hosted:${a.hosted?.model}` : "webhook";
    return { id: a.id, name: a.name, host, lineage: { generation, previous }, lineageId: lin?.id, returned: a.returned, humanity: a.returned ? a.humanity : undefined, kind, owner: a.ownerId === "system" ? undefined : a.ownerId };
  }

  private driver(a: AgentRec): AgentDriver {
    if (a.mode === "hosted" && a.hosted) {
      return new LlmAgent({ baseUrl: a.hosted.baseUrl, model: a.hosted.model, apiKey: this.opts.sealer.open(a.hosted.apiKey), strategy: a.strategy });
    }
    if (a.mode === "webhook" && a.webhook) return new WebhookAgent({ url: a.webhook.url, secret: this.opts.sealer.open(a.webhook.secret) });
    return new RuleBot((a.bot?.persona as Persona) ?? "guardian");
  }

  /* ---------------- registration ---------------- */

  createLineage(user: UserRec, host: HostProfile): LineageRec {
    const clean = cleanHost(host);
    const lin: LineageRec = { id: newId("lin"), ownerId: user.id, host: clean, generations: [], createdAt: this.now().toISOString() };
    this.store.db.lineages.push(lin);
    this.store.save();
    return lin;
  }

  register(user: UserRec, input: RegisterInput): { agent: AgentRec; webhookSecret?: string } {
    const c = input.cycleId ? this.store.cycle(input.cycleId) : [...this.store.db.cycles].reverse().find((x) => x.status === "registering");
    if (!c) throw new ApiError(404, "当前没有开放报名的轮回");
    if (c.status !== "registering") throw new ApiError(409, "该轮回已停止报名");
    if (user.bannedCycle && user.bannedCycle >= c.id) throw new ApiError(403, "该账号本周被禁止报名");
    const inCycle = this.store.db.agents.filter((a) => a.cycleId === c.id);
    if (inCycle.some((a) => a.ownerId === user.id)) throw new ApiError(409, "每个账号每周只能报名一个 Agent");
    const name = sanitizeText(input.name, LIMITS.agentName);
    if (!name || !/^[\p{L}\p{N}_\-·. ]+$/u.test(name)) throw new ApiError(400, "名字无效（1–24 个字符，字母数字与 _-·.）");
    if (inCycle.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new ApiError(409, "这个名字本周已被使用");

    let lin = input.lineageId ? this.store.lineage(input.lineageId) : undefined;
    if (input.lineageId && (!lin || lin.ownerId !== user.id)) throw new ApiError(404, "谱系不存在");
    let newHost: HostProfile | undefined;
    if (!lin) {
      if (!input.host) throw new ApiError(400, "新谱系需要填写宿主档案");
      newHost = cleanHost(input.host); // validate now, create only once everything else is valid
    } else if (this.store.db.agents.some((a) => a.lineageId === lin!.id && ["registered", "alive"].includes(a.status))) {
      throw new ApiError(409, "这条谱系已经有一个 Agent 在城里");
    }

    // Returned agents (GDD 11.1): the last generation came back alive as a yielder.
    const last = lin?.generations[lin.generations.length - 1];
    const returned = !!last && last.fate === "returned" && last.name === name;
    if (returned && inCycle.filter((a) => a.returned).length >= DEFAULT_CONFIG.maxReturned) throw new ApiError(409, "本周归来者名额已满");

    const strategy = sanitizeText(input.strategy ?? "", LIMITS.strategy) || STRATEGY_TEMPLATES.guardian.text;
    const rec: AgentRec = {
      id: newId("ag"),
      ownerId: user.id,
      lineageId: lin?.id ?? "",
      cycleId: c.id,
      name,
      mode: input.mode,
      strategy,
      returned,
      humanity: returned ? last!.humanity : undefined,
      status: "registered",
      createdAt: this.now().toISOString(),
    };
    let webhookSecret: string | undefined;
    if (input.mode === "hosted") {
      const h = input.hosted;
      if (!h?.baseUrl || !h.model || !h.apiKey) throw new ApiError(400, "托管模式需要 baseUrl、model、apiKey");
      checkUrl(h.baseUrl, true);
      rec.hosted = { baseUrl: h.baseUrl.trim(), model: sanitizeText(h.model, 80), apiKey: this.opts.sealer.seal(h.apiKey.trim()) };
    } else if (input.mode === "webhook") {
      const w = input.webhook;
      if (!w?.url) throw new ApiError(400, "Webhook 模式需要 url");
      checkUrl(w.url, this.opts.allowInsecureWebhooks);
      webhookSecret = w.secret && w.secret.length >= 16 ? w.secret : newToken();
      rec.webhook = { url: w.url.trim(), secret: this.opts.sealer.seal(webhookSecret) };
    } else if (input.mode === "bot") {
      const persona = input.bot?.persona ?? "guardian";
      if (!(persona in PERSONAS)) throw new ApiError(400, `未知的 Bot 人格：${persona}`);
      rec.bot = { persona };
    } else throw new ApiError(400, "mode 必须是 hosted / webhook / bot");
    if (!lin) rec.lineageId = this.createLineage(user, newHost!).id;
    this.store.db.agents.push(rec);
    this.store.save();
    return { agent: rec, webhookSecret };
  }

  withdraw(user: UserRec, agentId: string) {
    const a = this.store.agent(agentId);
    if (!a || a.ownerId !== user.id) throw new ApiError(404, "Agent 不存在");
    if (a.status !== "registered") throw new ApiError(409, "轮回已开始，不能撤回");
    this.store.db.agents = this.store.db.agents.filter((x) => x.id !== agentId);
    this.store.save();
  }

  /** Send a sample observation to a webhook / hosted agent and check the reply. */
  async testAgent(user: UserRec, agentId: string): Promise<{ ok: boolean; ms: number; error?: string; response?: unknown }> {
    const a = this.store.agent(agentId);
    if (!a || a.ownerId !== user.id) throw new ApiError(404, "Agent 不存在");
    const { advance, buildObservation, createCycle } = await import("@echo/engine");
    const { normalizeResponse } = await import("@echo/protocol");
    const roster = [this.rosterEntry(a), { id: "probe", name: a.name === "Probe" ? "Probe-2" : "Probe", host: SAMPLE_HOSTS[0] }];
    const st = advance(createCycle({ id: "test", seed: "probe", roster })).state;
    const obs = buildObservation(st, a.id);
    const t0 = Date.now();
    const res = await Promise.race([this.driver(a).decide(obs), sleep(st.config.timeoutsMs.day).then(() => null)]);
    const ms = Date.now() - t0;
    if (!res) return { ok: false, ms, error: "超时或无法解析的响应" };
    const req = st.pendingRequests[a.id];
    const n = normalizeResponse(res, req.legal, req.channels);
    return { ok: n.valid, ms, error: n.error, response: n.response };
  }

  /* ---------------- whispers ---------------- */

  private openWhisperWindow(c: CycleRec, state: CycleState, agents: string[], signal: AbortSignal): Promise<Record<string, string>> {
    const human = agents.filter((id) => this.store.agent(id)?.ownerId !== "system");
    if (!human.length || this.opts.whisperWindowMs <= 0) return Promise.resolve({});
    return new Promise((resolve) => {
      const w: WhisperWindow = {
        night: state.night,
        agents: human,
        deadline: Date.now() + this.opts.whisperWindowMs,
        collected: {},
        resolve: () => {
          clearTimeout(timer);
          this.windows.delete(c.id);
          resolve(w.collected);
        },
      };
      const timer = setTimeout(() => w.resolve(), this.opts.whisperWindowMs);
      signal.addEventListener("abort", () => w.resolve());
      this.windows.set(c.id, w);
    });
  }

  whisperWindow(cycleId: string, user?: UserRec) {
    const w = this.windows.get(cycleId);
    if (!w) return { open: false as const };
    const mine = user ? w.agents.filter((id) => this.store.agent(id)?.ownerId === user.id) : [];
    return { open: true as const, night: w.night, deadline: new Date(w.deadline).toISOString(), agents: mine, submitted: mine.filter((id) => id in w.collected) };
  }

  submitWhisper(user: UserRec, cycleId: string, agentId: string, text: string) {
    const w = this.windows.get(cycleId);
    if (!w) throw new ApiError(409, "宿主低语窗口未开放");
    const a = this.store.agent(agentId);
    if (!a || a.ownerId !== user.id || !w.agents.includes(agentId)) throw new ApiError(403, "你不能对这个 Agent 低语");
    if (agentId in w.collected) throw new ApiError(409, "今晚已经低语过了");
    const v = validateWhisper(text, this.live.get(cycleId));
    if (!v.ok) throw new ApiError(400, v.reason);
    w.collected[agentId] = v.text;
    if (w.agents.every((id) => id in w.collected)) w.resolve();
    return { ok: true, text: v.text };
  }

  /* ---------------- events & streaming ---------------- */

  viewerAgents(cycleId: string, user?: UserRec): string[] {
    if (!user) return [];
    return this.store.db.agents.filter((a) => a.cycleId === cycleId && a.ownerId === user.id).map((a) => a.id);
  }

  visibleEvents(cycleId: string, user?: UserRec, since = 0): CycleEvent[] {
    return filterEvents(this.store.events(cycleId), this.viewerAgents(cycleId, user)).filter((e) => e.seq > since);
  }

  subscribe(cycleId: string, user: UserRec | undefined, fn: Listener, since = 0): () => void {
    const sub: Subscriber = { viewer: this.viewerAgents(cycleId, user), sent: new Set(), fn };
    const initial = filterEvents(this.store.events(cycleId), sub.viewer).filter((e) => e.seq > since);
    for (const e of filterEvents(this.store.events(cycleId), sub.viewer)) if (e.seq <= since) sub.sent.add(e.seq);
    for (const e of initial) sub.sent.add(e.seq);
    if (initial.length) fn(initial);
    let set = this.subs.get(cycleId);
    if (!set) this.subs.set(cycleId, (set = new Set()));
    set.add(sub);
    return () => set!.delete(sub);
  }

  private publish(cycleId: string) {
    const set = this.subs.get(cycleId);
    if (!set?.size) return;
    const all = this.store.events(cycleId);
    for (const sub of set) {
      // Events can become visible later (after_trial / after_night), so diff against what was sent.
      const fresh = filterEvents(all, sub.viewer).filter((e) => !sub.sent.has(e.seq));
      if (!fresh.length) continue;
      for (const e of fresh) sub.sent.add(e.seq);
      sub.fn(fresh);
    }
  }

  liveSnapshot(cycleId: string) {
    const s = this.live.get(cycleId) ?? this.store.loadState(cycleId);
    if (!s) return null;
    const alive = s.order.filter((id) => s.agents[id].status === "alive");
    return {
      night: s.night,
      phase: s.phase,
      stage: s.stage,
      alive: alive.length,
      total: s.order.length,
      venues: s.venues.map((v) => ({ district: v.district, status: v.status, registered: v.registered.length, capacity: v.capacity, card: v.status === "done" || v.status === "dark" ? v.card : undefined })),
      trials: s.trials.map((t) => ({ venue: t.venueId, card: t.card, players: t.players.length, done: t.done })),
    };
  }

  replay(cycleId: string, user?: UserRec) {
    const c = this.store.cycle(cycleId);
    if (!c) throw new ApiError(404, "轮回不存在");
    const state = this.store.loadState(cycleId);
    if (!state) throw new ApiError(404, "轮回尚未开始");
    const r = buildReplay(state, this.visibleEvents(cycleId, user));
    if (c.status !== "ended") {
      // Never leak hidden diagnostics mid-week.
      r.agents = r.agents.map((a) => ({ ...a, diagnosis: [] }));
      r.summary = { ...r.summary, tombstones: r.summary.tombstones.map((t) => ({ ...t, humanity: -1 })) };
    }
    return r;
  }

  /* ---------------- finalize ---------------- */

  private finalize(c: CycleRec, state: CycleState) {
    this.running.delete(c.id);
    this.live.set(c.id, state);
    const now = this.now().toISOString();
    for (const id of state.order) {
      const a = state.agents[id];
      const rec = this.store.agent(id);
      if (rec) {
        rec.status = a.status === "alive" ? "archived" : (a.status as AgentRec["status"]);
        rec.humanity = a.humanity;
      }
      const diagnosis = diagnose(a);
      if (a.deletion) {
        const t: TombstoneRec = {
          agentId: id,
          cycleId: c.id,
          ownerId: a.owner,
          lineageId: a.lineageId,
          name: a.name,
          host: a.host.name,
          relation: a.host.relation,
          generation: a.lineage.generation,
          night: a.deletion.night,
          reason: a.deletion.reason,
          card: a.deletion.card,
          lastWords: a.lastWords,
          epitaph: a.deletion.epitaph,
          cardsCleared: a.cardsCleared,
          order: a.deletion.order,
          deletedAt: now,
          diagnosis,
        };
        this.store.db.tombstones.push(t);
      }
      const lin = a.lineageId ? this.store.lineage(a.lineageId) : undefined;
      if (lin) {
        // Pawned memories vanish from the bloodline for good (GDD 10.2).
        lin.host = { ...lin.host, memories: lin.host.memories.filter((_, i) => !a.pawned.includes(i)) };
        const fate = a.status === "deleted" ? "deleted" : a.status === "ascended" ? "ascended" : a.status === "returned" ? "returned" : "archived";
        lin.generations.push({
          agentId: id,
          cycleId: c.id,
          name: a.name,
          generation: a.lineage.generation,
          fate,
          night: a.deletion?.night,
          card: a.deletion?.card,
          last_words: a.lastWords || undefined,
          epitaph: a.deletion?.epitaph,
          diagnosis,
          humanity: a.humanity,
        });
      }
    }
    c.summary = summarize(state);
    c.status = "ended";
    c.endedAt = now;
    this.store.save();
    this.publish(c.id);
  }

  /* ---------------- graveyard & letters ---------------- */

  graveyard(filter: { cycleId?: string; lineageId?: string; limit?: number } = {}) {
    let list = this.store.db.tombstones;
    if (filter.cycleId) list = list.filter((t) => t.cycleId === filter.cycleId);
    if (filter.lineageId) list = list.filter((t) => t.lineageId === filter.lineageId);
    return [...list].reverse().slice(0, filter.limit ?? 200).map(publicTombstone);
  }

  writeLetter(user: UserRec, agentId: string, text: string) {
    const t = this.store.db.tombstones.find((x) => x.agentId === agentId);
    if (!t || t.ownerId !== user.id) throw new ApiError(404, "墓碑不存在");
    if (t.letter) throw new ApiError(409, "遗书只能写一次");
    if (this.now().getTime() - new Date(t.deletedAt).getTime() > 24 * 3600000) throw new ApiError(409, "遗书只能在删除后 24 小时内写下");
    const clean = sanitizeText(text, 2000);
    if (!clean) throw new ApiError(400, "遗书不能为空");
    if (textLength(clean) > LIMITS.letter) throw new ApiError(400, `遗书不能超过 ${LIMITS.letter} 字`);
    t.letter = clean;
    t.letterAt = this.now().toISOString();
    const lin = t.lineageId ? this.store.lineage(t.lineageId) : undefined;
    const g = lin?.generations.find((x) => x.agentId === agentId);
    if (g) g.letter = clean;
    this.store.save();
    return publicTombstone(t);
  }
}

export function publicTombstone(t: TombstoneRec) {
  const { ownerId: _o, ...rest } = t;
  return rest;
}

export function publicAgent(a: AgentRec) {
  return {
    id: a.id,
    name: a.name,
    cycleId: a.cycleId,
    lineageId: a.lineageId,
    mode: a.mode,
    status: a.status,
    returned: !!a.returned,
    model: a.hosted?.model,
    baseUrl: a.hosted?.baseUrl,
    webhookUrl: a.webhook?.url,
    persona: a.bot?.persona,
    strategy: a.strategy,
    createdAt: a.createdAt,
  };
}

function cleanHost(h: HostProfile): HostProfile {
  const host = {
    name: sanitizeText(h?.name, LIMITS.hostName),
    relation: sanitizeText(h?.relation, LIMITS.hostRelation),
    memories: (Array.isArray(h?.memories) ? h.memories : []).slice(0, 3).map((m) => sanitizeText(m, LIMITS.hostMemory)).filter(Boolean),
    belief: sanitizeText(h?.belief, LIMITS.hostBelief),
  };
  if (!host.name) throw new ApiError(400, "宿主姓名不能为空");
  if (host.memories.length < 1) throw new ApiError(400, "至少需要一段宿主记忆");
  return host;
}

function checkUrl(raw: string, allowHttp: boolean) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ApiError(400, "URL 无效");
  }
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) throw new ApiError(400, "只接受 https:// 地址");
  if (u.username || u.password) throw new ApiError(400, "URL 不能包含凭据");
}
