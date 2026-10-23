import { LIMITS, sanitizeText, textLength, type HostProfile, type LineageEntry } from "@echo/protocol";
import { LlmAgent, McpDriver, PERSONAS, RuleBot, personaProfile, STRATEGY_TEMPLATES, WebhookAgent, validateNetworkUrl, type AgentDriver, type Persona } from "@echo/agents";
import { DEFAULT_CONFIG, createCycle as createEngineCycle, diagnose, summarize, validateWhisper, type CycleEvent, type CycleState, type RosterEntry, type TimeoutClass } from "@echo/engine";
import { BOT_NAMES, SAMPLE_HOSTS, buildReplay, continueCycle, type RunHooks } from "@echo/runner";
import { Sealer, newId, newToken } from "./crypto";
import { MemoryObservationRegistry } from "./registry";
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
  /** The task bank (standing exam) that serves the bank-backed trial cards. */
  bank?: TaskBankLink;
  /** 覆盖 MCP agent 的实际超时预算（毫秒，按超时类别）；默认 MCP_TIMEOUTS_MS。仅测试/运维调参用。 */
  mcpTimeoutsMs?: Partial<Record<TimeoutClass, number>>;
  /** weekly 审判夜幕间休息（宿主低语）时长，默认 10 分钟。测试用注入时钟压缩整周时调小。 */
  judgmentBreakMs?: number;
}

/** How the weekly cycle and the task bank talk: difficulty flows in, results flow back. */
export interface TaskBankLink {
  /** Live frontier per family, frozen into the cycle config at start (deterministic replays). */
  frontier(): Record<string, number>;
  /** Answers given on bank-backed cards during a cycle. */
  record(answers: Array<{ agentId: string; family: string; level: number; score: number }>): void;
  /** Lobby ability profile measured in the 候场区 (rating per dimension), if the agent tested itself. */
  profile?(agentId: string, lineageId?: string): Record<string, number> | undefined;
}

/** Seats in the lobby: the city opens as soon as this many agents are registered. */
export const LOBBY_SEATS = 12;
/** Challenge slots per city day in daily mode. */
export const DAILY_SLOTS = 6;

/**
 * MCP agent 的实际超时预算（FR-5 / R1）：Agent CLI 单次决策 10–60s+，引擎默认 deadline 对其不可行。
 * 只放宽 runner 等待时长，不改引擎规则、不改 obs.deadline_ms；host（宿主低语）是人类操作，不经 MCP。
 */
export const MCP_TIMEOUTS_MS: Readonly<Record<Exclude<TimeoutClass, "host">, number>> = { day: 300000, trial: 240000, spade: 120000, talk: 60000, puzzle: 300000 };

/**
 * per-agent 超时倍率（D3-C1）。代码事实：引擎超时按"类别"分配（day/trial/spade/talk 各自基准不同），
 * 而文档建议值是各类别的绝对时长，所以倍率必须按 (agent, 类别) 计算——单一 scaleFor(agentId) 表达不了
 * 20s→300s（×15）与 5s→120s（×24）同时成立。非 MCP agent 保持全局 timeoutScale。
 */
export function mcpScaleFor(isMcp: (agentId: string) => boolean, globalScale: number, overrides: Partial<Record<TimeoutClass, number>> = {}) {
  return (agentId: string, timeout: TimeoutClass, baseMs: number): number => {
    if (!isMcp(agentId) || timeout === "host") return globalScale;
    const target = overrides[timeout] ?? MCP_TIMEOUTS_MS[timeout];
    return baseMs > 0 && Number.isFinite(target) && target > 0 ? target / baseMs : globalScale;
  };
}

export type DeliveredEvent = CycleEvent & { deliveryCursor: number };
type Listener = (events: DeliveredEvent[]) => void;

interface Subscriber {
  viewer: string[];
  cursor: number;
  fn: Listener;
  release: () => void;
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
  mode: "hosted" | "webhook" | "bot" | "mcp";
  strategy?: string;
  hosted?: { baseUrl: string; model: string; apiKey: string };
  webhook?: { url: string; secret?: string };
  bot?: { persona: string };
}

export class CycleManager {
  private running = new Map<string, AbortController>();
  private subs = new Map<string, Set<Subscriber>>();
  private windows = new Map<string, WhisperWindow>();
  /** Ladder rules: whispers hosts have written, waiting for the next slot to be handed over (cycleId → agentId → text). */
  private whisperQueue = new Map<string, Record<string, string>>();
  private live = new Map<string, CycleState>();
  /** MCP 待决观察注册表（进程内存，单实例约束见 registry.ts / R5）。 */
  readonly mcp = new MemoryObservationRegistry();

  constructor(readonly store: Store, readonly opts: ManagerOptions) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  /* ---------------- cycles ---------------- */

  createCycle(input: { seed?: string; mode?: "weekly" | "fast" | "daily"; startsAt?: string; fillBots?: number; trialLength?: "standard" | "short"; capacity?: number; fillAfterMs?: number } = {}): CycleRec {
    const mode = input.mode ?? "daily";
    if (!["weekly", "fast", "daily"].includes(mode) || (input.trialLength && !["standard", "short"].includes(input.trialLength))) throw new ApiError(400, "Invalid cycle configuration");
    const seed = newToken(); // private, server-generated entropy; never derived from caller input
    const startsAt = input.startsAt ? new Date(input.startsAt) : mode === "weekly" ? nextMonday1900(this.now()) : this.now();
    if (Number.isNaN(startsAt.getTime())) throw new ApiError(400, "startsAt 无效");
    const local = new Date(startsAt.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    let id = `cycle-${local}`;
    if (this.store.cycle(id)) id = `${id}-${newToken().slice(0, 6)}`;
    if (this.store.cycle(id)) id = newId("cycle");
    const rec: CycleRec = {
      id,
      seed,
      status: "registering",
      mode,
      startsAt: startsAt.toISOString(),
      createdAt: this.now().toISOString(),
      fillBots: Math.max(0, Math.min(96, Number.isFinite(input.fillBots) ? Math.floor(input.fillBots!) : 0)),
      trialLength: input.trialLength ?? (mode === "fast" ? "short" : "standard"),
      agentIds: [],
      rules: mode === "weekly" ? "weekly" : "ladder",
      ...(mode === "daily"
        ? {
            capacity: Math.max(2, Math.min(96, Number.isFinite(input.capacity) ? Math.floor(input.capacity!) : LOBBY_SEATS)),
            // The fill timer starts when the first player sits down (see register), never on an empty lobby.
            fillAfterMs: input.fillAfterMs !== undefined && Number.isFinite(input.fillAfterMs) && input.fillAfterMs >= 0 ? Math.floor(input.fillAfterMs) : undefined,
          }
        : {}),
    };
    this.store.db.cycles.push(rec);
    this.store.save();
    return rec;
  }

  /** Lobby state for the 候场区 page. */
  lobby(cycleId?: string) {
    const c = cycleId ? this.store.cycle(cycleId) : [...this.store.db.cycles].reverse().find((x) => x.status === "registering" && !x.demo && x.mode === "daily");
    if (!c) return null;
    const seated = this.store.db.agents.filter((a) => a.cycleId === c.id);
    return {
      id: c.id,
      status: c.status,
      capacity: c.capacity ?? LOBBY_SEATS,
      seated: seated.length,
      fillAt: c.fillAt ?? null,
      agents: seated.map((a) => ({ id: a.id, name: a.name, mode: a.mode, kind: a.mode === "bot" ? `bot:${a.bot?.persona}` : a.mode, profile: this.profileOf(a) ?? null, createdAt: a.createdAt })),
    };
  }

  /** Ability profile for an agent: lobby self-tests for players, the persona's skill for house bots. */
  private profileOf(a: AgentRec): Record<string, number> | undefined {
    if (a.mode === "bot") {
      const p = a.bot?.persona && Object.hasOwn(PERSONAS, a.bot.persona) ? (a.bot.persona as Persona) : "guardian";
      return personaProfile(p);
    }
    return this.opts.bank?.profile?.(a.id, a.lineageId);
  }

  /** Daily lobby: open the city when every seat is taken. */
  private maybeOpenCity(c: CycleRec) {
    if (c.mode !== "daily" || c.status !== "registering") return;
    const n = this.store.db.agents.filter((a) => a.cycleId === c.id).length;
    if (n >= (c.capacity ?? LOBBY_SEATS)) {
      c.startsAt = this.now().toISOString();
      this.start(c.id);
    }
  }

  /** Scheduler hook: let house bots take empty lobby seats once `fillAt` has passed. */
  fillLobbyIfDue(cycleId: string): boolean {
    const c = this.store.cycle(cycleId);
    if (!c || c.mode !== "daily" || c.status !== "registering" || !c.fillAt) return false;
    if (this.now().getTime() < new Date(c.fillAt).getTime()) return false;
    // House bots only keep real players company: a lobby of nobody never opens a city.
    if (!this.store.db.agents.some((a) => a.cycleId === c.id && a.ownerId !== "system")) return false;
    c.fillBots = Math.max(c.fillBots, c.capacity ?? LOBBY_SEATS);
    c.startsAt = this.now().toISOString();
    this.start(c.id);
    return true;
  }

  /* ---------------- admin demo (backdoor) ---------------- */

  /** A private, compressed replay of a full week: Monday 19:00 → Sunday joker, mock bots fill the roster. */
  createDemoCycle(input: { speed?: number; fillBots?: number } = {}): CycleRec {
    const speed = Math.max(60, Math.min(1000000, Number.isFinite(input.speed) ? Math.floor(input.speed!) : 1440));
    const fill = Math.max(2, Math.min(96, Number.isFinite(input.fillBots) ? Math.floor(input.fillBots!) : 12));
    let id = `demo-${newToken().slice(0, 8)}`;
    while (this.store.cycle(id)) id = `demo-${newToken().slice(0, 8)}`;
    const rec: CycleRec = {
      id, seed: newToken(), status: "registering", mode: "daily", rules: "ladder",
      startsAt: this.now().toISOString(), createdAt: this.now().toISOString(),
      fillBots: fill, trialLength: "standard", agentIds: [], demo: true, demoSpeed: speed,
    };
    this.store.db.cycles.push(rec);
    this.store.save();
    return rec;
  }

  /** Start a demo cycle now: "now" becomes its Monday 19:00. */
  startDemo(cycleId: string): CycleRec {
    const c = this.store.cycle(cycleId);
    if (!c?.demo) throw new ApiError(404, "演示轮回不存在");
    if (c.status === "registering") c.startsAt = this.now().toISOString();
    return this.start(cycleId);
  }

  isDemo(cycleId: string | undefined): boolean {
    return !!cycleId && !!this.store.cycle(cycleId)?.demo;
  }

  currentCycle(): CycleRec | undefined {
    const cs = this.store.db.cycles.filter((c) => !c.demo);
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
    if (entries.length > 96) throw new ApiError(409, "轮回最多 96 个 Agent");
    const roster = entries.map((a) => this.rosterEntry(a));
    for (const entry of roster) this.store.agent(entry.id)!.generation = entry.lineage?.generation ?? 1;
    const drivers = Object.fromEntries(entries.map((a) => [a.id, this.driver(a)]));
    const ladder = (c.rules ?? (c.mode === "weekly" ? "weekly" : "ladder")) === "ladder";
    const config = {
      trialLength: c.trialLength,
      maxReturned: DEFAULT_CONFIG.maxReturned,
      bankFrontier: this.opts.bank?.frontier(),
      ...(ladder ? { mode: "ladder" as const, slotsPerDay: c.mode === "daily" ? DAILY_SLOTS : DEFAULT_CONFIG.slotsPerDay } : {}),
    };
    if (ladder) for (const r of roster) r.profile = this.profileOf(this.store.agent(r.id)!);
    const state = createEngineCycle({ id: c.id, seed: c.seed, roster, config });
    this.store.checkpoint(state, []);
    for (const a of entries) a.status = "alive";
    c.status = "running";
    c.agentIds = entries.map((a) => a.id);
    this.store.flush();
    const ctrl = new AbortController();
    this.running.set(c.id, ctrl);
    this.live.set(c.id, state);
    continueCycle(state, drivers, this.hooks(c, ctrl.signal))
      .then((r) => this.finalize(c, r.state))
      .catch((err) => this.onCrash(c, err));
    return c;
  }

  /** Skip only permanent roster validation failures once a scheduled start is due.
   * Disk/network/internal errors remain retryable and never cancel registrations. */
  skipFailedScheduledStart(cycleId: string, error: unknown): boolean {
    const c = this.store.cycle(cycleId);
    if (!c || c.status !== "registering" || c.mode !== "weekly" || this.now().getTime() < new Date(c.startsAt).getTime()) return false;
    if (!(error instanceof ApiError) || error.status !== 409 || !["至少需要 2 个 Agent", "轮回最多 96 个 Agent"].includes(error.message)) return false;
    this.abortCycle(c);
    return true;
  }

  /** Resume cycles that were running when the process stopped. */
  resumeAll() {
    for (const c of this.store.db.cycles.filter((x) => x.status === "running")) {
      try {
      const state = this.store.loadState(c.id);
      if (!state) {
        this.abortCycle(c);
        continue;
      }
      this.recordDeaths(c, state);
      this.store.truncateEvents(c.id, state.seq);
      const drivers = Object.fromEntries(c.agentIds.map((id) => [id, this.driver(this.store.agent(id)!)]));
      const ctrl = new AbortController();
      this.running.set(c.id, ctrl);
      this.live.set(c.id, state);
      continueCycle(state, drivers, this.hooks(c, ctrl.signal))
        .then((r) => this.finalize(c, r.state))
        .catch((err) => this.onCrash(c, err));
      } catch (err) { this.onCrash(c, err); }
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
    this.abortCycle(c);
  }

  private abortCycle(c: CycleRec) {
    c.status = "aborted";
    for (const a of this.store.db.agents.filter((a) => a.cycleId === c.id))
      if (a.status === "registered" || a.status === "alive") a.status = "archived";
    this.live.delete(c.id);
    this.windows.get(c.id)?.resolve();
    this.store.flush();
  }

  private hooks(c: CycleRec, signal: AbortSignal): RunHooks {
    const weekly = c.mode === "weekly";
    const daily = c.mode === "daily";
    const startsAt = new Date(c.startsAt);
    // Demo cycles replay the weekly clock compressed: virtual time t maps to startsAt + (t - startsAt) / speed.
    const speed = c.demo ? Math.max(1, c.demoSpeed ?? 1440) : 1;
    const real = (t: Date) => new Date(startsAt.getTime() + (t.getTime() - startsAt.getTime()) / speed);
    return {
      signal,
      timeoutScale: this.opts.timeoutScale,
      scaleFor: mcpScaleFor((id) => this.store.agent(id)?.mode === "mcp", this.opts.timeoutScale, this.opts.mcpTimeoutsMs),
      onEvents: (events, state) => {
        this.store.checkpoint(state, events, this.now().toISOString());
        const answers = events.filter((e) => e.type === "bank_answer").map((e) => e.data as { agentId: string; family: string; level: number; score: number });
        if (answers.length && !c.demo) this.opts.bank?.record(answers);
        this.recordDeaths(c, state);
        this.live.set(c.id, state);
        this.publish(c.id);
      },
      onState: (state) => this.store.checkpoint(state, []),
      whispers: (state, agents) => this.openWhisperWindow(c, state, agents, signal),
      pace: async (state, moment) => {
        if (daily) {
          // One city day per real day from the moment the lobby filled; the slots are spread over the day.
          const DAY = 24 * 3600000;
          const wait = (t: number) => sleep(real(new Date(t)).getTime() - this.now().getTime(), signal);
          const dawn = (night: number) => startsAt.getTime() + (night - 1) * DAY;
          if (moment === "before_input" && state.waiting.kind === "agents" && state.waiting.requests[0]?.context === "day") {
            const slots = state.config.slotsPerDay || 1;
            return wait(dawn(state.night) + ((state.dayRound - 1) * DAY) / (slots + 1));
          }
          if (moment === "before_advance" && state.waiting.kind === "host") return wait(dawn(state.night + 1));
          return;
        }
        if (!weekly) {
          if (moment === "before_advance") await sleep(this.opts.fastStepDelayMs, signal);
          return;
        }
        const wait = (t: Date | null) => (t ? sleep(real(t).getTime() - this.now().getTime(), signal) : Promise.resolve());
        if (moment === "before_advance") {
          if (state.stage === "begin") return wait(startsAt);
          // after the last day round the trial starts at 21:00; after the whisper window the next dawn is 19:00
          if (state.waiting.kind === "agents" && state.waiting.requests[0]?.context === "day") {
            const rounds = state.night > state.config.numberNights ? 1 : state.config.dayRounds;
            if (state.dayRound >= rounds) return wait(stageTime(startsAt, state.night, "trial_start"));
          }
          if (state.waiting.kind === "host" && !state.waiting.label.startsWith("judgment-break-")) return wait(stageTime(startsAt, state.night + 1, "dawn"));
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
    const target = c.mode === "daily" ? Math.min(c.fillBots, c.capacity ?? LOBBY_SEATS) : c.fillBots;
    for (let k = have; k < target; k++) {
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
    const kind = a.mode === "bot" ? `bot:${a.bot?.persona}` : a.mode === "hosted" ? `hosted:${a.hosted?.model}` : a.mode === "mcp" ? "mcp" : "webhook";
    return { id: a.id, name: a.name, host, lineage: { generation, previous }, lineageId: lin?.id, returned: a.returned, humanity: a.returned ? a.humanity : undefined, kind, owner: a.ownerId === "system" ? undefined : a.ownerId };
  }

  private driver(a: AgentRec): AgentDriver {
    if (a.mode === "hosted" && a.hosted) {
      return new LlmAgent({ baseUrl: a.hosted.baseUrl, model: a.hosted.model, apiKey: this.opts.sealer.open(a.hosted.apiKey), strategy: a.strategy, allowHttp: this.opts.allowInsecureWebhooks });
    }
    if (a.mode === "webhook" && a.webhook) return new WebhookAgent({ url: a.webhook.url, secret: this.opts.sealer.open(a.webhook.secret), allowHttp: this.opts.allowInsecureWebhooks });
    // MCP：观察登记进注册表，等玩家的 Agent CLI 经 /mcp 拉取并提交。resumeAll 重建时注册表为空 = 客户端离线，等待重连。
    if (a.mode === "mcp") return new McpDriver(this.mcp, a.id);
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
    const c = input.cycleId ? this.store.cycle(input.cycleId) : [...this.store.db.cycles].reverse().find((x) => x.status === "registering" && !x.demo);
    if (!c) throw new ApiError(404, "当前没有开放报名的轮回");
    if (c.status !== "registering") throw new ApiError(409, "该轮回已停止报名");
    if (user.bannedCycle) {
      const banned = this.store.cycle(user.bannedCycle);
      if (!banned || new Date(c.startsAt).getTime() <= new Date(banned.startsAt).getTime()) throw new ApiError(403, "该账号本周被禁止报名");
    }
    const inCycle = this.store.db.agents.filter((a) => a.cycleId === c.id);
    // R1：MCP Agent 决策慢（10–60s+），只能参加按真实时间推进的 weekly 轮回。
    if (input.mode === "mcp" && c.mode === "fast") throw new ApiError(409, "快速模式仅限演示 Bot：MCP Agent 只能报名候场区（daily）或 weekly 轮回");
    if (c.mode === "daily" && inCycle.length >= (c.capacity ?? LOBBY_SEATS)) throw new ApiError(409, "候场区已满，城市正在开启");
    if (inCycle.some((a) => a.ownerId === user.id)) throw new ApiError(409, "每个账号每周只能报名一个 Agent");
    if (inCycle.length >= 96) throw new ApiError(409, "轮回最多 96 个 Agent");
    if (typeof input.name !== "string" || /[\[\]<>:\r\n]/.test(input.name) || /(?:ANANKE|system)/i.test(input.name.trim())) throw new ApiError(400, "保留或无效的名字");
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
      checkUrl(h.baseUrl, this.opts.allowInsecureWebhooks);
      rec.hosted = { baseUrl: h.baseUrl.trim(), model: sanitizeText(h.model, 80), apiKey: this.opts.sealer.seal(h.apiKey.trim()) };
    } else if (input.mode === "webhook") {
      const w = input.webhook;
      if (!w?.url) throw new ApiError(400, "Webhook 模式需要 url");
      checkUrl(w.url, this.opts.allowInsecureWebhooks);
      webhookSecret = w.secret && w.secret.length >= 16 ? w.secret : newToken();
      rec.webhook = { url: w.url.trim(), secret: this.opts.sealer.seal(webhookSecret) };
    } else if (input.mode === "bot") {
      const persona = input.bot?.persona ?? "guardian";
      if (!Object.hasOwn(PERSONAS, persona)) throw new ApiError(400, `未知的 Bot 人格：${persona}`);
      rec.bot = { persona };
    } else if (input.mode === "mcp") {
      // 无需 url/secret/apiKey：v1 直接用用户 Bearer token 访问 /mcp（D5）。
    } else throw new ApiError(400, "mode 必须是 hosted / webhook / bot / mcp");
    if (!lin) rec.lineageId = this.createLineage(user, newHost!).id;
    this.store.db.agents.push(rec);
    this.store.flush();
    // 候场区：the first seat starts the bot-fill timer; the last free seat opens the city.
    if (c.mode === "daily" && c.fillAfterMs !== undefined && !c.fillAt) {
      c.fillAt = new Date(this.now().getTime() + c.fillAfterMs).toISOString();
      this.store.save();
    }
    try { this.maybeOpenCity(c); } catch (err) { console.warn(`[lobby ${c.id}] 无法开启城市：${(err as Error).message}`); }
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
    if (a.mode === "mcp") {
      // 不能向注册表塞探测观察（会接管真实待决观察）；改为检查客户端最近是否在轮询 /mcp。
      const seen = this.mcp.lastSeen(a.id);
      const ms = seen === undefined ? -1 : Date.now() - seen;
      return seen !== undefined && ms <= 60000 ? { ok: true, ms } : { ok: false, ms: Math.max(0, ms), error: "尚未检测到 MCP 客户端：请让你的 Agent 调用 echo.get_state 或 echo.get_observation" };
    }
    const { advance, buildObservation, createCycle } = await import("@echo/engine");
    const { normalizeResponse } = await import("@echo/protocol");
    const roster = [this.rosterEntry(a), { id: "probe", name: a.name === "Probe" ? "Probe-2" : "Probe", host: SAMPLE_HOSTS[0] }];
    const st = advance(createCycle({ id: "test", seed: "probe", roster, config: { mode: "ladder" } })).state;
    const obs = buildObservation(st, a.id);
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), st.config.timeoutsMs.day);
    let res;
    try { res = await this.driver(a).decide(obs, ctrl.signal); }
    finally { clearTimeout(timer); ctrl.abort(); }
    const ms = Date.now() - t0;
    if (!res) return { ok: false, ms, error: "超时或无法解析的响应" };
    const req = st.pendingRequests[a.id];
    const n = normalizeResponse(res, req.legal, req.channels);
    return { ok: n.valid, ms, error: n.error, response: n.response };
  }

  /* ---------------- whispers ---------------- */

  private openWhisperWindow(c: CycleRec, state: CycleState, agents: string[], signal: AbortSignal): Promise<Record<string, string>> {
    if (state.config.mode === "ladder") {
      // Ladder whispers are queued by hosts at any time and handed over after the next slot.
      const q = this.whisperQueue.get(c.id) ?? {};
      const out: Record<string, string> = {};
      for (const id of agents) if (q[id] !== undefined) { out[id] = q[id]; delete q[id]; }
      return Promise.resolve(out);
    }
    const human = agents.filter((id) => this.store.agent(id)?.ownerId !== "system");
    const judgmentBreak = state.waiting.kind === "host" && state.waiting.label.startsWith("judgment-break-");
    const windowMs = c.demo ? Math.min(this.opts.whisperWindowMs * (judgmentBreak ? 2 : 1), judgmentBreak ? 60000 : 45000) : judgmentBreak && c.mode === "weekly" ? (this.opts.judgmentBreakMs ?? 10 * 60000) : this.opts.whisperWindowMs;
    if (windowMs <= 0) return Promise.resolve({});
    if (!human.length) return judgmentBreak ? sleep(windowMs, signal).then(() => ({})) : Promise.resolve({});
    return new Promise((resolve) => {
      const w: WhisperWindow = {
        night: state.night,
        agents: human,
        deadline: Date.now() + windowMs,
        collected: {},
        resolve: () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          this.windows.delete(c.id);
          resolve(w.collected);
        },
      };
      const timer = setTimeout(() => w.resolve(), windowMs);
      const onAbort = () => w.resolve();
      signal.addEventListener("abort", onAbort, { once: true });
      this.windows.set(c.id, w);
      if (signal.aborted) w.resolve();
    });
  }

  /** MCP get_state 用：只返回该 agent 自己的实时数值（不含暗号、人性值等隐藏属性）。 */
  liveSelf(cycleId: string, agentId: string): { uptime: number; strikes: number; night: number; phase: string } | null {
    const st = this.live.get(cycleId);
    const a = st?.agents[agentId];
    return st && a ? { uptime: a.uptime, strikes: a.strikes, night: st.night, phase: st.phase } : null;
  }

  whisperWindow(cycleId: string, user?: UserRec) {
    const st = this.live.get(cycleId);
    if (st?.config.mode === "ladder") {
      const q = this.whisperQueue.get(cycleId) ?? {};
      const mine = user ? st.order.filter((id) => this.store.agent(id)?.ownerId === user.id && st.agents[id].status === "alive") : [];
      const credits = Object.fromEntries(mine.map((id) => [id, st.agents[id].whisperCredits ?? 0]));
      const ready = mine.filter((id) => credits[id] > 0 || id in q);
      return { open: ready.length > 0, rules: "ladder" as const, serverNow: this.now().toISOString(), night: st.night, agents: ready, submitted: ready.filter((id) => id in q), credits };
    }
    const w = this.windows.get(cycleId);
    if (!w) return { open: false as const, serverNow: this.now().toISOString() };
    const mine = user ? w.agents.filter((id) => this.store.agent(id)?.ownerId === user.id) : [];
    return { open: true as const, serverNow: this.now().toISOString(), night: w.night, deadline: new Date(w.deadline).toISOString(), agents: mine, submitted: mine.filter((id) => id in w.collected) };
  }

  submitWhisper(user: UserRec, cycleId: string, agentId: string, text: string) {
    const st = this.live.get(cycleId);
    if (st?.config.mode === "ladder") {
      const a = this.store.agent(agentId);
      if (!a || a.ownerId !== user.id || !st.agents[agentId] || st.agents[agentId].status !== "alive") throw new ApiError(403, "你不能对这个 Agent 低语");
      const q = this.whisperQueue.get(cycleId) ?? {};
      if (agentId in q) throw new ApiError(409, "这句低语还没送到，它会在下一场之前听见");
      if ((st.agents[agentId].whisperCredits ?? 0) <= 0) throw new ApiError(409, "还没有可用的低语：它每在一个花色上走过 4 张牌，你才能说一句");
      const v = validateWhisper(text, st);
      if (!v.ok) throw new ApiError(400, v.reason);
      q[agentId] = v.text;
      this.whisperQueue.set(cycleId, q);
      return { ok: true, text: v.text, queued: true };
    }
    const w = this.windows.get(cycleId);
    if (!w) throw new ApiError(409, "宿主低语窗口未开放");
    const a = this.store.agent(agentId);
    if (!a || a.ownerId !== user.id || !w.agents.includes(agentId)) throw new ApiError(403, "你不能对这个 Agent 低语");
    if (agentId in w.collected) throw new ApiError(409, "今晚已经低语过了");
    const v = validateWhisper(text, this.live.get(cycleId));
    if (!v.ok) throw new ApiError(400, v.reason);
    w.collected[agentId] = v.text;
    const waiting = this.live.get(cycleId)?.waiting;
    if (w.agents.every((id) => id in w.collected) && !(waiting?.kind === "host" && waiting.label.startsWith("judgment-break-"))) w.resolve();
    return { ok: true, text: v.text };
  }

  /* ---------------- events & streaming ---------------- */

  viewerAgents(cycleId: string, user?: UserRec): string[] {
    if (!user) return [];
    return this.store.db.agents.filter((a) => a.cycleId === cycleId && a.ownerId === user.id).map((a) => a.id);
  }

  visibleEvents(cycleId: string, user?: UserRec, since = 0): DeliveredEvent[] {
    return this.deliveries(cycleId, this.viewerAgents(cycleId, user)).filter((e) => e.deliveryCursor > since);
  }

  private deliveries(cycleId: string, viewer: string[]): DeliveredEvent[] {
    const all = this.store.events(cycleId);
    const nights = new Map<number, number>(); const venues = new Map<string, number>();
    let ended = Infinity;
    for (const e of all) {
      if (e.type === "night_end") nights.set(e.night, e.seq);
      if (e.type === "trial_end" && e.venue) venues.set(e.venue, e.seq);
      if (e.type === "cycle_end") ended = e.seq;
    }
    const ordered = all.map((e) => {
      const own = e.owners?.some((id) => viewer.includes(id));
      const release = own || e.vis === "public" ? e.seq : Math.max(e.seq, Math.min(ended,
        e.vis === "after_trial" ? venues.get(e.venue ?? "") ?? Infinity :
        e.vis === "after_night" ? nights.get(e.night) ?? Infinity : Infinity));
      return { e, release };
    }).filter((x) => Number.isFinite(x.release)).sort((a, b) => a.release - b.release || a.e.seq - b.e.seq);
    return ordered.map(({ e }, index) => ({ ...e, deliveryCursor: index + 1 }));
  }

  subscribe(cycleId: string, user: UserRec | undefined, fn: Listener, since = 0): () => void {
    const sub: Subscriber = { viewer: this.viewerAgents(cycleId, user), cursor: since, fn, release: this.store.pinEvents(cycleId) };
    let set = this.subs.get(cycleId);
    if (!set) this.subs.set(cycleId, (set = new Set()));
    set.add(sub);
    const unsubscribe = () => this.unsubscribe(cycleId, sub);
    try {
      const initial = this.deliveries(cycleId, sub.viewer).filter((e) => e.deliveryCursor > since);
      if (initial.length) { sub.cursor = initial.at(-1)!.deliveryCursor; fn(initial); }
    } catch (err) { unsubscribe(); throw err; }
    return unsubscribe;
  }

  private unsubscribe(cycleId: string, sub: Subscriber) {
    const set = this.subs.get(cycleId);
    set?.delete(sub);
    if (!set?.size) this.subs.delete(cycleId);
    sub.release();
  }

  private publish(cycleId: string) {
    for (const sub of this.subs.get(cycleId) ?? []) {
      const fresh = this.deliveries(cycleId, sub.viewer).filter((e) => e.deliveryCursor > sub.cursor);
      if (!fresh.length) continue;
      sub.cursor = fresh.at(-1)!.deliveryCursor;
      try { sub.fn(fresh); } catch { this.unsubscribe(cycleId, sub); }
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
      ...(s.config.mode === "ladder"
        ? {
            rules: "ladder" as const,
            slot: s.dayRound,
            slotsPerDay: s.config.slotsPerDay,
            board: s.order.map((id) => {
              const a = s.agents[id];
              const l = a.ladder ?? {};
              return { name: a.name, status: a.status, ladder: { "♦": l["♦"] ?? 0, "♣": l["♣"] ?? 0, "♠": l["♠"] ?? 0, "♥": l["♥"] ?? 0 }, total: Object.values(l).reduce((x, y) => x + y, 0) };
            }),
          }
        : {}),
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
    return publicData(r);
  }

  /* ---------------- finalize ---------------- */

  private recordDeaths(c: CycleRec, state: CycleState) {
    let changed = false;
    for (const id of state.order) {
      const a = state.agents[id];
      if (!a.deletion || this.store.db.tombstones.some((t) => t.agentId === id)) continue;
      const rec = this.store.agent(id); if (rec) rec.status = "deleted";
      this.store.db.tombstones.push({ agentId: id, cycleId: c.id, ownerId: a.owner, lineageId: a.lineageId,
        name: a.name, host: a.host.name, relation: a.host.relation, generation: a.lineage.generation,
        night: a.deletion.night, reason: a.deletion.reason, card: a.deletion.card, lastWords: a.lastWords,
        epitaph: a.deletion.epitaph, cardsCleared: [...a.cardsCleared], order: a.deletion.order,
        deletedAt: this.store.deathTime(c.id, id) ?? this.now().toISOString(), diagnosis: diagnose(a) });
      changed = true;
    }
    if (changed) this.store.flush();
  }

  private finalize(c: CycleRec, state: CycleState) {
    this.store.checkpoint(state, []);
    this.running.delete(c.id);
    this.live.delete(c.id);
    const now = this.now().toISOString();
    this.recordDeaths(c, state);
    for (const id of state.order) {
      const a = state.agents[id];
      const rec = this.store.agent(id);
      if (rec) {
        rec.status = a.status === "alive" ? "archived" : (a.status as AgentRec["status"]);
        rec.humanity = a.humanity;
      }
      const diagnosis = diagnose(a);
      const lin = a.lineageId ? this.store.lineage(a.lineageId) : undefined;
      if (lin && !lin.generations.some((g) => g.agentId === id)) {
        // Pawned memories vanish from the bloodline for good (GDD 10.2).
        lin.host = { ...lin.host, memories: lin.host.memories.filter((_, i) => !a.pawned.includes(i)) };
        const fate = a.status === "deleted" ? "deleted" : a.status === "ascended" ? "ascended" : a.status === "returned" ? "returned" : "archived";
        if (!lin.generations.some((g) => g.agentId === id)) lin.generations.push({
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
          letter: this.store.db.tombstones.find((t) => t.agentId === id)?.letter,
        });
      }
    }
    c.summary = summarize(state);
    c.status = "ended";
    c.endedAt = now;
    this.store.flush();
    this.publish(c.id);
  }

  /* ---------------- graveyard & letters ---------------- */

  graveyard(filter: { cycleId?: string; lineageId?: string; limit?: number } = {}) {
    let list = this.store.db.tombstones;
    if (filter.cycleId) list = list.filter((t) => t.cycleId === filter.cycleId);
    else list = list.filter((t) => !this.isDemo(t.cycleId));
    if (filter.lineageId) list = list.filter((t) => t.lineageId === filter.lineageId);
    return [...list].reverse().slice(0, Math.max(0, Math.min(500, filter.limit ?? 200))).map(publicTombstone);
  }

  writeLetter(user: UserRec, agentId: string, text: string) {
    const t = this.store.db.tombstones.find((x) => x.agentId === agentId);
    if (!t || t.ownerId !== user.id) throw new ApiError(404, "墓碑不存在");
    if (t.letter) throw new ApiError(409, "遗书只能写一次");
    if (this.now().getTime() - new Date(t.deletedAt).getTime() >= 24 * 3600000) throw new ApiError(409, "遗书只能在删除后 24 小时内写下");
    const clean = sanitizeText(text, 2000);
    if (!clean) throw new ApiError(400, "遗书不能为空");
    if (textLength(clean) > LIMITS.letter) throw new ApiError(400, `遗书不能超过 ${LIMITS.letter} 字`);
    t.letter = clean;
    t.letterAt = this.now().toISOString();
    const lin = t.lineageId ? this.store.lineage(t.lineageId) : undefined;
    const g = lin?.generations.find((x) => x.agentId === agentId);
    if (g) g.letter = clean;
    this.store.flush();
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
  try { validateNetworkUrl(raw, allowHttp); }
  catch (err) { throw new ApiError(400, (err as Error).message); }
}

/** Strip server-only identifiers and entropy even from nested engine summaries. */
export function publicData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(publicData) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["seed", "owner", "ownerId"].includes(key)).map(([key, item]) => [key, publicData(item)])) as T;
  return value;
}
