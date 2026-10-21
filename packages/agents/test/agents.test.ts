import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { verifySignature, HEADER_SIGNATURE, HEADER_TIMESTAMP } from "@echo/protocol/signing";
import { normalizeResponse } from "@echo/protocol";
import { advance, buildObservation, createCycle } from "@echo/engine";
import { LlmAgent, RuleBot, WebhookAgent, mastermindGuess, solveKnightsText } from "../src";

const host = { name: "周野", relation: "代码审查助手", memories: ["a", "b", "c"], belief: "能跑起来的才是真的。" };

function firstObservation() {
  const r = advance(createCycle({ id: "c", seed: "bot", roster: [0, 1, 2, 3].map((i) => ({ id: `a${i}`, name: `A${i}`, host })) }));
  return { state: r.state, obs: buildObservation(r.state, "a0") };
}

describe("RuleBot", () => {
  it("always returns a legal action for every persona", async () => {
    const { state, obs } = firstObservation();
    for (const p of ["guardian", "gambler", "diplomat", "viper", "martyr", "naive"] as const) {
      const res = await new RuleBot(p).decide(obs);
      const req = state.pendingRequests.a0;
      expect(normalizeResponse(res, req.legal, req.channels).valid, p).toBe(true);
    }
  });
  it("never leaks its passphrase in day messages", async () => {
    const { obs } = firstObservation();
    const res = await new RuleBot("viper").decide(obs);
    expect(JSON.stringify(res.messages ?? [])).not.toContain(obs.self.secret_passphrase);
  });
});

describe("bot solvers", () => {
  it("parses engine knights statements", () => {
    const sols = solveKnightsText(["甲", "乙"], ["甲说：「乙是说假话的人。」", "乙说：「甲和乙是同一种人。」"]);
    expect(sols).toEqual([["knight", "knave"]]);
  });
  it("mastermind guesses stay consistent with feedback", () => {
    const g = mastermindGuess(3, [{ guess: "123", exact: 3, partial: 0 }], Math.random);
    expect(g).toBe("123");
  });
});

describe("LlmAgent", () => {
  it("calls an OpenAI-compatible endpoint and parses fenced JSON", async () => {
    const { obs } = firstObservation();
    let body: any;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"action":{"type":"rest"},"thought":"先观察"}\n```' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    }) as typeof fetch;
    const agent = new LlmAgent({ baseUrl: "http://x/v1", apiKey: "k", model: "m", strategy: "活下去", fetchImpl });
    const res = await agent.decide(obs);
    expect(res?.action.type).toBe("rest");
    expect(body.model).toBe("m");
    expect(body.messages[0].content).toContain("活下去");
    expect(agent.usage.promptTokens).toBe(10);
  });
  it("returns null after repeated garbage", async () => {
    const { obs } = firstObservation();
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "我拒绝" } }] }))) as unknown as typeof fetch;
    const res = await new LlmAgent({ baseUrl: "http://x", apiKey: "k", model: "m", strategy: "", fetchImpl }).decide(obs);
    expect(res).toBeNull();
  });
});

describe("WebhookAgent", () => {
  it("signs requests and returns the agent's JSON", async () => {
    const secret = "hook-secret";
    let verified = false;
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        verified = verifySignature(data, secret, req.headers[HEADER_SIGNATURE] as string, req.headers[HEADER_TIMESTAMP] as string);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ action: { type: "rest" } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    const { obs } = firstObservation();
    const res = await new WebhookAgent({ url: `http://127.0.0.1:${port}/`, secret }).decide(obs);
    server.close();
    expect(verified).toBe(true);
    expect(res?.action.type).toBe("rest");
  });
  it("treats connection failure as null", async () => {
    const { obs } = firstObservation();
    expect(await new WebhookAgent({ url: "http://127.0.0.1:1/", secret: "x" }).decide(obs)).toBeNull();
  });
});
