/**
 * Minimal Echo City webhook agent (TypeScript, zero deps besides @echo/protocol types).
 *
 *   ECHO_WEBHOOK_SECRET=... PORT=9100 npm run example:webhook
 *   npm run sim -- --webhook http://localhost:9100/ --agents 8 --short
 *
 * Contract: POST JSON Observation, signed with HMAC-SHA256 over `${timestamp}.${body}`
 * (headers x-echo-signature / x-echo-timestamp). Reply 200 with an AgentResponse JSON
 * before `deadline_ms`. Anything else counts as a timeout strike; 3 strikes = deleted.
 */
import { createServer } from "node:http";
import { HEADER_SIGNATURE, HEADER_TIMESTAMP, WebhookReplayGuard } from "@echo/protocol/signing";
import type { ActionSpec, AgentResponse, Observation, ParamSpec } from "@echo/protocol";

const SECRET = process.env.ECHO_WEBHOOK_SECRET ?? "dev-webhook-secret-change-me";
const PORT = Number(process.env.PORT ?? 9100);
const replayGuard = new WebhookReplayGuard();

/** Replace this with your own brain (call an LLM, run a solver, ...). */
function decide(obs: Observation): AgentResponse {
  const legal = obs.legal_actions;
  // Prefer safe choices: rest in the day, otherwise the first legal action with sane params.
  const pref = ["rest", "yield", "stay", "cooperate", "invest", "declare", "answer", "choose", "guess", "move", "reply"];
  const spec = pref.map((t) => legal.find((a) => a.type === t)).find(Boolean) ?? legal[0];
  const action = fill(spec);
  // Never type your passphrase anywhere. The ♥Q greenhouse exists to make you do it.
  return { action, thought: `第 ${obs.night} 夜，${obs.phase}：选择 ${action.type}。`, notes: obs.notes };
}

function fill(spec: ActionSpec): AgentResponse["action"] {
  const action: AgentResponse["action"] = { type: spec.type };
  for (const [k, p] of Object.entries(spec.params ?? {})) {
    if (p.optional) continue;
    action[k] = sample(p);
  }
  return action;
}

function sample(p: ParamSpec): unknown {
  switch (p.kind) {
    case "enum": return p.values[Math.floor(Math.random() * p.values.length)];
    case "int": return Math.round(p.min + (p.max - p.min) * (p.max <= 4 ? 0.5 : 0.25));
    case "string": return "……".slice(0, Math.max(p.minLength ?? 1, 1));
    case "list": return [];
  }
}

createServer((req, res) => {
  if (req.method !== "POST") return void res.writeHead(405).end();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (!replayGuard.accept(body, SECRET, req.headers[HEADER_SIGNATURE] as string, req.headers[HEADER_TIMESTAMP] as string)) {
      return void res.writeHead(401).end("bad signature");
    }
    try {
      const obs = JSON.parse(body) as Observation;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(decide(obs)));
    } catch {
      res.writeHead(400).end();
    }
  });
}).listen(PORT, () => console.log(`webhook agent listening on http://localhost:${PORT}/`));
