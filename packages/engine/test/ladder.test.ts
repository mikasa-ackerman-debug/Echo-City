import { describe, expect, it } from "vitest";
import { botRoster, runCycle } from "@echo/runner";
import { advance, buildObservation, createCycle, getTrial, JOKER_TRIAL, LADDER, LADDER_SUITS, ladderCards, ladderFailCost, type CycleState } from "../src";

const roster = (n: number) => botRoster(n).roster;

describe("ladder deck", () => {
  it("has four suits × 2..K plus the Joker, all implemented", () => {
    const ids = new Set<string>();
    for (const suit of LADDER_SUITS) {
      expect(LADDER[suit]).toHaveLength(12);
      LADDER[suit].forEach((id, i) => {
        const t = getTrial(id);
        expect(t.suit).toBe(suit);
        expect(t.rank).toBe(i + 2);
        ids.add(id);
      });
    }
    expect(ids.size).toBe(48);
    expect(getTrial(JOKER_TRIAL).suit).toBe("joker");
    expect(ladderCards()).toHaveLength(49);
  });

  it("fail costs follow the rank", () => {
    expect(ladderFailCost(2)).toBe(1);
    expect(ladderFailCost(4)).toBe(1);
    expect(ladderFailCost(5)).toBe(2);
    expect(ladderFailCost(10)).toBe(2);
    expect(ladderFailCost(11)).toBe("delete");
    expect(ladderFailCost(13)).toBe("delete");
  });
});

function start(n = 4): CycleState {
  const s = createCycle({ id: "lad", seed: "seed-1", roster: roster(n), config: { mode: "ladder" } });
  return advance(s).state;
}

describe("ladder cycle", () => {
  it("asks every agent to pick a suit and shows its ladder", () => {
    const s = start();
    expect(s.waiting.kind).toBe("agents");
    const id = s.order[0];
    const obs = buildObservation(s, id);
    expect(obs.ladder?.suits.map((x) => x.next?.card)).toEqual(["♦2", "♥2", "♣2", "♠2"]);
    expect(obs.ladder?.joker.open).toBe(false);
    const challenge = obs.legal_actions.find((a) => a.type === "challenge");
    expect((challenge?.params?.suit as { values: string[] }).values).toEqual(["♦", "♥", "♣", "♠"]);
    expect(obs.ladder?.profile.logic).toBeTypeOf("number");
  });

  it("passing a card moves one step up that suit; resting starts nothing", () => {
    let s = start(2);
    const [a, b] = s.order;
    s = advance(s, { responses: { [a]: { action: { type: "challenge", suit: "♦" } }, [b]: { action: { type: "rest" } } } }).state;
    expect(s.trials).toHaveLength(1);
    expect(s.trials[0].trialId).toBe("diamond-2");
    expect(s.trials[0].players).toEqual([a]);
    expect(s.waiting.kind === "agents" && s.waiting.requests.map((r) => r.agentId)).toEqual([a]);
  });

  it("fills short multiplayer tables with echoes that never reach the runner", () => {
    let s = start(2);
    const [a, b] = s.order;
    s.agents[a].ladder = { "♦": 0, "♣": 0, "♠": 0, "♥": 5 }; // next ♥7 needs 4 players
    s = advance(s, { responses: { [a]: { action: { type: "challenge", suit: "♥" } }, [b]: { action: { type: "rest" } } } }).state;
    const t = s.trials[0];
    expect(t.trialId).toBe("heart-7");
    expect(t.players.length).toBeGreaterThanOrEqual(4);
    const echoes = t.players.filter((id) => s.agents[id].echo);
    expect(echoes.length).toBe(t.players.length - 1);
    expect(s.order).not.toContain(echoes[0]);
    if (s.waiting.kind === "agents") for (const r of s.waiting.requests) expect(s.agents[r.agentId].echo).toBeFalsy();
  });

  it("only the Joker is open after 48 cards", () => {
    let s = start(2);
    const [a] = s.order;
    s.agents[a].ladder = { "♦": 12, "♣": 12, "♠": 12, "♥": 12 };
    // re-ask: finish this slot with rests, the next slot shows the joker
    s = advance(s, { responses: Object.fromEntries(s.order.map((id) => [id, { action: { type: "rest" } }])) }).state;
    const obs = buildObservation(s, a);
    expect(obs.ladder?.joker.open).toBe(true);
    expect((obs.legal_actions.find((x) => x.type === "challenge")?.params?.suit as { values: string[] }).values).toEqual(["joker"]);
  });

  it("runs to an end: one Joker winner with all 48 cards, or nobody left", async () => {
    const { roster: r, drivers } = botRoster(12);
    const res = await runCycle({ id: "lad-full", seed: "ladder-7", roster: r, drivers, config: { mode: "ladder" } }, { timeoutScale: 0.001 });
    const s = res.state;
    expect(s.stage).toBe("ended");
    const end = res.events.find((e) => e.type === "cycle_end")!;
    const w = (end.data as { winner: { id: string } | null }).winner;
    if (w) {
      const a = s.agents[w.id];
      expect(a.status).toBe("ascended");
      expect(Object.values(a.ladder!).every((n) => n === 12)).toBe(true);
    } else {
      expect(s.order.every((id) => s.agents[id].status !== "alive")).toBe(true);
    }
    for (const id of Object.keys(s.agents)) if (s.agents[id].echo) expect(s.order).not.toContain(id);
    expect(res.events.some((e) => e.type === "slot_open")).toBe(true);
  });

  it("a host earns one optional whisper per 4 cards climbed on a suit", async () => {
    const { roster: r, drivers } = botRoster(12);
    let asked = 0;
    const res = await runCycle({ id: "lad-w", seed: "ladder-7", roster: r, drivers, config: { mode: "ladder" } }, {
      timeoutScale: 0.001,
      // the first host speaks every time; the rest stay silent (whispers are optional)
      whispers: (state, agents) => {
        asked++;
        for (const id of agents) expect(state.agents[id].whisperCredits).toBeGreaterThan(0);
        return agents.includes(state.order[0]) ? { [state.order[0]]: "我一直都在。" } : {};
      },
    });
    const earned = res.events.filter((e) => e.type === "whisper_earned");
    expect(earned.length).toBeGreaterThan(0);
    for (const e of earned) expect((e.data as { cleared: number }).cleared % 4).toBe(0);
    expect(asked).toBeGreaterThan(0);
    const spoken = res.events.filter((e) => e.type === "host_whisper");
    expect(spoken.every((e) => e.vis === "public" && (e.data as { id: string }).id === res.state.order[0])).toBe(true);
    const first = res.state.order[0];
    const earnedFirst = earned.filter((e) => (e.data as { id: string }).id === first).length;
    expect(spoken.length).toBeLessThanOrEqual(earnedFirst);
    expect(res.events.some((e) => e.type === "whisper_open")).toBe(false);
  });
});
