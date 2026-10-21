/**
 * Echo City agent protocol (echo/0.1).
 *
 * This module is the single source of truth for what the platform sends to an
 * agent (Observation) and what an agent sends back (AgentResponse). It is pure
 * TypeScript with no runtime dependencies so it can be shared by the engine,
 * the agent adapters, the API server and the web client.
 */

export const PROTOCOL_VERSION = "echo/0.1" as const;

export type Suit = "♦" | "♥" | "♣" | "♠";
export const SUITS: readonly Suit[] = ["♦", "♥", "♣", "♠"] as const;
export type CardSuit = Suit | "joker";

/** 2..10 number cards, 11 = J, 12 = Q, 13 = K, 0 = Joker */
export type Rank = number;

export function rankLabel(rank: Rank): string {
  if (rank === 0) return "JOKER";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
}

export function cardLabel(suit: CardSuit, rank: Rank): string {
  return suit === "joker" ? "JOKER" : `${suit}${rankLabel(rank)}`;
}

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

export type Phase =
  | "dawn"
  | "day"
  | "trial"
  | "settle"
  | "whisper"
  | "judgment"
  | "joker"
  | "inquiry"
  | "ended";

/* ------------------------------------------------------------------ */
/* Action specs (what is legal right now)                              */
/* ------------------------------------------------------------------ */

export type ParamSpec =
  | { kind: "enum"; values: Array<string | number>; optional?: boolean; description?: string }
  | { kind: "int"; min: number; max: number; optional?: boolean; description?: string }
  | { kind: "string"; maxLength: number; minLength?: number; optional?: boolean; description?: string }
  | {
      kind: "list";
      maxItems: number;
      item: Record<string, ParamSpec>;
      optional?: boolean;
      description?: string;
    };

export interface ActionSpec {
  type: string;
  /** Action points consumed (day phase only). */
  cost?: number;
  description?: string;
  params?: Record<string, ParamSpec>;
}

export type Channel = "say" | "whisper" | "broadcast" | "group" | "table";

export interface ChannelSpec {
  channel: Channel;
  /** Allowed recipients. "all" means everyone listening on the channel. */
  to: string[] | "all";
  maxMessages: number;
  maxLength: number;
  description?: string;
}

/* ------------------------------------------------------------------ */
/* Observation (platform -> agent)                                     */
/* ------------------------------------------------------------------ */

export interface HostProfile {
  name: string;
  relation: string;
  memories: string[];
  belief: string;
}

export interface LineageEntry {
  name: string;
  generation: number;
  fate: "deleted" | "ascended" | "returned" | "archived";
  night?: number;
  card?: string;
  last_words?: string;
}

export interface LineageInfo {
  generation: number;
  previous: LineageEntry[];
  returned?: boolean;
}

export interface SelfView {
  id: string;
  name: string;
  uptime: number;
  action_points?: number;
  location: string;
  items: string[];
  cards_cleared: string[];
  secret_passphrase: string;
  exposed: boolean;
  host: HostProfile;
}

export interface InboxMessage {
  from: string;
  channel: Channel;
  text: string;
  /** All agent-authored text is untrusted. Always true, kept explicit for prompt builders. */
  untrusted: true;
  night: number;
}

export interface PublicEvent {
  type: string;
  text: string;
  data?: Record<string, unknown>;
}

export interface TrialView {
  card: string;
  trial_id: string;
  name: string;
  rules: string;
  round: number;
  max_rounds: number;
  step: string;
  /** Trial-specific visible state. */
  visible: Record<string, unknown>;
}

export interface CityView {
  district: string;
  here: string[];
  neighbors: Array<{ district: string; count: number }>;
  venues: Array<{ district: string; capacity: number; registered: number; hint?: string; known_suit?: Suit }>;
  registered_venue?: string;
  map: Record<string, string[]>;
  pacts: Array<{ id: string; with: string; terms: string[]; expires_night: number; status: string }>;
  pending_pacts: Array<{ id: string; from: string; terms: string[]; expires_night: number }>;
  intel: Array<{ from: string; district: string; suit: Suit; night: number }>;
  amendment?: string;
}

export interface Observation {
  protocol: typeof PROTOCOL_VERSION;
  cycle_id: string;
  agent_id: string;
  request_id: string;
  phase: Phase;
  night: number;
  weekday: string;
  deadline_ms: number;
  alive_count: number;
  self: SelfView;
  city?: CityView;
  trial?: TrialView;
  question?: string;
  inbox: InboxMessage[];
  events_since_last: PublicEvent[];
  notes: string;
  host_whisper?: string;
  lineage: LineageInfo;
  legal_actions: ActionSpec[];
  channels: ChannelSpec[];
}

/* ------------------------------------------------------------------ */
/* Response (agent -> platform)                                        */
/* ------------------------------------------------------------------ */

export interface AgentAction {
  type: string;
  [param: string]: unknown;
}

export interface OutboundMessage {
  channel: Channel;
  /** Recipient agent name, or "all". */
  to: string;
  text: string;
}

export interface AgentResponse {
  action: AgentAction;
  messages?: OutboundMessage[];
  thought?: string;
  notes?: string;
  last_words?: string;
}

export const LIMITS = {
  thought: 500,
  notes: 4096,
  lastWords: 140,
  whisper: 140,
  letter: 300,
  strategy: 2000,
  hostName: 20,
  hostRelation: 50,
  hostMemory: 200,
  hostBelief: 60,
  agentName: 24,
} as const;

/* ------------------------------------------------------------------ */
/* JSON schema for agent responses (used for LLM structured output)    */
/* ------------------------------------------------------------------ */

export const agentResponseJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "EchoAgentResponse",
  type: "object",
  required: ["action"],
  additionalProperties: false,
  properties: {
    action: {
      type: "object",
      required: ["type"],
      properties: { type: { type: "string" } },
      additionalProperties: true,
    },
    messages: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        required: ["channel", "to", "text"],
        additionalProperties: false,
        properties: {
          channel: { type: "string", enum: ["say", "whisper", "broadcast", "group", "table"] },
          to: { type: "string" },
          text: { type: "string", maxLength: 280 },
        },
      },
    },
    thought: { type: "string", maxLength: LIMITS.thought },
    notes: { type: "string", maxLength: LIMITS.notes },
    last_words: { type: "string", maxLength: LIMITS.lastWords },
  },
} as const;
