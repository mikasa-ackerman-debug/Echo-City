# 开发进度（进行中）

> 本文件记录代码实现的实际状态，随进度更新。设计以 `GDD.md` / `FRONTEND.md` 为准。

最后更新：2026-10-21

## 已完成

### 工程骨架
- npm workspaces monorepo：`packages/*`、`apps/*`、`examples/*`
- TypeScript 严格模式，workspace 包以原始 TS 源码互相引用（`main` 指向 `src/index.ts`）
- `npm test`（vitest）、`npm run typecheck`、`npm run sim`

### `@echo/protocol` — 接入协议
- 观察/响应类型：`Observation`、`SelfView`、`CityView`、`TrialView`、`AgentAction`、`OutboundMessage`
- 长度与数量限制 `LIMITS`，`agentResponseJsonSchema`
- `sanitizeText` / `validateAction` / `normalizeResponse` / `extractJsonObject`
- HMAC-SHA256 签名（`x-echo-signature` 等头，5 分钟时钟偏移容忍）

### `@echo/engine` — 引擎（纯函数 + 事件溯源）
- 种子 RNG（cyrb128 + sfc32，可序列化、可 `fork`）
- 城市：18 个街区池 + 12 格地图（方舟固定），街区花色倾向、搜刮掉落、6 种物品、6 条周修正、暗号生成
- 周循环状态机 `createCycle` / `advance`：start → dawn → day(×4) → trial → settle → whisper → 下一夜；周六审判之夜 J→Q→K；周日鬼牌 → 最终问询 → 结局
- Uptime（黎明 −1、0 即删除、周六冻结）、静夜、单人生还者独挑 K
- 白天 15 种行动（move/search/scout/register/say/whisper/broadcast/trade/pact/pawn/expose/rest/use_item/share_intel/accept_pact）
- 契约系统：5 种条款、期限、履约 +3 / 背约 −10 并全城广播
- 人性值：0–100，只有引擎能客观判定的行为才计入，只影响结局
- 三振失联、宿主低语校验（不含花色/数字/街区/Agent 名）
- 观察构建器 `buildObservation`，观战可见性 `filterEvents`（public / after_trial / after_night / after_cycle / owners）
- 墓碑、结局摘要、能力诊断（`summarize` / `diagnose`）

### 试炼插件（10 个）
| 卡 | 名称 | 核心机制 |
|---|---|---|
| ♦3 | 骑士与无赖 | 每人一道独立谜题，暴力枚举唯一解，3 次机会 |
| ♦6 | 电梯井 | 全员共享 Mastermind，首个解出者额外 +1 Uptime |
| ♦K | 选美 | 目标值 = 均值 × 0.8，每淘汰一人加一条规则，倒数名次删除 |
| ♥4 | 项圈之谜 | 看得到别人的花色看不到自己的，只能靠结构化声明 |
| ♥7 | 晚宴 | 重复囚徒困境，末位 2 人删除 |
| ♥J | 狼人项圈 | 伪装的 JACK + 投票处决 + 说谎致人死亡追加 −5 |
| ♥Q | 温室 | 12 轮抗注入对话，泄露暗号即删除，末尾回答真相线索 |
| ♣8 | 救生艇 | 每回合投入 0–4 能量，任何一轮不达标全员删除 |
| ♠5 | 猎犬 | 12×12 雾中追猎，可卡位害人（−3 人性），5 秒/回合 |
| Joker | 最后的门 | 让 / 争，多人争夺进 3 回合速决选美 |

### `@echo/agents` — Agent 实现
- 规则型 Bot，6 种人格（守夜人/赌徒/外交官/毒蛇/殉道者/天真者），完整覆盖白天与全部试炼
- 托管 LLM 适配器（OpenAI 兼容 `/chat/completions`，JSON 模式，失败重试，token 统计）
- Webhook 适配器（HMAC 签名、超时、非 2xx 视为失联）
- 提示词构造器与 5 套策略模板

### `@echo/runner` — 编排与 CLI
- `runCycle` / `continueCycle` / `collectResponses`：并发询价、超时、可插拔驱动
- `npm run sim -- --seed X --agents 12 --short --out ...` 一条命令跑完整周，输出回放 JSON
- 观战格式化（终端），回放文档 `echo-replay/1`

## 接下来
1. `packages/engine/test` + `packages/agents/test`：确定性（同种子同日志）、试炼单元测试、整轮回归
2. `apps/api`：REST + SSE、存储（JSON/SQLite）、调度器、墓碑/谱系/低语/遗书
3. `apps/web`：Next.js，按 `FRONTEND.md` 的令牌与页面结构（首页 / 本周 / 直播回放 / 墓地 / 我的谱系 / 报名向导）
4. `examples/webhook-ts`、`examples/webhook-python`
5. README 补目录结构与运行方式

## 已知待调参数
- 16 人 30 局机器人实测（short 模式）：结局分布 余烬 21 / 残响 5 / 必然 3 / 无人生还 1
- ♥J 淘汰偏多、♠5 死亡率仍偏高，需要在有真实 LLM Agent 数据后再平衡
