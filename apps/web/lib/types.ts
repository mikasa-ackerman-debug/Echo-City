/**
 * Shapes of the apps/api responses (see apps/api/src/server.ts & manager.ts).
 * Server-side `publicData` strips seed/owner/ownerId — the web never sees them.
 */
import type { CycleEvent, CycleSummary } from "@echo/engine";
import type { HostProfile, LineageEntry } from "@echo/protocol";

export type CycleStatus = "registering" | "running" | "ended" | "aborted";
export type AgentStatus = "registered" | "alive" | "deleted" | "ascended" | "returned" | "archived";
export type AgentMode = "hosted" | "webhook" | "bot" | "mcp";

export interface LiveVenue { district: string; status: "lit" | "running" | "done" | "dark"; registered: number; capacity: number; card?: string }
export interface LiveSnapshot {
  night: number;
  phase: string;
  stage: string;
  alive: number;
  total: number;
  venues: LiveVenue[];
  trials: Array<{ venue: string; card: string; players: number; done: boolean }>;
}

export interface RosterRow { id: string; name: string; mode: AgentMode; status: AgentStatus; returned: boolean; host?: string; generation: number }

export interface WhisperWindow {
  open: boolean;
  serverNow: string;
  night?: number;
  deadline?: string;
  agents?: string[];
  submitted?: string[];
}

export interface CycleView {
  id: string;
  status: CycleStatus;
  mode: "weekly" | "fast";
  startsAt: string;
  createdAt: string;
  endedAt?: string;
  fillBots: number;
  trialLength: "standard" | "short";
  summary?: CycleSummary;
  agentIds: string[];
  roster: RosterRow[];
  live: LiveSnapshot | null;
  whisper: WhisperWindow;
}

export interface CycleListItem { id: string; status: CycleStatus; mode: "weekly" | "fast"; startsAt: string; endedAt?: string; agents: number; winner: string | null; ending: string | null; endingTitle: string | null }

export interface PublicAgent {
  id: string; name: string; cycleId: string; lineageId: string; mode: AgentMode; status: AgentStatus; returned: boolean;
  model?: string; baseUrl?: string; webhookUrl?: string; persona?: string; strategy: string; createdAt: string;
}

export interface LineageGeneration extends LineageEntry {
  agentId: string;
  cycleId: string;
  letter?: string;
  diagnosis?: string[];
  epitaph?: string;
  humanity?: number;
}

export interface Lineage { id: string; host: HostProfile; generations: LineageGeneration[]; createdAt: string }

export interface MeResponse { user: { id: string; name: string }; lineages: Lineage[]; agents: PublicAgent[] }

export interface TombstoneDTO {
  agentId: string;
  cycleId: string;
  lineageId?: string;
  name: string;
  host: string;
  relation: string;
  generation: number;
  night: number;
  reason: string;
  card?: string;
  lastWords: string;
  epitaph?: string;
  cardsCleared: string[];
  order: number;
  deletedAt?: string;
  letter?: string;
  letterAt?: string;
  diagnosis?: string[];
  humanity?: number;
}

export interface ReplayAgent { id: string; name: string; kind: string | null; host: { name: string; relation: string; belief: string }; generation: number; status: string; diagnosis: string[] }
export interface ReplayDoc {
  format: "echo-replay/1";
  id: string;
  seed?: string;
  createdAt: string;
  districts: string[];
  map: Record<string, string[]>;
  amendment: { id: string; text: string } | null;
  agents: ReplayAgent[];
  events: CycleEvent[];
  summary: CycleSummary;
}

export type DataSource = "api" | "demo";
