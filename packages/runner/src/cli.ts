#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { LlmAgent, PERSONAS, STRATEGY_TEMPLATES, WebhookAgent, type AgentDriver, type Persona } from "@echo/agents";
import { summarize, filterEvents } from "@echo/engine";
import { botRoster } from "./roster";
import { formatEvent } from "./format";
import { runCycle } from "./run";
import { buildReplay } from "./replay";

const HELP = `残响城 · 模拟器

用法：npm run sim -- [选项]

  --agents <n>        参赛 Agent 数量（默认 12，2–48）
  --seed <s>          随机种子（默认随机）
  --short             使用缩短版试炼（更快）
  --uptime <n>        初始 Uptime（默认 3）
  --personas <list>   内置 Bot 人格，逗号分隔：${Object.keys(PERSONAS).join(",")}
  --llm <n>           把前 n 个 Agent 换成托管 LLM（读取 ECHO_LLM_BASE_URL / ECHO_LLM_API_KEY / ECHO_LLM_MODEL）
  --strategy <name>   LLM Agent 的策略模板：${Object.keys(STRATEGY_TEMPLATES).join(",")}
  --webhook <url>     把第 1 个 Agent 换成 Webhook Agent（密钥读取 ECHO_WEBHOOK_SECRET）
  --out <file>        回放文件路径（默认 data/replays/<id>.json）
  --quiet             不打印逐条事件
  --private           打印时也显示私密事件（独白、私信、人性值）
`;

async function main() {
  const { values } = parseArgs({
    options: {
      agents: { type: "string", default: "12" },
      seed: { type: "string" },
      short: { type: "boolean", default: false },
      uptime: { type: "string" },
      personas: { type: "string" },
      llm: { type: "string", default: "0" },
      strategy: { type: "string", default: "guardian" },
      webhook: { type: "string" },
      out: { type: "string" },
      quiet: { type: "boolean", default: false },
      private: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  const n = Math.max(2, Math.min(48, Number(values.agents) || 12));
  const seed = values.seed ?? Math.random().toString(36).slice(2, 10);
  const id = `cycle-${seed}`;
  const personas = values.personas?.split(",").filter((p): p is Persona => p in PERSONAS);
  const { roster, drivers } = botRoster(n, personas?.length ? personas : undefined);
  const all: Record<string, AgentDriver> = { ...drivers };

  const llmCount = Number(values.llm) || 0;
  if (llmCount > 0) {
    const baseUrl = process.env.ECHO_LLM_BASE_URL;
    const apiKey = process.env.ECHO_LLM_API_KEY;
    const model = process.env.ECHO_LLM_MODEL;
    if (!baseUrl || !apiKey || !model) throw new Error("--llm 需要设置 ECHO_LLM_BASE_URL、ECHO_LLM_API_KEY、ECHO_LLM_MODEL");
    const strategy = STRATEGY_TEMPLATES[values.strategy!]?.text ?? values.strategy!;
    for (const r of roster.slice(0, llmCount)) {
      all[r.id] = new LlmAgent({ baseUrl, apiKey, model, strategy });
      r.kind = `hosted:${model}`;
    }
  }
  if (values.webhook) {
    const secret = process.env.ECHO_WEBHOOK_SECRET ?? "dev-secret";
    all[roster[0].id] = new WebhookAgent({ url: values.webhook, secret });
    roster[0].kind = "webhook";
  }
  const usesRemote = llmCount > 0 || !!values.webhook;
  const config = {
    trialLength: values.short ? ("short" as const) : ("standard" as const),
    ...(values.uptime ? { initialUptime: Number(values.uptime) } : {}),
  };

  console.log(`\x1b[2m种子 ${seed} · ${n} 个 Agent · ${config.trialLength}\x1b[0m`);
  const started = Date.now();
  const result = await runCycle(
    { id, seed, roster, drivers: all, config },
    {
      timeoutScale: usesRemote ? 1 : 0.05,
      onEvents: (events) => {
        if (values.quiet) return;
        for (const e of values.private ? events : events.filter((x) => x.vis === "public")) {
          const line = formatEvent(e, process.stdout.isTTY);
          if (line) console.log(line);
          if (values.private && e.type === "thought") console.log(`\x1b[2m    💭 ${(e.data as any).agent}：${(e.data as any).text}\x1b[0m`);
        }
      },
    },
  );
  const summary = summarize(result.state);
  const replay = buildReplay(result.state, result.events);
  const out = resolve(values.out ?? `data/replays/${id}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(replay));
  const publicCount = filterEvents(result.events).length;
  console.log(
    `\n\x1b[2m${result.events.length} 个事件（${publicCount} 个公开）· ${result.steps} 步 · ${((Date.now() - started) / 1000).toFixed(1)}s\x1b[0m`,
  );
  console.log(`结局：${summary.endingTitle}${summary.winner ? ` · 并入者 ${summary.winner.name}` : ""} · 删除 ${summary.tombstones.length} 人`);
  console.log(`回放：${out}`);
  for (const d of Object.values(all)) if (d instanceof LlmAgent) console.log(`\x1b[2mLLM 调用 ${d.usage.calls} 次，tokens ${d.usage.promptTokens}+${d.usage.completionTokens}，失败 ${d.usage.failures}\x1b[0m`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
