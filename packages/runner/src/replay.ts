import { diagnose, summarize, type CycleEvent, type CycleState, type CycleSummary } from "@echo/engine";

/** Self-contained replay document consumed by the web player. */
export interface Replay {
  format: "echo-replay/1";
  id: string;
  seed: string;
  createdAt: string;
  config: CycleState["config"];
  districts: string[];
  map: Record<string, string[]>;
  amendment: CycleState["amendment"];
  agents: Array<{
    id: string;
    name: string;
    kind: string | null;
    host: { name: string; relation: string; belief: string };
    generation: number;
    status: string;
    diagnosis: string[];
  }>;
  events: CycleEvent[];
  summary: CycleSummary;
}

export function buildReplay(state: CycleState, events: CycleEvent[]): Replay {
  return {
    format: "echo-replay/1",
    id: state.id,
    seed: state.seed,
    createdAt: new Date().toISOString(),
    config: state.config,
    districts: state.districts,
    map: state.map,
    amendment: state.amendment,
    agents: state.order.map((id) => {
      const a = state.agents[id];
      return {
        id,
        name: a.name,
        kind: a.kind ?? null,
        host: { name: a.host.name, relation: a.host.relation, belief: a.host.belief },
        generation: a.lineage.generation,
        status: a.status,
        diagnosis: diagnose(a),
      };
    }),
    events,
    summary: summarize(state),
  };
}
