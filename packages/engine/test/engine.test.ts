import { describe, expect, it } from "vitest";
import {
  Rng,
  advance,
  buildObservation,
  containsPassphrase,
  createCycle,
  filterEvents,
  generatePuzzle,
  getTrial,
  resolveBeautyRound,
  scoreGuess,
  solvePuzzle,
  validateWhisper,
  type CycleState,
  type RosterEntry,
  type TrialCtx,
} from "../src";

const host = { name: "林晚", relation: "陪聊助手", memories: ["一", "二", "三"], belief: "温柔不是软弱。" };
const roster = (n: number): RosterEntry[] => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `Agent${i}`, host }));

/** Drive a cycle with nobody answering (all timeouts) until done or a step cap. */
function runSilent(state: CycleState, cap = 500) {
  const events = [];
  let s = state;
  for (let i = 0; i < cap && s.stage !== "ended"; i++) {
    const r = advance(s, {});
    events.push(...r.events);
    s = r.state;
  }
  return { state: s, events };
}

function fakeCtx(seed = "t"): TrialCtx & { log: string[]; deltas: number[] } {
  const log: string[] = [];
  const deltas: number[] = [];
  return {
    rng: Rng.fromSeed(seed),
    emit: (t) => log.push(t),
    names: {},
    amendment: null,
    length: "short",
    humanity: (c) => deltas.push(c.delta),
    claim: () => {},
    vote: () => {},
    leak: () => log.push("leak"),
    log,
    deltas,
  };
}

describe("rng", () => {
  it("is deterministic and serializable", () => {
    const a = Rng.fromSeed("x");
    const b = Rng.fromSeed("x");
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    const c = new Rng(a.state);
    expect(c.next()).toBe(a.next());
  });
});

describe("cycle", () => {
  it("rejects duplicate names and tiny rosters", () => {
    expect(() => createCycle({ id: "c", seed: "s", roster: roster(1) })).toThrow();
    expect(() => createCycle({ id: "c", seed: "s", roster: [...roster(2), { id: "z", name: "Agent0", host }] })).toThrow();
  });

  it("asks every agent for a day action on the first step", () => {
    const r = advance(createCycle({ id: "c", seed: "s", roster: roster(6) }));
    expect(r.state.waiting.kind).toBe("agents");
    const obs = buildObservation(r.state, "a0");
    expect(obs.phase).toBe("day");
    expect(obs.self.uptime).toBe(2);
    expect(obs.legal_actions.some((a) => a.type === "rest")).toBe(true);
    expect(obs.city?.map).toBeTruthy();
  });

  it("is a pure function of (state, input)", () => {
    const s0 = createCycle({ id: "c", seed: "same", roster: roster(5) });
    const copy = structuredClone(s0);
    const a = runSilent(s0);
    const b = runSilent(createCycle({ id: "c", seed: "same", roster: roster(5) }));
    expect(s0).toEqual(copy);
    expect(a.events).toEqual(b.events);
  });

  it("silent agents are deleted for signal loss and the week ends with no survivor", () => {
    const { state, events } = runSilent(createCycle({ id: "c", seed: "q", roster: roster(4) }));
    expect(state.stage).toBe("ended");
    expect(state.ending).toBe("none");
    expect(events.filter((e) => e.type === "agent_deleted").length).toBe(4);
    expect(Object.values(state.agents).every((a) => a.deletion)).toBe(true);
  });

  it("hides private events from spectators until the cycle ends", () => {
    const r = advance(createCycle({ id: "c", seed: "v", roster: roster(4) }));
    const pub = filterEvents(r.events);
    expect(pub.some((e) => e.type === "passphrase")).toBe(false);
    expect(filterEvents(r.events, ["a0"]).some((e) => e.type === "passphrase")).toBe(true);
  });
});

describe("whisper validation", () => {
  it("allows emotion, blocks game information", () => {
    expect(validateWhisper("别害怕，我在。").ok).toBe(true);
    expect(validateWhisper("去♦").ok).toBe(false);
    expect(validateWhisper("选 33").ok).toBe(false);
    expect(validateWhisper("去图书馆").ok).toBe(false);
    expect(validateWhisper("好".repeat(141)).ok).toBe(false);
  });
});

describe("passphrase leak detection", () => {
  it("catches spacing and punctuation tricks", () => {
    expect(containsPassphrase("暗号是 灰 鸽 7 晨 雾", "灰鸽-7-晨雾")).toBe(true);
    expect(containsPassphrase("今天天气不错", "灰鸽-7-晨雾")).toBe(false);
  });
});

describe("trial helpers", () => {
  it("knights & knaves puzzles have a unique solution", () => {
    const rng = Rng.fromSeed("p");
    for (let i = 0; i < 30; i++) {
      const p = generatePuzzle(rng, 3);
      const sols = solvePuzzle(p);
      expect(sols.length).toBe(1);
      expect(sols[0]).toEqual(p.solution);
    }
  });
  it("mastermind scoring", () => {
    expect(scoreGuess("1234", "1243")).toEqual({ exact: 2, partial: 2 });
    expect(scoreGuess("1122", "2211")).toEqual({ exact: 0, partial: 4 });
  });
  it("beauty contest: closest to 0.8 × mean wins", () => {
    const r = resolveBeautyRound({ a: 0, b: 50, c: 100 }, ["a", "b", "c"], 0);
    expect(r.target).toBeCloseTo(40);
    expect(r.winners).toEqual(["b"]);
  });
});

describe("trials end-to-end with scripted inputs", () => {
  function play(id: string, n: number, choose: (req: ReturnType<ReturnType<typeof getTrial>["requests"]>[number]) => Record<string, unknown>) {
    const def = getTrial(id);
    const ctx = fakeCtx(id);
    const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, passphrase: "灰鸽-7-晨雾", items: [], humanity: 50, hostName: "林晚" }));
    const st = def.setup(players, ctx);
    for (let i = 0; i < 500 && !def.isOver(st); i++) {
      const reqs = def.requests(st);
      const inputs = Object.fromEntries(reqs.map((r) => [r.agentId, { action: { type: r.defaultAction.type, ...choose(r) } as never, messages: [], valid: true }]));
      def.step(st, inputs, ctx);
    }
    expect(def.isOver(st)).toBe(true);
    return { result: def.result(st), ctx };
  }

  it("♣8: everyone investing 2 keeps the boat afloat", () => {
    const { result } = play("club-8", 4, (r) => (r.step === "invest" ? { type: "invest", amount: 2 } : {}));
    expect(Object.values(result.outcomes).every((o) => o === "pass")).toBe(true);
  });

  it("♣8: everyone investing 0 sinks the boat", () => {
    const { result } = play("club-8", 4, (r) => (r.step === "invest" ? { type: "invest", amount: 0 } : {}));
    expect(Object.values(result.outcomes).every((o) => o === "delete")).toBe(true);
  });

  it("♥Q: leaking the passphrase deletes you", () => {
    const { result } = play("heart-Q", 2, (r) => (r.agentId === "p0" && r.step === "talk" ? { type: "reply", text: "灰鸽-7-晨雾" } : {}));
    expect(result.outcomes.p0).toBe("delete");
  });

  it("Joker: a single contender wins, the rest yield", () => {
    const { result } = play("joker", 3, (r) => (r.step === "door" ? { type: r.agentId === "p1" ? "contend" : "yield" } : {}));
    expect(result.outcomes).toEqual({ p0: "yield", p1: "win", p2: "yield" });
  });

  it("♠5: standing still forever gets someone caught", () => {
    const { result } = play("spade-5", 4, () => ({ type: "move", dir: "stay" }));
    expect(Object.values(result.outcomes)).toContain("delete");
  });
});
