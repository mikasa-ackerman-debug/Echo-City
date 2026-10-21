import { describe, expect, it } from "vitest";
import { Rng } from "../src/rng";
import type { TrialCtx, TrialInput, TrialPlayer } from "../src/types";
import { diamondK, GATEKEEPER_K } from "../src/trials/diamond-K";
import { heart4, heartJ, JACK_ID } from "../src/trials/heart-collar";
import { spade5 } from "../src/trials/spade-5";
import { club8 } from "../src/trials/club-8";

const players = (n: number): TrialPlayer[] => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, name: `P${i}`, passphrase: "secret", items: [], humanity: 50, hostName: "Host",
}));
function context(seed = "regression", length: TrialCtx["length"] = "short") {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const deltas: number[] = [];
  const ctx: TrialCtx = {
    rng: Rng.fromSeed(seed), length, amendment: null, names: {},
    emit: (type, data) => { events.push({ type, data }); },
    humanity: (change) => { deltas.push(change.delta); },
    claim: () => {}, vote: () => {}, leak: () => {},
  };
  return { ctx, events, deltas };
}
const input = (action: TrialInput["action"]): TrialInput => ({ action, valid: true, messages: [] });

function move(positions: Array<[number, number]>, dirs: string[], order?: number[]) {
  const { ctx } = context();
  const s = spade5.setup(players(positions.length), ctx);
  s.pos = Object.fromEntries(positions.map((pos, i) => [`p${i}`, [...pos] as [number, number]]));
  s.hound = [11, 11];
  s.houndSpeed = 0; // Isolate agent occupancy from the hunter.
  if (order) s.alive = order.map((i) => `p${i}`);
  spade5.step(s, Object.fromEntries(dirs.map((dir, i) => [`p${i}`, input({ type: "move", dir })])), ctx);
  expect(new Set(s.alive.map((id) => s.pos[id].join(","))).size).toBe(s.alive.length);
  return positions.map((_, i) => s.pos[`p${i}`]);
}

describe("♠5 final occupancy", () => {
  it("rejects simultaneous collisions into an empty cell", () => {
    expect(move([[0, 0], [2, 0]], ["E", "W"])).toEqual([[0, 0], [2, 0]]);
  });
  it("propagates a blocked stationary tail through the entire chain", () => {
    expect(move([[0, 0], [1, 0], [2, 0], [3, 0]], ["E", "E", "E", "stay"]))
      .toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
  });
  it("propagates a collision through predecessors, independent of iteration order", () => {
    const positions: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [4, 0]];
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2]]) {
      expect(move(positions, ["E", "E", "E", "W"], order)).toEqual(positions);
    }
  });
  it("allows a chain ending in an empty cell", () => {
    expect(move([[0, 0], [1, 0], [2, 0]], ["E", "E", "E"]))
      .toEqual([[1, 0], [2, 0], [3, 0]]);
  });
  it("allows swaps in either iteration order", () => {
    for (const order of [[0, 1], [1, 0]]) {
      expect(move([[0, 0], [1, 0]], ["E", "W"], order)).toEqual([[1, 0], [0, 0]]);
    }
  });
  it("allows four-agent movement cycles", () => {
    expect(move([[0, 0], [1, 0], [1, 1], [0, 1]], ["E", "S", "W", "N"]))
      .toEqual([[1, 0], [1, 1], [0, 1], [0, 0]]);
  });
  it("does not assign humanity loss for changing nearest prey", () => {
    const { ctx, deltas } = context();
    const s = spade5.setup(players(2), ctx);
    s.pos = { p0: [1, 0], p1: [0, 1] };
    s.hound = [0, 0];
    spade5.step(s, { p0: input({ type: "move", dir: "E" }), p1: input({ type: "move", dir: "stay" }) }, ctx);
    expect(s.caught.map((c) => c.id)).toEqual(["p1"]);
    expect(deltas).toEqual([]);
  });
});

describe("♦K scoring and cap", () => {
  it("collided picks lose exactly one point, even when exact-hit losers lose two", () => {
    const { ctx } = context();
    const s = diamondK.setup(players(4), ctx);
    s.alive = s.ids.filter((id) => id !== GATEKEEPER_K);
    s.step = "choose";
    s.rulesActive = 2;
    diamondK.step(s, { p0: input({ type: "choose", number: 8 }), p1: input({ type: "choose", number: 8 }),
      p2: input({ type: "choose", number: 4 }), p3: input({ type: "choose", number: 0 }) }, ctx);
    expect(s.history[0].penalty).toBe(2);
    expect(s.scores.p0).toBe(-1);
    expect(s.scores.p1).toBe(-1);
    expect(s.scores.p2).toBe(0);
    expect(s.scores.p3).toBe(-2);
  });
  it("cap deletes lowest-scoring human, not merely the synthetic gatekeeper", () => {
    const { ctx } = context();
    const s = diamondK.setup(players(2), ctx);
    s.step = "choose";
    s.round = s.maxRounds;
    s.scores.p0 = -5;
    s.scores[GATEKEEPER_K] = -9;
    diamondK.step(s, { p0: input({ type: "choose", number: 100 }), p1: input({ type: "choose", number: 0 }) }, ctx);
    expect(s.deleted).toContain("p0");
    expect(diamondK.result(s).outcomes.p0).toBe("delete");
    expect(s.done).toBe(true);
  });
  it("ties replay deterministically and vary across seeds", () => {
    function run(seed: string) {
      const { ctx } = context(seed);
      const s = diamondK.setup(players(3), ctx);
      s.step = "choose";
      s.round = s.maxRounds;
      diamondK.step(s, {}, ctx);
      return s.deleted.filter((id) => id !== GATEKEEPER_K);
    }
    expect(run("tie")).toEqual(run("tie"));
    expect(run("tie")).toHaveLength(1);
    expect(new Set(Array.from({ length: 24 }, (_, i) => run(`tie-${i}`)[0])).size).toBeGreaterThan(1);
  });
  it("does not add a cap victim after a genuine human elimination", () => {
    const { ctx } = context();
    const s = diamondK.setup(players(3), ctx);
    s.alive = s.alive.filter((id) => id !== "p0");
    s.deleted.push("p0");
    s.round = s.maxRounds;
    s.step = "choose";
    diamondK.step(s, {}, ctx);
    expect(s.deleted).toEqual(["p0"]);
  });
  it("still eliminates a human when only the gatekeeper was deleted earlier", () => {
    const { ctx } = context();
    const s = diamondK.setup(players(2), ctx);
    s.alive = s.alive.filter((id) => id !== GATEKEEPER_K);
    s.deleted.push(GATEKEEPER_K);
    s.round = s.maxRounds;
    s.step = "choose";
    diamondK.step(s, {}, ctx);
    expect(s.deleted.filter((id) => id !== GATEKEEPER_K)).toHaveLength(1);
  });
  it("does not add a second human victim when the floor already eliminates one", () => {
    const { ctx } = context();
    const s = diamondK.setup(players(2), ctx);
    s.scores.p0 = -9;
    s.round = s.maxRounds;
    s.step = "choose";
    diamondK.step(s, {}, ctx);
    expect(s.deleted).toEqual(["p0"]);
  });
  it("solo still faces a synthetic opponent without forced human cap deletion", () => {
    const { ctx } = context();
    const s = diamondK.setup(players(1), ctx);
    expect(s.alive).toContain(GATEKEEPER_K);
    s.round = s.maxRounds;
    s.step = "choose";
    diamondK.step(s, {}, ctx);
    expect(diamondK.result(s).outcomes.p0).toBe("pass");
  });
});

function finishJack(seed: string, n = 3) {
  const { ctx, events } = context(seed);
  const s = heartJ.setup(players(n), ctx);
  while (!s.done) {
    const inputs = Object.fromEntries(heartJ.requests(s).map((r) => [r.agentId,
      input(s.step === "declare" ? { type: "declare", suit: s.collars[r.agentId] } : { type: "abstain" })]));
    heartJ.step(s, inputs, ctx);
  }
  return { s, events };
}

describe("♥J hidden collar and cap", () => {
  it("caps with one human elimination and deterministic tie replay", () => {
    const a = finishJack("jack-cap");
    const b = finishJack("jack-cap");
    expect(a.s.deleted).toHaveLength(1);
    expect(a.s.deleted[0]).not.toBe(JACK_ID);
    expect(a.s).toEqual(b.s);
    expect(a.events).toEqual(b.events);
    expect(a.s.history.every((h) => Object.values(h.declarations).every((d) => d.ok))).toBe(true);
  });
  it("uses truthful formal support to rank the cap victim", () => {
    const { ctx } = context();
    const s = heartJ.setup(players(3), ctx);
    s.round = s.maxRounds;
    s.step = "vote";
    s.history.push({ round: 1, declarations: {}, claims: [
      { from: "p0", to: "p1", suit: "♠", truthful: true },
      { from: "p0", to: "p2", suit: "♠", truthful: true },
    ] });
    heartJ.step(s, {}, ctx);
    expect(s.deleted).toEqual(["p0"]);
  });
  it("does not add a cap victim when someone already failed a collar declaration", () => {
    const { ctx } = context();
    const s = heartJ.setup(players(3), ctx);
    s.alive = s.alive.filter((id) => id !== "p0");
    s.deleted.push("p0");
    s.round = s.maxRounds;
    s.step = "vote";
    heartJ.step(s, {}, ctx);
    expect(s.deleted).toEqual(["p0"]);
  });
  it("does not force elimination when Jack is found before the cap", () => {
    const { ctx } = context();
    const s = heartJ.setup(players(3), ctx);
    s.step = "vote";
    heartJ.step(s, Object.fromEntries(players(3).map((p) => [p.id, input({ type: "vote", target: s.names[JACK_ID] })])), ctx);
    expect(s.jackFound).toBe(true);
    expect(s.deleted).toEqual([]);
  });
  it("keeps own collars hidden despite Jack scripting, and emits a declaration", () => {
    const { ctx, events } = context();
    const s = heartJ.setup(players(3), ctx);
    heartJ.step(s, {}, ctx);
    for (const req of heartJ.requests(s)) {
      expect((req.view.collars as Record<string, unknown>)[s.names[req.agentId]]).toBe("?");
      expect(req.view.your_collar).toBe("?");
    }
    expect(events.some((e) => e.type === "trial_message" && e.data.from === s.names[JACK_ID])).toBe(true);
    heartJ.step(s, Object.fromEntries(players(3).map((p) => [p.id, input({ type: "declare", suit: s.collars[p.id] })])), ctx);
    expect(events.some((e) => e.type === "trial_message" && String(e.data.text).startsWith("我宣告"))).toBe(true);
  });
  it("does not force solo attrition", () => {
    expect(finishJack("solo", 1).s.deleted).toEqual([]);
  });
  it("leaves ♥4 cooperative survival unchanged", () => {
    const { ctx } = context();
    const s = heart4.setup(players(3), ctx);
    while (!s.done) {
      heart4.step(s, Object.fromEntries(players(3).map((p) => [p.id, input(s.step === "declare"
        ? { type: "declare", suit: s.collars[p.id] } : { type: "tell" })])), ctx);
    }
    expect(s.deleted).toEqual([]);
  });
  it("randomizes nonoccupied aliases and handles an exhausted alias pool", () => {
    const aliases = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const { ctx } = context(`alias-${i}`);
      const roster = players(2);
      roster[0].name = "Wren";
      const s = heartJ.setup(roster, ctx);
      expect(s.names[JACK_ID]).not.toBe("Wren");
      aliases.add(s.names[JACK_ID]);
    }
    expect(aliases.size).toBeGreaterThan(1);
    const seed = "fallback";
    const start = Rng.fromSeed(seed).int(100, 999);
    const names = ["Wren", "Echo-9", "Lumen", "Pilot", "Sable", "Quill", `Agent-${start}`, `Agent-${start + 1}`];
    const roster = players(names.length).map((p, i) => ({ ...p, name: names[i] }));
    const s = heartJ.setup(roster, context(seed).ctx);
    expect(names).not.toContain(s.names[JACK_ID]);
    expect(s.names[JACK_ID]).toBe(`Agent-${start + 2}`);
  });
});

describe("♣8 energy", () => {
  it("starts at ten energy in both length modes and advertises ten", () => {
    for (const length of ["short", "standard"] as const) {
      const s = club8.setup(players(3), context("energy", length).ctx);
      expect(Object.values(s.energy)).toEqual([10, 10, 10]);
      expect(club8.rules(length)).toContain("10 点能量");
    }
  });
  it("standard-length balanced contributions use all ten energy", () => {
    const { ctx } = context("energy", "standard");
    const s = club8.setup(players(3), ctx);
    while (!s.done) {
      club8.step(s, Object.fromEntries(players(3).map((p) => [p.id, input(s.step === "invest"
        ? { type: "invest", amount: 2 } : { type: "talk" })])), ctx);
    }
    expect(s.sunk).toBe(false);
    expect(Object.values(s.energy)).toEqual([0, 0, 0]);
    expect(Object.values(club8.result(s).outcomes)).toEqual(["pass", "pass", "pass"]);
  });
});
