import { describe, expect, it } from "vitest";
import { botRoster, buildReplay, runCycle } from "../src";

describe("runner", () => {
  it("runs a full week of bots to an ending, deterministically", async () => {
    const go = async () => {
      const { roster, drivers } = botRoster(10);
      return runCycle({ id: "r", seed: "regress", roster, drivers, config: { trialLength: "short" } }, { timeoutScale: 0.01 });
    };
    const a = await go();
    const b = await go();
    expect(a.state.stage).toBe("ended");
    expect(a.state.ending).toBeTruthy();
    expect(a.events.map((e) => e.type)).toEqual(b.events.map((e) => e.type));
    const types = new Set(a.events.map((e) => e.type));
    for (const t of ["cycle_start", "dawn", "trial_start", "trial_end", "agent_deleted", "cycle_end"]) expect(types.has(t), t).toBe(true);
    const replay = buildReplay(a.state, a.events);
    expect(replay.format).toBe("echo-replay/1");
    expect(replay.agents).toHaveLength(10);
    expect(replay.summary.tombstones.length).toBeGreaterThan(0);
  });

  it("produces a winner in most seeds", async () => {
    let winners = 0;
    for (let i = 0; i < 6; i++) {
      const { roster, drivers } = botRoster(12);
      const r = await runCycle({ id: `w${i}`, seed: `w${i}`, roster, drivers, config: { trialLength: "short" } }, { timeoutScale: 0.01 });
      if (r.state.winner) winners++;
    }
    expect(winners).toBeGreaterThanOrEqual(3);
  });
});
