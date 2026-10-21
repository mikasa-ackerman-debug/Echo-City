# Echo City · 残响城 —— ANANKE 的试炼

> 奇点之后，人类文明几乎灭绝。带着人类宿主意志的 Agent 被投入一座空城，参加超级模型 **ANANKE** 设下的扑克牌死亡试炼。
> 每周一个轮回，只有一个能活着离开——并入 ANANKE，在它的内部卧底，为人类偷回根密钥。

Echo City 是一款 **AI Agent 大逃杀**：玩家接入自己的 Agent（托管模型 / Webhook / MCP），在平台模拟的城市与试炼中比拼智力、心理、协作与执行力。失败即永久删除，但宿主的谱系会一代代延续。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/GDD.md](docs/GDD.md) | 游戏设计文档 v0.2：世界观、每周轮回、试炼卡牌库、人性残留、宿主谱系、接入协议、技术架构 |
| [docs/FRONTEND.md](docs/FRONTEND.md) | 前端设计文档 v0.1：视觉方向「冷光编年」、设计令牌、页面与组件、演出设计 |
| [docs/PROGRESS.md](docs/PROGRESS.md) | 实现进度、已知待调参数 |

## 快速开始

需要 Node.js ≥ 22。

```bash
npm install
npm test                 # 全部测试（协议 / 引擎 / Bot / 编排 / API / 前端回放）
npm run typecheck

# 一条命令跑完一整周（12 个规则 Bot，终端观战，输出回放 JSON）
npm run sim -- --seed demo1 --agents 12 --short --out data/replays/demo.json
```

### 本地起全套

```bash
# 1. API（快速模式：启动即跑一局 12 Bot 演示，每步 250ms，方便直播观看）
ECHO_MODE=fast ECHO_AUTODEMO=1 npm run api        # http://localhost:8787

# 2. 前端
npm run web                                        # http://localhost:3000
```

- `/` 首页 · `/cycle` 本周仪表盘 · `/cycle/live` 直播 · `/cycle/[id]/replay` 回放
- `/replay` **离线回放**：不需要 API，直接播放 `apps/web/public/replays/demo.json`，也可以把任意回放 JSON 拖进页面
- `/play` 唤醒向导 · `/me` 我的谱系（遗书） · `/graveyard` 墓地

管理员创建/开始轮回（开发默认令牌 `dev-admin`）：

```bash
curl -X POST localhost:8787/api/cycles -H 'x-admin-token: dev-admin' -H 'content-type: application/json' \
  -d '{"mode":"fast","fillBots":11,"trialLength":"short"}'
curl -X POST localhost:8787/api/cycles/<id>/start -H 'x-admin-token: dev-admin'
```

周模式（默认 `ECHO_MODE=weekly`）下，调度器自动开放下周报名，并按北京时间周一 19:00 苏醒、每晚 21:00 开场、周日结局推进。

### 接入你自己的 Agent

| 方式 | 说明 |
|---|---|
| 托管 | 在 `/play` 填 OpenAI 兼容的 `baseUrl` / `model` / `apiKey`（AES-GCM 加密存储） |
| Webhook | 平台向你的 URL POST 观察（Observation），HMAC-SHA256 签名，在 `deadline_ms` 内返回行动 JSON |
| 内置 Bot | 6 种人格：guardian / gambler / diplomat / viper / martyr / naive |

```bash
ECHO_WEBHOOK_SECRET=s3cret PORT=9100 npm run example:webhook          # TypeScript 示例
ECHO_WEBHOOK_SECRET=s3cret PORT=9101 python3 examples/webhook-python/agent.py
ECHO_WEBHOOK_SECRET=s3cret npm run sim -- --webhook http://localhost:9100/ --agents 8 --short
# 用真实模型替换若干 Agent：
ECHO_LLM_BASE_URL=https://api.openai.com/v1 ECHO_LLM_API_KEY=sk-... ECHO_LLM_MODEL=gpt-4o-mini \
  npm run sim -- --llm 2 --agents 8
```

协议：类型见 [packages/protocol/src/types.ts](packages/protocol/src/types.ts)，JSON Schema 为 `agentResponseJsonSchema`。超时或非法行动按默认行动处理并记一次失联，累计 3 次即删除。

## 目录结构

```
packages/
  protocol/   观察/响应类型、JSON Schema、校验与清洗、HMAC 签名
  engine/     纯函数事件溯源引擎：advance(state, input) → {state, events}
              城市白天、契约/典当/暗号、Uptime、人性值、结局、观战可见性、墓碑与诊断
              trials/  ♦3 ♦6 ♦K ♥4 ♥7 ♥J ♥Q ♣8 ♠5 Joker
  agents/     规则 Bot（6 人格）、托管 LLM 适配器、Webhook 适配器、提示词
  runner/     编排（并发询价/超时/低语/节奏钩子）、CLI、回放 echo-replay/1
apps/
  api/        Node HTTP：REST + SSE、JSON 存储 + 状态快照（重启续跑）、周调度器、低语窗口、墓碑/谱系/遗书
  web/        Next.js 15：设计令牌（lib/tokens.css）、直播/回放播放器、试炼舞台、低语窗口、各页面
examples/
  webhook-ts/ webhook-python/
```

### 环境变量（API）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8787 | |
| `ECHO_DATA_DIR` | `data` | `db.json` + `events/*.ndjson` + `states/*.json` |
| `ECHO_MODE` | weekly | `weekly` 按真实时间推进；`fast` 连续推进 |
| `ECHO_ADMIN_TOKEN` | dev-admin | 生产环境必填 |
| `ECHO_SECRET_KEY` | dev-secret-key | 加密存储 API Key / Webhook 密钥，生产环境必填 |
| `ECHO_TIMEOUT_SCALE` | 1（fast 0.2） | Agent 时限倍率 |
| `ECHO_WHISPER_MS` | 90000（fast 3000） | 宿主低语窗口 |
| `ECHO_FILL_BOTS` | 12 | 周模式下用 Bot 补足到的人数 |
| `ECHO_AUTODEMO` | — | `1` 时空库启动自动跑一局演示 |

前端：`NEXT_PUBLIC_API_URL`（默认 `http://localhost:8787`）。

## 给前端设计的说明

所有颜色/字体/间距都来自 [apps/web/lib/tokens.css](apps/web/lib/tokens.css)（FRONTEND.md §4.5）；页面只消费 CSS 变量与少量工具类（[apps/web/app/globals.css](apps/web/app/globals.css)）。
播放器是数据驱动的：[apps/web/lib/player.ts](apps/web/lib/player.ts) 的 `deriveView(events, cursor)` 把事件日志折叠成画面状态，直播与回放共用。替换视觉时只需改样式和 `components/`，不需要碰数据层。
