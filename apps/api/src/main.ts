import { createApp } from "./server";
import { nextMonday1900 } from "./schedule";

/**
 * Echo City API.
 *
 * Env:
 *   PORT                    default 8787
 *   ECHO_DATA_DIR           default ./data
 *   ECHO_ADMIN_TOKEN        required in production (dev default: dev-admin)
 *   ECHO_SECRET_KEY         encrypts stored API keys / webhook secrets
 *   ECHO_MODE               weekly (default) | fast
 *   ECHO_TIMEOUT_SCALE      multiplier on agent deadlines (fast default 0.2)
 *   ECHO_WHISPER_MS         host whisper window (weekly 90000, fast 3000)
 *   ECHO_STEP_DELAY_MS      fast mode delay between steps (default 250)
 *   ECHO_AUTODEMO=1         on boot with no cycles: run a 12-bot demo cycle in fast mode
 *   ECHO_ALLOW_HTTP_WEBHOOK=1  allow http:// webhooks (dev)
 */
const env = process.env;
const prod = env.NODE_ENV === "production";
const mode = env.ECHO_MODE === "fast" ? "fast" : "weekly";
const adminToken = env.ECHO_ADMIN_TOKEN ?? (prod ? "" : "dev-admin");
const secretKey = env.ECHO_SECRET_KEY ?? (prod ? "" : "dev-secret-key");
if (prod && (!adminToken || !secretKey)) {
  console.error("生产环境必须设置 ECHO_ADMIN_TOKEN 与 ECHO_SECRET_KEY");
  process.exit(1);
}

const { server, manager, store } = createApp({
  dataDir: env.ECHO_DATA_DIR ?? "data",
  adminToken,
  secretKey,
  corsOrigin: env.ECHO_CORS_ORIGIN,
  timeoutScale: Number(env.ECHO_TIMEOUT_SCALE ?? (mode === "fast" ? 0.2 : 1)),
  whisperWindowMs: Number(env.ECHO_WHISPER_MS ?? (mode === "fast" ? 3000 : 90000)),
  fastStepDelayMs: Number(env.ECHO_STEP_DELAY_MS ?? 250),
  allowInsecureWebhooks: env.ECHO_ALLOW_HTTP_WEBHOOK === "1" || !prod,
});

manager.resumeAll();

/* Scheduler: keep one registering cycle open; in weekly mode start it at Monday 19:00. */
function tick() {
  const open = store.db.cycles.find((c) => c.status === "registering");
  const running = store.db.cycles.find((c) => c.status === "running");
  if (!open && !running && mode === "weekly") {
    const c = manager.createCycle({ mode: "weekly", startsAt: nextMonday1900().toISOString(), fillBots: Number(env.ECHO_FILL_BOTS ?? 12) });
    console.log(`[scheduler] 开放报名：${c.id}，开始于 ${c.startsAt}`);
  }
  if (open && open.mode === "weekly" && !running) {
    // Start a few seconds early: the runner itself waits for 19:00 before the first dawn.
    if (new Date(open.startsAt).getTime() - Date.now() < 60000) {
      try {
        manager.start(open.id);
        console.log(`[scheduler] 轮回开始：${open.id}`);
      } catch (e) {
        console.warn(`[scheduler] 无法开始 ${open.id}: ${(e as Error).message}`);
      }
    }
  }
}

if (env.ECHO_AUTODEMO === "1" && store.db.cycles.length === 0) {
  const c = manager.createCycle({ mode: "fast", seed: "demo", fillBots: 12, trialLength: "short" });
  manager.start(c.id);
  console.log(`[demo] 正在以快速模式运行演示轮回 ${c.id}`);
}

const port = Number(env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`残响城 API 已启动：http://localhost:${port}  (mode=${mode})`);
  tick();
  setInterval(tick, 30000).unref();
});

const shutdown = () => {
  console.log("正在关闭……");
  manager.stopAll();
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
