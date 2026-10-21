import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hashToken, newId, newToken, safeEqual, Sealer } from "./crypto";
import { ApiError, CycleManager, publicAgent, publicTombstone, type ManagerOptions } from "./manager";
import { Store, type UserRec } from "./store";
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
  const store = new Store(opts.dataDir);
  const manager = new CycleManager(store, {
    timeoutScale: opts.timeoutScale ?? 1,
    whisperWindowMs: opts.whisperWindowMs ?? 90000,
    fastStepDelayMs: opts.fastStepDelayMs ?? 0,
    allowInsecureWebhooks: opts.allowInsecureWebhooks ?? false,
    sealer: new Sealer(opts.secretKey),
    now: opts.now,
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
    store.save();
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
      ...c,
      roster: agents.map((a) => {
        const lin = store.lineage(a.lineageId);
        return { id: a.id, name: a.name, mode: a.mode, status: a.status, returned: !!a.returned, host: lin?.host.name, generation: (lin?.generations.length ?? 0) + (a.status === "registered" ? 1 : 0) };
      }),
      live: c.status === "running" ? manager.liveSnapshot(c.id) : null,
      whisper: manager.whisperWindow(c.id),
    };
  };
  route("GET", "/api/cycles", () => store.db.cycles.map((c) => ({ id: c.id, status: c.status, mode: c.mode, startsAt: c.startsAt, endedAt: c.endedAt, agents: c.agentIds.length || store.db.agents.filter((a) => a.cycleId === c.id).length, winner: c.summary?.winner?.name ?? null, ending: c.summary?.ending ?? null, endingTitle: c.summary?.endingTitle ?? null })).reverse());
  route("GET", "/api/cycles/current", () => {
    const c = manager.currentCycle();
    if (!c) throw new ApiError(404, "还没有任何轮回");
    return cycleView(c.id);
  });
  route("GET", "/api/cycles/:id", ({ params }) => cycleView(params.id));
  route("POST", "/api/cycles", ({ body }) => manager.createCycle(body ?? {}), "admin");
  route("POST", "/api/cycles/:id/start", ({ params }) => manager.start(params.id), "admin");
  route("GET", "/api/cycles/:id/events", ({ params, query, user }) => {
    if (!store.cycle(params.id)) throw new ApiError(404, "轮回不存在");
    return manager.visibleEvents(params.id, user, Number(query.get("since") ?? 0) || 0);
  });
  route("GET", "/api/cycles/:id/replay", ({ params, user }) => manager.replay(params.id, user));
  route("GET", "/api/cycles/:id/stream", ({ params, req, res, query, user }) => {
    if (!store.cycle(params.id)) throw new ApiError(404, "轮回不存在");
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(": echo-city stream\n\n");
    const since = Number(query.get("since") ?? req.headers["last-event-id"] ?? 0) || 0;
    const unsub = manager.subscribe(
      params.id,
      user,
      (events) => {
        for (const e of events) res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      },
      since,
    );
    const ping = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15000);
    req.on("close", () => {
      clearInterval(ping);
      unsub();
    });
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

  /* ---------------- dispatch ---------------- */
  const authUser = (req: IncomingMessage, query: URLSearchParams): UserRec | undefined => {
    const h = req.headers.authorization;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : query.get("token");
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
      const user = authUser(req, url.searchParams);
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

  return { server, store, manager };
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
