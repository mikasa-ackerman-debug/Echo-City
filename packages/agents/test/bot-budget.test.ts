import { describe, expect, it } from "vitest";
import { advance, buildObservation, createCycle, getTrial, Rng, type TrialCtx } from "@echo/engine";
import { RuleBot } from "../src/bots/rule-bot";

const host = { name: "林晚", relation: "助手", memories: ["一"], belief: "合作" };

describe("RuleBot lifeboat energy budget", () => {
  it("all cooperative personas reserve enough fuel for five standard rounds", async () => {
    const personas = ["guardian", "gambler", "diplomat", "martyr", "naive"] as const;
    const cycle = advance(createCycle({ id: "budget", seed: "budget", roster: personas.map((_, i) => ({ id: `a${i}`, name: `Agent${i}`, host })) })).state;
    const def = getTrial("club-8");
    const ctx: TrialCtx = { rng: Rng.fromSeed("boat"), emit: () => {}, names: {}, amendment: null, length: "standard", humanity: () => {}, claim: () => {}, vote: () => {}, leak: () => {} };
    const state = def.setup(cycle.order.map((id) => ({ id, name: cycle.agents[id].name, passphrase: "secret", items: [], humanity: 50, hostName: host.name })), ctx);
    for (let step = 0; step < 20 && !def.isOver(state); step++) {
      const inputs: Record<string, any> = {};
      for (const req of def.requests(state)) {
        const index = Number(req.agentId.slice(1));
        const obs = buildObservation(cycle, req.agentId);
        obs.request_id = `${step}:${req.agentId}`;
        obs.phase = "trial";
        obs.legal_actions = req.legal;
        obs.channels = req.channels;
        obs.trial = { trial_id: "club-8", step: req.step, visible: req.view } as typeof obs.trial;
        const response = await new RuleBot(personas[index]).decide(obs);
        inputs[req.agentId] = { action: response.action, messages: response.messages ?? [], valid: true };
        if (req.step === "invest") expect(response.action.amount).toBe(2);
      }
      def.step(state, inputs, ctx);
    }
    expect(Object.values(def.result(state).outcomes)).toEqual(personas.map(() => "pass"));
  });
});
