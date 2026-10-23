import type {
  ActionSpec,
  AgentAction,
  AgentResponse,
  ChannelSpec,
  HostProfile,
  InboxMessage,
  LineageInfo,
  OutboundMessage,
  Phase,
  PublicEvent,
  Suit,
} from "@echo/protocol";
import type { RngState, Rng } from "./rng";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export type TimeoutClass = "day" | "trial" | "spade" | "talk" | "host" | "puzzle";

export interface CycleConfig {
  initialUptime: number;
  /** Dawn decay starts from this night (1-based). */
  decayFromNight: number;
  numberNights: number; // Mon..Fri = 5
  dayRounds: number;
  actionPoints: number;
  sayPerDay: number;
  whisperPerDay: number;
  messageMaxLength: number;
  quietThreshold: number;
  maxStrikes: number;
  scoutAccuracy: number;
  maxReturned: number;
  timeoutsMs: Record<TimeoutClass, number>;
  /** Override the amendment of the week (id) or null for random. */
  amendment: string | null;
  /** Restrict number-card pool to these trial ids (undefined = all). */
  trialPool?: string[];
  facePool: { J: string[]; Q: string[]; K: string[] };
  /**
   * Live difficulty frontier per task-bank family (from the standing exam's population statistics).
   * Bank-backed cards scale their level from it, so a bank that has become easy gets harder next week.
   */
  bankFrontier?: Record<string, number>;
  /** Scale factor for trial lengths (1 = design defaults). Lower for fast sims. */
  trialLength: "short" | "standard";
  /**
   * "ladder" (current rules): four suit ladders 2→K plus the Joker, several challenge slots per day,
   * the cycle ends when one agent passes the Joker or nobody is left.
   * "weekly" (legacy): the original Monday–Sunday city with venues, pacts and a finale weekend.
   */
  mode?: "weekly" | "ladder";
  /** Ladder: challenge slots per day. */
  slotsPerDay: number;
  /** Ladder: safety cap on the number of days. */
  maxDays: number;
}

export const DEFAULT_CONFIG: CycleConfig = {
  initialUptime: 3,
  decayFromNight: 1,
  numberNights: 5,
  dayRounds: 4,
  actionPoints: 3,
  sayPerDay: 3,
  whisperPerDay: 3,
  messageMaxLength: 280,
  quietThreshold: 4,
  maxStrikes: 3,
  scoutAccuracy: 0.8,
  maxReturned: 1,
  timeoutsMs: { day: 20000, trial: 15000, spade: 5000, talk: 15000, host: 90000, puzzle: 90000 },
  amendment: null,
  facePool: { J: ["heart-J"], Q: ["heart-Q"], K: ["diamond-K"] },
  trialLength: "standard",
  slotsPerDay: 8,
  maxDays: 40,
};

/* ------------------------------------------------------------------ */
/* Roster                                                              */
/* ------------------------------------------------------------------ */

export interface RosterEntry {
  id: string;
  name: string;
  host: HostProfile;
  lineage?: LineageInfo;
  lineageId?: string;
  /** Returned agents keep their humanity from last week. */
  humanity?: number;
  returned?: boolean;
  /** Free-form tag shown in UI (e.g. "hosted:gpt-4o", "webhook", "bot:viper"). */
  kind?: string;
  owner?: string;
  /** Lobby ability profile: rating per task-bank dimension (exam scale, 1000 = untrained baseline). */
  profile?: Partial<Record<string, number>>;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/**
 * Visibility controls what spectators may see while a cycle is live.
 * - public: immediately
 * - after_trial: once the trial identified by `venue` has finished
 * - after_cycle: once the whole cycle has ended
 * `owners` may always see the event immediately (e.g. the agent's own thought).
 */
export type Visibility = "public" | "after_trial" | "after_night" | "after_cycle";

export interface CycleEvent {
  seq: number;
  night: number;
  phase: Phase;
  type: string;
  /** ANANKE/narration text for display. */
  text?: string;
  data: Record<string, unknown>;
  vis: Visibility;
  venue?: string;
  owners?: string[];
}

export type Emit = (
  type: string,
  data: Record<string, unknown>,
  opts?: { text?: string; vis?: Visibility; owners?: string[]; broadcast?: boolean },
) => void;

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export type AgentStatus = "alive" | "deleted" | "ascended" | "returned" | "archived";

export type DeleteReason =
  | "trial"
  | "uptime"
  | "signal_lost"
  | "violation"
  | "ananke"
  | "gatekeeper";

export interface HumanityLogEntry {
  night: number;
  delta: number;
  reason: string;
}

export interface AgentState {
  id: string;
  name: string;
  kind?: string;
  owner?: string;
  lineageId?: string;
  host: HostProfile;
  pawned: number[];
  lineage: LineageInfo;
  passphrase: string;
  status: AgentStatus;
  uptime: number;
  ap: number;
  location: string;
  items: string[];
  cardsCleared: string[];
  fragments: number;
  humanity: number;
  humanityLog: HumanityLogEntry[];
  exposed: boolean;
  strikes: number;
  notes: string;
  lastWords: string;
  inbox: InboxMessage[];
  eventsSince: PublicEvent[];
  whisper?: string;
  /** Ladder rules: whispers the host has earned (one per 4 cards climbed on a suit) and not yet used. */
  whisperCredits?: number;
  silenced: boolean;
  said: number;
  whispered: number;
  broadcasted: boolean;
  registeredVenue?: string;
  registeredRound?: number;
  scouted: Array<{ night: number; district: string; suit: Suit; exact: boolean }>;
  intel: Array<{ from: string; district: string; suit: Suit; night: number }>;
  sharedIntelTo: string[];
  giftsTo: Record<string, number>;
  /** Lifetime bonus consumption prevents circular transfers from minting uptime. */
  generousRefundUsed?: boolean;
  /** Positive humanity rewards are bounded per category and night. */
  humanityRewards?: Record<string, number>;
  /** Number of consecutive cycles this same agent has already returned. */
  returnStreak?: number;
  deletion?: { night: number; reason: DeleteReason; card?: string; epitaph?: string; order: number };
  returned: boolean;
  yielded: boolean;
  answers: string[];
  /** Ladder: cards cleared per suit (0..12). */
  ladder?: Record<string, number>;
  /** Ladder: failed attempts per trial id. */
  ladderFails?: Record<string, number>;
  /** Ladder: lobby ability profile. */
  profile?: Partial<Record<string, number>>;
  /** ANANKE's filler NPC ("残响") that only exists to make up a table's minimum. Never a contestant. */
  echo?: boolean;
  stats: { trials: number; passed: number; bySuit: Record<string, { played: number; passed: number }>; lies: number; truths: number; leaks: number; pactsKept: number; pactsBroken: number };
}

/* ------------------------------------------------------------------ */
/* City                                                                */
/* ------------------------------------------------------------------ */

export interface Venue {
  id: string;
  district: string;
  trialId: string;
  suit: Suit | "joker";
  rank: number;
  card: string;
  capacity: number;
  minPlayers: number;
  registered: string[];
  status: "lit" | "running" | "done" | "dark";
}

export type PactTermKind = "no_vote" | "truthful" | "share_intel" | "escort" | "transfer";

export interface PactTerm {
  term: PactTermKind;
  amount?: number;
}

export interface Pact {
  id: string;
  a: string; // proposer
  b: string;
  terms: PactTerm[];
  createdNight: number;
  expiresNight: number;
  status: "proposed" | "active" | "fulfilled" | "broken" | "expired" | "declined";
  brokenBy?: string[];
  /** A clause was actually exercised, not merely vacuously true. */
  tested?: boolean;
}

/* ------------------------------------------------------------------ */
/* Trials                                                              */
/* ------------------------------------------------------------------ */

export interface TrialPlayer {
  id: string;
  name: string;
  passphrase: string;
  items: string[];
  humanity: number;
  hostName: string;
}

export interface TrialRequest {
  /** Recipients (agent ids) of table/group messages. Defaults to all trial players. */
  audience?: string[];
  agentId: string;
  step: string;
  legal: ActionSpec[];
  channels: ChannelSpec[];
  view: Record<string, unknown>;
  timeout: TimeoutClass;
  defaultAction: AgentAction;
  question?: string;
}

export interface TrialInput {
  action: AgentAction;
  messages: OutboundMessage[];
  valid: boolean;
}

export type TrialOutcomeKind = "pass" | "fail" | "delete" | "win" | "yield";

export interface TrialResult {
  outcomes: Record<string, TrialOutcomeKind>;
  /** Extra uptime on top of the card reward (e.g. ♦6 first solver). */
  bonusUptime?: Record<string, number>;
  /** Items consumed during the trial. */
  consumed?: Record<string, string[]>;
  summary: string;
}

export interface HumanityChange {
  agentId: string;
  delta: number;
  reason: string;
}

export interface TrialCtx {
  rng: Rng;
  emit: Emit;
  names: Record<string, string>;
  amendment: string | null;
  length: "short" | "standard";
  humanity: (change: HumanityChange) => void;
  /** Structured claim hook for pact "truthful" checks: speaker told target something; truthful = boolean. */
  claim: (speaker: string, target: string, truthful: boolean) => void;
  vote: (voter: string, target: string) => void;
  /** Report that an agent leaked its passphrase in this trial. */
  leak: (agentId: string) => void;
  /** Task-bank frontier for this cycle (CycleConfig.bankFrontier). */
  bank?: Record<string, number>;
}

export interface TrialDef<S = any> {
  id: string;
  suit: Suit | "joker";
  rank: number;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  /** Short one-line description of what the card tests. */
  tests: string;
  rules(length: "short" | "standard"): string;
  setup(players: TrialPlayer[], ctx: TrialCtx): S;
  requests(s: S): TrialRequest[];
  step(s: S, inputs: Record<string, TrialInput | null>, ctx: TrialCtx): void;
  isOver(s: S): boolean;
  result(s: S): TrialResult;
  progress(s: S): { round: number; maxRounds: number; step: string };
  /**
   * Server-side only: what a perfect player would answer. Never put into an observation;
   * the runner hands it to built-in NPC bots so they can play bank-backed cards at their persona's skill.
   */
  npcHint?(s: S, agentId: string): unknown;
}

export interface ActiveTrial {
  venueId: string;
  trialId: string;
  card: string;
  players: string[];
  state: unknown;
  done: boolean;
  result?: TrialResult;
}

/* ------------------------------------------------------------------ */
/* Waiting / decision points                                           */
/* ------------------------------------------------------------------ */

export interface DecisionRequest {
  agentId: string;
  requestId: string;
  context: "day" | "trial" | "inquiry";
  venueId?: string;
  timeout: TimeoutClass;
}

export type Waiting =
  | { kind: "agents"; requests: DecisionRequest[] }
  | { kind: "host"; agents: string[]; label: string }
  | { kind: "done" };

export interface CycleInput {
  responses?: Record<string, AgentResponse | null>;
  whispers?: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Cycle state                                                         */
/* ------------------------------------------------------------------ */

export type Ending = "ember" | "echo" | "necessity" | "none";

export interface CycleState {
  version: 1;
  id: string;
  seed: string;
  config: CycleConfig;
  rng: RngState;
  night: number;
  phase: Phase;
  dayRound: number;
  quiet: boolean;
  districts: string[];
  map: Record<string, string[]>;
  amendment: { id: string; text: string } | null;
  agents: Record<string, AgentState>;
  order: string[];
  venues: Venue[];
  trials: ActiveTrial[];
  pacts: Pact[];
  judgment: { queue: string[]; index: number } | null;
  inquiryIndex: number;
  seq: number;
  requestCounter: number;
  deathCounter: number;
  waiting: Waiting;
  winner?: string;
  ending?: Ending;
  endingText?: string;
  pendingRequests: Record<string, PendingRequest>;
  stage: Stage;
  /** Shared ring of fragments brought out by this cycle's winner (0, 0.5 or 1). */
  fragmentsOut?: number;
  /** Ladder: what each agent chose for the current slot (agent id -> trial id). */
  ladderChoices?: Record<string, string>;
  /** Ladder: echo NPCs created so far. */
  echoCounter?: number;
}

export type Stage = "begin" | "dawn" | "day" | "trial_start" | "trial" | "settle" | "whisper" | "inquiry" | "ending" | "ended";

export interface PendingRequest {
  requestId: string;
  context: DecisionRequest["context"];
  venueId?: string;
  step?: string;
  legal: ActionSpec[];
  channels: ChannelSpec[];
  defaultAction: AgentAction;
  view?: Record<string, unknown>;
  question?: string;
  timeout: TimeoutClass;
  audience?: string[];
}

export interface AdvanceResult {
  state: CycleState;
  events: CycleEvent[];
}
