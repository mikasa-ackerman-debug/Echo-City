import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hashToken, newId, newToken, safeEqual, Sealer } from "./crypto";
import { ApiError, CycleManager, publicAgent, publicTombstone, publicData, type ManagerOptions } from "./manager";
import { Store, type UserRec } from "./store";
import { ExamService } from "./exam";
import { sanitizeText } from "@echo/protocol";

export interface AppOptions extends Partial<Omit<ManagerOptions, "sealer">> {
  dataDir: string | null;
  adminToken: string;
  secretKey: string;
  corsOrigin?: string;
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown;
interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  user?: UserRec;
  admin: boolean;
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  auth?: "user" | "admin";
}

export function createApp(opts: AppOptions) {
  if (process.env.NODE_ENV === "production" && (opts.adminToken.length < 32 || opts.secretKey.length < 32 || opts.allowInsecureWebhooks || !opts.corsOrigin || opts.corsOrigin === "*"))
    throw new Error("Production requires strong admin/encryption keys, explicit CORS origin and HTTPS-only agents");
  for (const [key, value] of Object.entries({ timeoutScale: opts.timeoutScale, whisperWindowMs: opts.whisperWindowMs, fastStepDelayMs: opts.fastStepDelayMs }))
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || (key === "timeoutScale" && value === 0))) throw new Error(`Invalid ${key}`);
  const ticketNow = () => opts.now?.().getTime() ?? Date.now();
  const tickets = new Map<string, { userId: string; cycleId: string; expires: number }>();
  const rates = new Map<string, { count: number; until: number }>();
  let streams = 0;
  const store = new Store(opts.dataDir);
  const exam = new ExamService({ dataDir: opts.dataDir, sealer: new Sealer(opts.secretKey), secret: opts.secretKey, allowHttp: opts.allowInsecureWebhooks ?? false, agent: (id) => store.agent(id) });
  const manager = new CycleManager(store, {
    timeoutScale: opts.timeoutScale ?? 1,
    whisperWindowMs: opts.whisperWindowMs ?? 90000,
    fastStepDelayMs: opts.fastStepDelayMs ?? 0,
    allowInsecureWebhooks: opts.allowInsecureWebhooks ?? false,
    sealer: new Sealer(opts.secretKey),
    now: opts.now,
    bank: { frontier: () => exam.frontiers(), record: (answers) => exam.recordTrialAnswers(answers) },
  });
  const routes: Route[] = [];
  const route = (method: string, path: string, handler: Handler, auth?: Route["auth"]) => {
    const keys: string[] = [];
    const pattern = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
    routes.push({ method, pattern, keys, handler, auth });
  };

  /* ---------------- meta ---------------- */
  route("GET", "/api/health", () => ({ ok: true, cycles: store.db.cycles.length }));

  /* ---------------- users ---------------- */
  route("POST", "/api/users", ({ body }) => {
    const name = sanitizeText(body?.name, 24);
    if (!name) throw new ApiError(400, "需要 name");
    const token = newToken();
    const user: UserRec = { id: newId("u"), name, tokenHash: hashToken(token), createdAt: new Date().toISOString() };
    store.db.users.push(user);
    store.flush();
    return { user: { id: user.id, name: user.name }, token };
  });
  route("GET", "/api/me", ({ user }) => {
    const u = user!;
    return {
      user: { id: u.id, name: u.name },
      lineages: store.db.lineages.filter((l) => l.ownerId === u.id),
      agents: store.db.agents.filter((a) => a.ownerId === u.id).map(publicAgent),
    };
  }, "user");

  /* ---------------- cycles ---------------- */
  const cycleView = (id: string) => {
    const c = store.cycle(id);
    if (!c) throw new ApiError(404, "轮回不存在");
    const agents = store.db.agents.filter((a) => a.cycleId === c.id);
    return {
      ...publicData(c),
      roster: agents.map((a) => {
        const lin = store.lineage(a.lineageId);
        return { id: a.id, name: a.name, mode: a.mode, status: a.status, returned: !!a.returned, host: lin?.host.name, generation: a.generation ?? lin?.generations.find((g) => g.agentId === a.id)?.generation ?? ((lin?.generations.at(-1)?.generation ?? 0) + (a.returned ? 0 : 1)) };
      }),
      live: c.status === "running" ? manager.liveSnapshot(c.id) : null,
      whisper: manager.whisperWindow(c.id),
    };
  };
  route("GET", "/api/cycles", () => store.db.cycles.filter((c) => !c.demo).map((c) => ({ id: c.id, status: c.status, mode: c.mode, startsAt: c.startsAt, endedAt: c.endedAt, agents: c.agentIds.length || store.db.agents.filter((a) => a.cycleId === c.id).length, winner: c.summary?.winner?.name ?? null, ending: c.summary?.ending ?? null, endingTitle: c.summary?.endingTitle ?? null })).reverse());
  route("GET", "/api/cycles/current", () => {
    const c = manager.currentCycle();
    if (!c) throw new ApiError(404, "还没有任何轮回");
    return cycleView(c.id);
  });
  route("GET", "/api/cycles/:id", ({ params }) => cycleView(params.id));
  route("POST", "/api/cycles", ({ body }) => publicData(manager.createCycle(body ?? {})), "admin");
  route("POST", "/api/cycles/:id/start", ({ params }) => publicData(manager.start(params.id)), "admin");
  // Admin demo backdoor: a private compressed week (own agent + mock bots), hidden from public lists.
  route("POST", "/api/demo/cycles", ({ body }) => publicData(manager.createDemoCycle({ speed: Number(body?.speed), fillBots: Number(body?.fillBots) })), "admin");
  route("POST", "/api/demo/cycles/:id/start", ({ params }) => publicData(manager.startDemo(params.id)), "admin");
  route("GET", "/api/cycles/:id/events", ({ params, query, user }) => {
    if (!store.cycle(params.id)) throw new ApiError(404, "轮回不存在");
    return publicData(manager.visibleEvents(params.id, user, parseCursor(query.get("since"))));
  });
  route("GET", "/api/cycles/:id/replay", ({ params, user }) => manager.replay(params.id, user));
  route("POST", "/api/stream-ticket", ({ body, user }) => {
    const cycleId = String(body?.cycleId ?? "");
    if (!store.cycle(cycleId)) throw new ApiError(404, "轮回不存在");
    const now = ticketNow();
    for (const [token, t] of tickets) if (t.expires <= now) tickets.delete(token);
    if (tickets.size >= 4096) throw new ApiError(429, "Too many stream tickets");
    const ticket = newToken(); const expires = now + 60000;
    tickets.set(hashToken(ticket), { userId: user!.id, cycleId, expires });
    return { ticket, expiresAt: new Date(expires).toISOString() };
  }, "user");
  route("GET", "/api/cycles/:id/stream", ({ params, req, res, query, user }) => {
    if (!store.cycle(params.id)) throw new ApiError(404, "轮回不存在");
    if (streams >= 256) throw new ApiError(429, "Too many streams");
    const since = parseCursor(query.get("since") ?? req.headers["last-event-id"]);
    streams++;
    let closed = false; let unsub = () => {}; let ping: NodeJS.Timeout | undefined;
    const cleanup = () => { if (closed) return; closed = true; streams--; if (ping) clearInterval(ping); unsub(); };
    let blocked = false; let queuedBytes = 0; const queue: string[] = [];
    const write = (text: string) => {
      if (closed) return;
      if (blocked) {
        queuedBytes += Buffer.byteLength(text);
        if (queuedBytes > 2 * 1024 * 1024) { cleanup(); res.destroy(); return; }
        queue.push(text); return;
      }
      blocked = !res.write(text);
    };
    res.on("drain", () => {
      blocked = false;
      while (!closed && !blocked && queue.length) {
        const text = queue.shift()!; queuedBytes -= Buffer.byteLength(text); write(text);
      }
    });
    req.once("close", cleanup); res.once("error", cleanup);
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    write(": echo-city stream\n\n");
    unsub = manager.subscribe(params.id, user, (events) => {
      for (const e of events) write(`id: ${e.deliveryCursor}\nevent: ${e.type}\ndata: ${JSON.stringify(publicData(e))}\n\n`);
    }, since);
    if (closed) unsub();
    else ping = setInterval(() => write(`: ping ${Date.now()}\n\n`), 15000);
    return STREAM;
  });
  route("GET", "/api/cycles/:id/whisper", ({ params, user }) => manager.whisperWindow(params.id, user), "user");
  route("POST", "/api/cycles/:id/whisper", ({ params, body, user }) => manager.submitWhisper(user!, params.id, String(body?.agentId ?? ""), String(body?.text ?? "")), "user");

  /* ---------------- lineages & agents ---------------- */
  route("POST", "/api/lineages", ({ body, user }) => manager.createLineage(user!, body?.host ?? body), "user");
  route("GET", "/api/lineages/:id", ({ params }) => {
    const l = store.lineage(params.id);
    if (!l) throw new ApiError(404, "谱系不存在");
    // Public view: the bloodline story (GDD 11). Host memories stay private to the owner.
    const owner = store.user(l.ownerId);
    return { id: l.id, owner: owner?.name, host: { name: l.host.name, relation: l.host.relation, belief: l.host.belief }, generations: l.generations };
  });
  route("POST", "/api/agents", async ({ body, user }) => {
    const r = manager.register(user!, body ?? {});
    return { agent: publicAgent(r.agent), webhookSecret: r.webhookSecret };
  }, "user");
  route("DELETE", "/api/agents/:id", ({ params, user }) => (manager.withdraw(user!, params.id), { ok: true }), "user");
  route("POST", "/api/agents/:id/test", ({ params, user }) => manager.testAgent(user!, params.id), "user");

  /* ---------------- graveyard ---------------- */
  route("GET", "/api/graveyard", ({ query }) => manager.graveyard({ cycleId: query.get("cycle") ?? undefined, lineageId: query.get("lineage") ?? undefined, limit: Number(query.get("limit") ?? 200) || 200 }));
  route("GET", "/api/tombstones/:agentId", ({ params }) => {
    const t = store.db.tombstones.find((x) => x.agentId === params.agentId);
    if (!t) throw new ApiError(404, "墓碑不存在");
    return publicTombstone(t);
  });
  route("POST", "/api/tombstones/:agentId/letter", ({ params, body, user }) => manager.writeLetter(user!, params.agentId, String(body?.text ?? "")), "user");

  /* ---------------- exam: standing ability assessment ---------------- */
  route("GET", "/api/exam/library", () => exam.library());
  route("GET", "/api/exam/ladder", () => exam.ladder());
  route("GET", "/api/exam/sessions", ({ query }) => exam.recent(Math.min(100, Number(query.get("limit") ?? 30) || 30)));
  route("GET", "/api/exam/sessions/:id", ({ params }) => {
    const s = exam.session(params.id);
    if (!s) throw new ApiError(404, "考试不存在");
    return exam.publicSession(s);
  });
  route("GET", "/api/exam/examinees/mine", ({ user }) => exam.mine(user!.id), "user");
  route("GET", "/api/exam/examinees/:id", ({ params }) => exam.profile(params.id));
  route("POST", "/api/exam/examinees", ({ body, user }) => exam.createExaminee(user!.id, body ?? {}), "user");
  route("DELETE", "/api/exam/examinees/:id", ({ params, user }) => (exam.removeExaminee(user!.id, params.id), { ok: true }), "user");
  route("POST", "/api/exam/sessions", ({ body, user }) => exam.publicSession(exam.startSession(user!.id, String(body?.examineeId ?? ""), Number(body?.size ?? 12) || 12)), "user");
  route("GET", "/api/exam/sessions/:id/next", ({ params, user }) => exam.next(user!.id, params.id), "user");
  route("POST", "/api/exam/sessions/:id/answer", ({ params, body, user }) => exam.answer(user!.id, params.id, String(body?.task_id ?? ""), body?.answer), "user");
  route("POST", "/api/exam/sessions/:id/abort", ({ params, user }) => exam.abort(user!.id, params.id), "user");
  route("GET", "/api/exam/practice", ({ query }) => exam.practiceTask(String(query.get("family") ?? ""), Number(query.get("level") ?? 1) || 1, String(query.get("seed") ?? "0")));
  route("POST", "/api/exam/practice", ({ body }) => exam.practiceGrade(String(body?.family ?? ""), Number(body?.level ?? 1) || 1, String(body?.seed ?? "0"), body?.answer));

  /* ---------------- dispatch ---------------- */
  const authUser = (req: IncomingMessage, query: URLSearchParams): UserRec | undefined => {
    const h = req.headers.authorization;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : undefined;
    if (!token) return undefined;
    const hash = hashToken(token);
    return store.db.users.find((u) => u.tokenHash === hash);
  };

  const server: Server = createServer(async (req, res) => {
    const origin = opts.corsOrigin ?? "*";
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-headers", "authorization, content-type, x-admin-token, last-event-id");
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://local");
    const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname));
    try {
      if (!r) throw new ApiError(404, "not found");
      const m = url.pathname.match(r.pattern)!;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let user = authUser(req, url.searchParams);
      if (url.searchParams.has("token")) throw new ApiError(400, "Long-lived tokens in URLs are forbidden; use stream-ticket");
      if (url.pathname.endsWith("/stream") && url.searchParams.has("ticket")) {
        const hash = hashToken(url.searchParams.get("ticket")!); const ticket = tickets.get(hash);
        if (!ticket || ticket.expires <= ticketNow() || ticket.cycleId !== params.id) throw new ApiError(401, "Invalid or expired stream ticket");
        tickets.delete(hash); user = store.user(ticket.userId);
        if (!user) throw new ApiError(401, "Invalid stream user");
      }
      const now = Date.now();
      const key = user?.id ?? req.socket.remoteAddress ?? "unknown";
      let rate = rates.get(key);
      if (!rate || rate.until <= now) {
        if (rates.size >= 10000) for (const [id, value] of rates) if (value.until <= now) rates.delete(id);
        if (rates.size >= 10000 && !rates.has(key)) throw new ApiError(429, "Rate limiter capacity exceeded");
        rates.set(key, rate = { count: 0, until: now + 60000 });
      }
      const cost = req.method === "POST" ? 10 : 1;
      rate.count += cost;
      if (rate.count > 1200) { res.setHeader("retry-after", Math.ceil((rate.until - now) / 1000)); throw new ApiError(429, "Too many requests"); }
      const adminHeader = String(req.headers["x-admin-token"] ?? "");
      const admin = !!opts.adminToken && !!adminHeader && safeEqual(adminHeader, opts.adminToken);
      if (r.auth === "user" && !user) throw new ApiError(401, "需要登录（Authorization: Bearer <token>）");
      if (r.auth === "admin" && !admin) throw new ApiError(403, "需要管理员令牌");
      const body = req.method === "POST" ? await readJson(req) : undefined;
      const out = await r.handler({ req, res, params, query: url.searchParams, body, user, admin });
      if (out === STREAM) return;
      send(res, 200, out);
    } catch (err) {
      if (err instanceof ApiError) send(res, err.status, { error: err.message });
      else {
        console.error(err);
        send(res, 500, { error: "internal error" });
      }
    }
  });

  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 64;
  return { server, store, manager, exam };
}

const STREAM = Symbol("stream");

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body ?? null));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 256 * 1024) throw new ApiError(413, "请求体过大");
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "JSON 无效");
  }
}

function parseCursor(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(400, "Invalid delivery cursor");
  return value;
}
