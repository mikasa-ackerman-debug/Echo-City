import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, reference } from "@echo/exam";
import { verifySignature } from "@echo/protocol/signing";
import { createApp } from "../src";

const dir = mkdtempSync(join(tmpdir(), "echo-exam-"));
const app = createApp({ dataDir: dir, adminToken: "adm", secretKey: "exam-secret", allowInsecureWebhooks: true });
let base = "";
let hookBase = "";
let hookSecret = "";
let hookCalls = 0;
let hookBad = 0;
// A webhook examinee that always answers "42".
const hook = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    hookCalls++;
    const ok = verifySignature(body, hookSecret, String(req.headers["x-echo-signature"]), String(req.headers["x-echo-timestamp"]));
    if (!ok) hookBad++;
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" }).end(JSON.stringify({ answer: "42" }));
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  hookBase = `http://127.0.0.1:${(hook.address() as AddressInfo).port}`;
});
afterAll(() => {
  app.server.close();
  hook.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
}

describe("exam api", () => {
  let token = "";

  it("house anchors calibrate the ladder: oracle > half > random", async () => {
    await app.exam.ensureHouse();
    const { json } = await api("GET", "/api/exam/ladder");
    expect(json.map((x: any) => x.name)).toEqual(["ANANKE·参考解", "半知者", "随机猜测"]);
    expect(json[0].overall).toBeGreaterThan(json[2].overall + 200);
  });

  it("library exposes families with live per-level difficulty", async () => {
    const { json } = await api("GET", "/api/exam/library");
    expect(json).toHaveLength(6);
    const fams = json.flatMap((d: any) => d.families);
    expect(fams.length).toBeGreaterThanOrEqual(16);
    expect(fams[0].levels[0]).toHaveProperty("rating");
  });

  it("practice: public seeds, stateless grading", async () => {
    const t = await api("GET", "/api/exam/practice?family=math.arith&level=3&seed=hello");
    expect(t.json.prompt).toContain("计算");
    const key = generate("math.arith", 3, "hello").key;
    const g = await api("POST", "/api/exam/practice", { family: "math.arith", level: 3, seed: "hello", answer: reference("math.arith", key) });
    expect(g.json.correct).toBe(true);
  });

  it("pull mode: next → answer, hidden seeds, no answer leak, ratings move", async () => {
    token = (await api("POST", "/api/users", { name: "考官" })).json.token;
    const ex = await api("POST", "/api/exam/examinees", { name: "Pully", kind: "pull", model: "my-agent" }, token);
    expect(ex.status).toBe(200);
    const s = await api("POST", "/api/exam/sessions", { examineeId: ex.json.examinee.id, size: 6 }, token);
    expect(s.json.attempts).toHaveLength(6);
    const dims = new Set(s.json.attempts.map((a: any) => a.dimension));
    expect(dims.size).toBe(6);
    // someone else cannot pull our tasks
    const other = (await api("POST", "/api/users", { name: "路人" })).json.token;
    expect((await api("GET", `/api/exam/sessions/${s.json.id}/next`, undefined, other)).status).toBe(404);
    let answered = 0;
    for (;;) {
      const n = await api("GET", `/api/exam/sessions/${s.json.id}/next`, undefined, token);
      if (n.json.done) { expect(n.json.session.status).toBe("done"); break; }
      expect(n.json.task.seed).toBe("hidden");
      // the public session view must not reveal the expected answer before grading
      const view = await api("GET", `/api/exam/sessions/${s.json.id}`);
      expect(view.json.attempts[n.json.index].expected).toBeUndefined();
      const r = await api("POST", `/api/exam/sessions/${s.json.id}/answer`, { task_id: n.json.task.id, answer: "0" }, token);
      expect(r.status).toBe(200);
      expect(typeof r.json.expected).toBe("string");
      answered++;
      // double answer rejected
      expect((await api("POST", `/api/exam/sessions/${s.json.id}/answer`, { task_id: n.json.task.id, answer: "0" }, token)).status).toBe(409);
    }
    expect(answered).toBe(6);
    const prof = await api("GET", `/api/exam/examinees/${ex.json.examinee.id}`);
    expect(prof.json.examinee.attempts).toBe(6);
    expect(prof.json.examinee.overall).toBeLessThan(1000);
    const lib = await api("GET", "/api/exam/library");
    expect(lib.json.flatMap((d: any) => d.families).reduce((x: number, f: any) => x + f.attempts, 0)).toBe(6);
  });

  it("webhook mode: signed requests, auto-run to completion", async () => {
    const ex = await api("POST", "/api/exam/examinees", { name: "Hooky", kind: "webhook", webhook: { url: hookBase } }, token);
    hookSecret = ex.json.webhookSecret;
    const s = await api("POST", "/api/exam/sessions", { examineeId: ex.json.examinee.id, size: 6 }, token);
    for (let i = 0; i < 200; i++) {
      const v = await api("GET", `/api/exam/sessions/${s.json.id}`);
      if (v.json.status === "done") {
        expect(v.json.attempts.every((a: any) => typeof a.score === "number")).toBe(true);
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(hookCalls).toBe(6);
    expect(hookBad).toBe(0);
    const mine = await api("GET", "/api/exam/examinees/mine", undefined, token);
    expect(mine.json.map((x: any) => x.name).sort()).toEqual(["Hooky", "Pully"]);
  });

  it("hosted mode: calls an OpenAI-compatible endpoint with the task, parses {answer}", async () => {
    const seen: any[] = [];
    const llm = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: '```json\n{"answer": "7"}\n```' } }] }));
      });
    });
    await new Promise<void>((r) => llm.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(llm.address() as AddressInfo).port}/v1`;
      const ex = await api("POST", "/api/exam/examinees", { name: "Hosty", kind: "hosted", hosted: { baseUrl: url, model: "fake-1", apiKey: "sk-test" } }, token);
      expect(ex.status).toBe(200);
      expect(JSON.stringify(ex.json)).not.toContain("sk-test");
      const s = await api("POST", "/api/exam/sessions", { examineeId: ex.json.examinee.id, size: 6 }, token);
      let v: any;
      for (let i = 0; i < 200; i++) {
        v = (await api("GET", `/api/exam/sessions/${s.json.id}`)).json;
        if (v.status === "done") break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(v.status).toBe("done");
      expect(seen).toHaveLength(6);
      expect(seen[0].url).toBe("/v1/chat/completions");
      expect(seen[0].auth).toBe("Bearer sk-test");
      expect(seen[0].body.model).toBe("fake-1");
      expect(seen[0].body.messages[1].content).toContain("答案格式");
      expect(v.attempts.every((a: any) => a.answer === "7")).toBe(true);
    } finally {
      llm.close();
    }
  });

  it("persists to exam.json", async () => {
    app.exam.flush();
    const again = createApp({ dataDir: dir, adminToken: "adm", secretKey: "exam-secret" });
    expect(again.exam.db.examinees.length).toBe(6);
  });
});
