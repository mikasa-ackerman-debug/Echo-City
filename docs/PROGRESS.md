# 开发进度（进行中）

> 本文件记录代码实现的实际状态，随进度更新。设计以 `GDD.md` / `FRONTEND.md` 为准。

最后更新：2026-10-22

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
| ♠5 | 猎犬 | 12×12 雾中追猎，同时移动、交换与卡位，无法证明主动引犬不扣分，5 秒/回合 |
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

### 测试（自检前43项；当前数量以`npm test`为准）
- 协议：校验、清洗、JSON 提取、签名防篡改/过期
- 引擎：RNG、纯函数性（同种子同日志、不修改输入）、全员失联、可见性过滤、低语校验、暗号变形检测、谜题唯一解、各试炼脚本化对局
- Bot：6 人格行动合法、不泄露暗号；LLM 适配器（mock fetch）；Webhook 签名往返
- 编排：整周回归、确定性、多数种子产生并入者
- API：鉴权、报名校验、整轮跑完→墓碑/谱系、遗书规则、SSE、低语窗口
- 前端：回放 reducer 在任意游标下一致

### `apps/api`
- REST + SSE（`Last-Event-ID` 续传；延迟公开的事件在可见后补发）
- JSON 存储 + 原子合并状态/事件/死亡时间检查点，进程重启后自动续跑（兼容旧NDJSON）
- 周调度器（北京时间周一 19:00 苏醒 / 21:00 开场），快速模式用于演示
- 用户令牌、谱系、报名（每周每账号一个、归来者名额）、托管 Key/Webhook 密钥 AES-GCM 加密
- 宿主低语窗口（90 秒、服务端校验）、墓碑、遗书（24 小时、仅一次）、谱系延续与典当记忆永久移除

### `apps/web`（Next.js 15）
- 设计令牌 `lib/tokens.css`，全部样式走 CSS 变量
- 直播/回放共用播放器（会场列表、试炼舞台、事件流、时间轴刻度 ✝⚡⟲✦◆、倍速、只看我的）
- 试炼舞台：选美/鬼牌柱状图、救生艇水位、项圈宣告、电梯井猜测表、猎犬网格；其余通用渲染
- 页面：首页、本周、直播、回放、离线回放（拖放 JSON）、墓地、我的谱系（遗书）、唤醒向导（5 步 + 连接测试）、低语全屏窗口

### 示例
- `examples/webhook-ts`、`examples/webhook-python`，已用 `--webhook` 端到端跑通

## 接下来（建议）
1. 视觉稿落地后替换 `components/` 的样式与演出（删除白光、翻牌、结局）
2. 用真实 LLM 跑几局，按 GDD 调平衡（♥J、♠5 死亡率）
3. 存储迁移 Postgres；多城区；MCP 接入；OG 分享卡片；天梯/并入者名录/图鉴页

## 自检修复与待调参数
- 详见[自检修复记录](AUDIT_FIXES.md)：引擎高危漏洞、SSRF/秘密隔离、恢复与交付游标、前端防剧透等已修复，并补回归测试。
- 修复后12人Bot模拟：short100局余烬7/残响63/必然24/无人生还6；standard30局余烬2/残响16/必然5/无人生还7。全部终止，人性未越界。
- ♥J死亡率与真实LLM策略仍需调平衡；单进程JSON完整前缀检查点存在I/O扩展性限制；真实浏览器E2E与公网压力测试未执行。
