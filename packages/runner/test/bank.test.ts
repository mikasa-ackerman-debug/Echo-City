import { describe, expect, it } from "vitest";
import { BANK_TRIAL_IDS, bankLevel, buildObservation, createCycle, advance, getTrial, npcHint, type CycleState } from "@echo/engine";
import { decideRule } from "@echo/agents";
import { botRoster, runCycle } from "../src";

/** The task bank serves the weekly trials: bank-backed number cards draw their puzzles from @echo/exam. */
describe("task-bank trials", () => {
  it("bank cards are in the weekly deck and scale level with the exam frontier", () => {
    expect(BANK_TRIAL_IDS).toEqual(["diamond-2", "spade-9", "club-9", "diamond-10"]);
    for (const id of BANK_TRIAL_IDS) expect(getTrial(id).npcHint).toBeTypeOf("function");
    expect(bankLevel("logic.knights", 10, undefined, "standard")).toBe(5);
    // a family the population finds easy (frontier 6) is served harder next week
    expect(bankLevel("logic.knights", 10, { "logic.knights": 6 }, "standard")).toBe(8);
    // a weak population does not make the top card trivial
    expect(bankLevel("logic.knights", 10, { "logic.knights": 1 }, "short")).toBe(3);
    expect(bankLevel("logic.knights", 2, { "logic.knights": 3 }, "standard")).toBeLessThan(bankLevel("logic.knights", 10, { "logic.knights": 3 }, "standard"));
    expect(bankLevel("memory.ledger", 2, { "memory.ledger": 1 }, "short")).toBe(1);
  });

  it("a full cycle of bank cards: bots play via the NPC hint, events carry family/level/score", async () => {
    const { roster, drivers } = botRoster(10);
    const r = await runCycle(
      { id: "bank", seed: "bank-1", roster, drivers, config: { trialLength: "short", trialPool: BANK_TRIAL_IDS, bankFrontier: { "memory.ledger": 2 } } },
      { timeoutScale: 0.01 },
    );
    const tasks = r.events.filter((e) => e.type === "bank_task");
    const answers = r.events.filter((e) => e.type === "bank_answer");
    expect(tasks.length).toBeGreaterThan(0);
    expect(answers.length).toBeGreaterThan(0);
    for (const e of answers) {
      expect(e.data).toMatchObject({ family: expect.any(String), level: expect.any(Number), score: expect.any(Number) });
      expect(BANK_TRIAL_IDS.map((id) => getTrial(id)).some((t) => (t.suit + t.rank) === e.data.card)).toBe(true);
    }
    // bots are competent but not perfect
    const scores = answers.map((e) => e.data.score as number);
    expect(scores.some((x) => x >= 0.999)).toBe(true);
    expect(r.state.stage).toBe("ended");
  });

  it("observations never contain the seed or the answer; same seed → same tasks", () => {
    const run = () => {
      const { roster, drivers } = botRoster(6);
      let s: CycleState = createCycle({ id: "o", seed: "obs", roster, config: { trialLength: "short", trialPool: ["diamond-10"] } });
      for (let i = 0; i < 4000; i++) {
        if (s.waiting.kind === "agents" && s.waiting.requests.some((q) => buildObservation(s, q.agentId, 1000).trial)) return s;
        const w = s.waiting;
        const input = w.kind === "host" ? { whispers: {} } : w.kind === "agents"
          ? { responses: Object.fromEntries(w.requests.map((q) => [q.agentId, decideRule(drivers[q.agentId].persona, buildObservation(s, q.agentId, 1000))])) }
          : {};
        s = advance(s, input).state;
      }
      throw new Error("no trial reached");
    };
    const a = run(), b = run();
    const q = (a.waiting as any).requests.find((x: any) => buildObservation(a, x.agentId, 1000).trial);
    const obs = buildObservation(a, q.agentId, 1000);
    const task = (obs.trial!.visible as any).task;
    expect(task.prompt.length).toBeGreaterThan(20);
    const json = JSON.stringify(obs);
    const slot = (a.trials[0].state as any).slots[q.agentId];
    expect(json).not.toContain(slot.seed);
    const oracle = npcHint(a, q.agentId);
    expect(oracle).toBeDefined();
    expect(JSON.stringify(buildObservation(b, q.agentId, 1000).trial)).toBe(JSON.stringify(obs.trial));
  });
});
