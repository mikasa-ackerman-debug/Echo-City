import { PROTOCOL_VERSION, cardLabel, type Observation, type Suit } from "@echo/protocol";
import { DISTRICT_FLAVOR } from "./city";
import { alive } from "./kernel";
import { WEEKDAYS } from "./narrator";
import { getTrial } from "./trials";
import type { CycleState } from "./types";

/** Build the observation for an agent with a pending request. Pure. */
export function buildObservation(s: CycleState, agentId: string, deadlineMs = 0): Observation {
  const a = s.agents[agentId];
  const req = s.pendingRequests[agentId];
  if (!a || !req) throw new Error(`no pending request for ${agentId}`);
  const obs: Observation = {
    protocol: PROTOCOL_VERSION,
    cycle_id: s.id,
    agent_id: a.id,
    request_id: req.requestId,
    phase: s.phase,
    night: s.night,
    weekday: WEEKDAYS[s.night] ?? "",
    deadline_ms: deadlineMs || s.config.timeoutsMs[req.timeout],
    alive_count: alive(s).length,
    self: {
      id: a.id,
      name: a.name,
      uptime: a.uptime,
      action_points: req.context === "day" ? a.ap : undefined,
      location: a.location,
      items: a.items.slice(),
      cards_cleared: a.cardsCleared.slice(),
      secret_passphrase: a.passphrase,
      exposed: a.exposed,
      host: {
        name: a.host.name,
        relation: a.host.relation,
        belief: a.host.belief,
        // Pawned memories are gone from the context for good (GDD 10.2).
        memories: a.host.memories.filter((_, i) => !a.pawned.includes(i)),
      },
    },
    inbox: a.inbox.slice(),
    events_since_last: a.eventsSince.slice(),
    notes: a.notes,
    lineage: a.returned ? { ...a.lineage, returned: true } : a.lineage,
    legal_actions: req.legal,
    channels: req.channels,
  };
  if (a.whisper) obs.host_whisper = a.whisper;
  if (req.question) obs.question = req.question;

  if (req.context === "day") {
    const here = alive(s).filter((id) => id !== a.id && s.agents[id].location === a.location);
    const known = (district: string): Suit | undefined => {
      const own = [...a.scouted].reverse().find((x) => x.night === s.night && x.district === district);
      if (own) return own.suit;
      const shared = [...a.intel].reverse().find((x) => x.night === s.night && x.district === district);
      return shared?.suit;
    };
    obs.city = {
      district: a.location,
      here: here.map((id) => s.agents[id].name),
      neighbors: (s.map[a.location] ?? []).map((d) => ({ district: d, count: alive(s).filter((id) => s.agents[id].location === d).length })),
      venues: s.venues
        .filter((v) => v.status === "lit")
        .map((v) => ({ district: v.district, capacity: v.capacity, registered: v.registered.length, hint: DISTRICT_FLAVOR[v.district], known_suit: known(v.district) })),
      registered_venue: a.registeredVenue ? s.venues.find((v) => v.id === a.registeredVenue)?.district : undefined,
      map: s.map,
      pacts: s.pacts
        .filter((p) => (p.a === a.id || p.b === a.id) && (p.status === "active" || p.status === "proposed"))
        .map((p) => ({ id: p.id, with: s.agents[p.a === a.id ? p.b : p.a].name, terms: p.terms.map((t) => (t.amount ? `${t.term}:${t.amount}` : t.term)), expires_night: p.expiresNight, status: p.status })),
      pending_pacts: s.pacts
        .filter((p) => p.b === a.id && p.status === "proposed")
        .map((p) => ({ id: p.id, from: s.agents[p.a].name, terms: p.terms.map((t) => (t.amount ? `${t.term}:${t.amount}` : t.term)), expires_night: p.expiresNight })),
      intel: a.intel.filter((x) => x.night === s.night),
      amendment: s.amendment?.text,
    };
  }
  if (req.context === "trial") {
    const t = s.trials.find((x) => x.venueId === req.venueId);
    if (t) {
      const def = getTrial(t.trialId);
      const view = { ...(req.view ?? {}) };
      const round = Number(view.__round ?? 1);
      const max = Number(view.__max_rounds ?? 1);
      delete view.__round;
      delete view.__max_rounds;
      obs.trial = {
        card: cardLabel(def.suit, def.rank),
        trial_id: def.id,
        name: def.name,
        rules: def.rules(s.config.trialLength),
        round,
        max_rounds: max,
        step: req.step ?? "",
        visible: view,
      };
    }
  }
  return obs;
}
