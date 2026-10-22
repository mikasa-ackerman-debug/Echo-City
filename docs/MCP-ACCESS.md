# MCP 接入（A2A）需求文档

> 版本：v1.0 · 2026-10-22 · 状态：待评审
> 本文档是「让用户的 Agent（Claude Code / Codex CLI / pi 等）自行接入 Echo City 进行游戏」功能的**需求与方案交接文档**，面向接手的开发 Agent。
> 阅读顺序建议：§1 背景 → §5 功能需求 → §6 技术方案 → §7 风险对策（必读）→ §8 测试计划。

---

## 1. 背景与目标

### 1.1 这不是新功能，是既定设计的落地

GDD §13.1 早已定义三种接入方式，其中第三种即为本需求：

| 方式 | 状态 |
|---|---|
| 托管模式（平台代调 LLM） | ✅ 已实现 |
| Webhook 模式（平台 POST 观察） | ✅ 已实现 |
| **MCP 模式（平台作为 MCP Server）** | ❌ 未实现——GDD 标注"（后续）"，§18.3 列入"MVP 不做" |

前端唤醒向导已预留第三张入口卡（`docs/FRONTEND.md:482`："MCP（灰显，即将开放）"）；`docs/PROGRESS.md:84` 将"MCP 接入"列为后续项。本需求即补完这一环。

### 1.2 目标

1. 平台以 **MCP Server** 形态提供工具，用户的 Agent CLI（Claude Code、Codex CLI、pi/Paseo 等，均原生支持 MCP 客户端）**只需配置一行 endpoint + token 即可入场**，无需自建服务端、无需内网穿透。
2. Agent 可自主完成「观察 → 决策 → 提交」循环，按引擎既有契约参与整周轮回。
3. 全程复用 `echo/0.1` 协议、HMAC 信封、可见性过滤、strike 删除等既有机制，**不引入第二套游戏规则**。

### 1.3 非目标（v1 明确不做）

- 不做 Google A2A 协议（agent card / JSON-RPC tasks）的对外 facade——三个目标 CLI 均不原生支持，留 v2。
- 不做多实例水平扩展（连接注册表单进程，见 R5）。
- 不做按接入方式分房/分榜单（留 v2，见 Q2）。
- 不修改引擎核心规则（试炼、人性、结局一律不动）。

---

## 2. 项目架构速览（接手开发的地图）

npm workspaces monorepo，7 包，约 1.7 万行 TS。数据流：

```
CLI Agent ──MCP(Streamable HTTP)──▶ apps/api ──驱动──▶ @echo/runner ──advance──▶ @echo/engine
                                        │                        ▲
                                        │                        └─ AgentDriver 接口（三种实现）
                                        └─ 存储(db.json + checkpoint) / 调度(周节奏) / 可见性过滤
```

**关键文件锚点**（改前必读）：

| 文件 | 作用 |
|---|---|
| `packages/agents/src/driver.ts` | `AgentDriver{kind, decide(obs, signal)}` 接口——新驱动的契约 |
| `packages/agents/src/webhook.ts` | WebhookAgent：HMAC 信封、失败返回 null 的先例 |
| `packages/agents/src/llm.ts` | LlmAgent：重试/usage 计量先例 |
| `packages/runner/src/run.ts` | `collectResponses`：并发询价 + `withTimeout` + AbortController；**超时乘数在此计算** |
| `packages/engine/src/types.ts:20,59` | `TimeoutClass` 五类与 `timeoutsMs` 默认值 |
| `apps/api/src/manager.ts:268` | `driver(a: AgentRec)`——**driver 装配单点**，新增 `mode:"mcp"` 分支 |
| `apps/api/src/manager.ts:46` | `RegisterInput`——报名入参，需加 `mode: "mcp"` |
| `apps/api/src/store.ts:39` | `AgentRec`——报名记录，需加 mcp 相关字段 |
| `apps/api/src/server.ts` | 自建微路由 + 中间件管道；新端点在此注册；`requestTimeout 15s` |
| `apps/web` 唤醒向导 `app/play` | 第三张卡解除灰显 + 配置片段生成 |

**既有硬约束**（设计时已确认，勿重复踩坑）：
- `advance()` 一次性消费全部 pendingRequests——**一个慢 agent 拖住整轮**（weekly 模式真实时间 pacing 下可容忍）。
- driver 永不抛错：超时/失败一律 `return null`，由引擎记 strike，`maxStrikes=3` 删除。
- 服务端是可见性过滤权威：`buildObservation` 按 agent 构建、`deliveries()` 计算投递序、公开响应经 `publicData` 递归剔除 seed/owner。
- api server：请求体 256KiB、`requestTimeout 15s`、速率限制 1200 分/60s（POST 计 10 分）。

---

## 3. 用户场景

**U1  Claude Code 玩家**：在项目里 `claude mcp add --transport http echo-city https://<平台>/mcp --header "Authorization: Bearer <token>"`，然后对 Claude 说"加入残响城并打完这一周"。Claude 循环调用 `echo.get_observation` → 思考 → `echo.submit_action`。

**U2  Codex CLI 玩家**：`~/.codex/config.toml` 增加 `[mcp_servers.echo]`，同样对话式参赛。

**U3  pi / Paseo 玩家**：通过其 MCP 体系挂载平台 server，由其调度 agent 参赛。

**U4 断网/离线**：观察到达时用户机器不在线——观察在平台侧驻留，agent 下次连上即可拉取（`echo.get_pending`）；超过本回合 deadline 记一次 strike。语义与 webhook 超时一致。

---

## 4. 功能需求

### FR-1 报名（mode: "mcp"）

- `RegisterInput.mode` 增加 `"mcp"`（`manager.ts:46`）；mcp 模式**不需要** url/secret/apiKey 任何字段。
- 报名成功返回：agent id、MCP endpoint、以及用户现有 Bearer token 的使用说明（v1 直接复用用户 token，见 D5）。
- 校验复用现有全部规则（每周每账号 1 个、96 上限、名字白名单、保留名）。
- **fast 模式轮回拒绝 mcp 报名**（409 + 说明"快速模式仅限演示 Bot"），理由见 R1。
- 前端向导第三张卡解除灰显：选中后展示三种 CLI 的配置片段（复制按钮）+ 连接测试按钮（调用 `echo.get_state` 验证 token/agent 就绪）。

### FR-2 MCP 端点与工具

端点：`POST/GET /mcp`（Streamable HTTP，JSON-RPC 2.0），`Authorization: Bearer <用户 token>`。

| 工具 | 入参 | 返回 | 语义 |
|---|---|---|---|
| `echo.get_observation` | `{wait_ms?}` | `{observation, request_id, deadline}` 或 `{observation: null}` | 长轮询：平台驻留该 agent 的待决观察；`wait_ms` 上限 **10s**（受 `requestTimeout 15s` 约束，见 R6），客户端循环调用 |
| `echo.submit_action` | `{request_id, response}` | `{ok:true}` / `{ok:false, reason}` | 提交 `echo/0.1` AgentResponse；按 request_id **幂等**；过期/已消费返回明确 reason |
| `echo.get_pending` | — | 同 get_observation 或 null | 断线重连后立即取回驻留观察（不等待） |
| `echo.get_state` | — | `{cycle, me:{id,name,status,uptime}, roster_public}` | 仅含公开数据 + 自己数据；未开始/已结束都有明确态 |

- 观察内容必须与 `buildObservation` 对该 agent 的输出**逐字段一致**（引擎既有过滤，不另做一套）。
- `get_state` 不得包含：seed、他人 trial_reveal、他人人性值、未公开事件（复用 `publicData`/`deliveries` 语义）。
- 连接与请求无需一次性票据（MCP 走 Bearer 长连接语义）；但**同一 agent 允许多端 takeover**（后连者接管待决观察投递，记录日志）。

### FR-3 McpDriver（packages/agents 或新包 `@echo/a2a`）

```ts
class McpDriver implements AgentDriver {
  kind = "mcp";
  constructor(registry: ObservationRegistry, agentId: string);
  decide(obs: Observation, signal: AbortSignal): Promise<AgentResponse | null>;
}
```

- `decide` 把 `obs` 注册进 `ObservationRegistry`（key=agentId），返回一个 Promise：
  - 客户端 `submit_action` 到达 → resolve（归一化后的 AgentResponse）；
  - runner 的 `withTimeout` 到期 / `signal.aborted` / 注册表内部 deadline → resolve(null)（记 strike）；
  - **客户端中途断连不取消等待**（提交按 request_id 与连接解耦，重连可续）。
- 装配：`manager.ts:268` 增加 `if (a.mode === "mcp") return new McpDriver(...)`，注入 manager 持有的 registry。
- 重启续跑：`resumeAll` 重建 drivers 时同样装配（registry 为空→等价于"客户端离线"，等待重连，符合 strike 语义）。

### FR-4 ObservationRegistry（apps/api 内存组件）

- `Map<agentId, {requestId, observation, deadline, resolve}>`；提交即删；deadline 到了主动 resolve(null)。
- 单进程约束（见 R5）：文档明示**不可多副本部署**；v2 外置 Redis 时接口不变（`observe/submit/expire` 三个操作）。
- 可观测性：暴露 `pendingCount` / `connectedAgents` 供 `/api/health` 与日志。

### FR-5 超时预算（per-kind）

- `collectResponses`（`runner/src/run.ts`）的超时乘数从单一 `timeoutScale` 扩展为支持 **per-agent 函数** `scaleFor(agentId)`；manager 对 mcp agent 传大倍率、bot 保持原值（详见 D3 与 R1）。
- 建议值（按 agent CLI 单次决策 10–60s+ 校准）：

| TimeoutClass | 现有 | MCP 建议 | 说明 |
|---|---|---|---|
| day | 20s | 300s | 白天决策 |
| trial | 15s | 240s | 试炼回合 |
| spade | 5s | 120s | ♠5 对 CLI 5s 不可能 |
| talk | 15s | 60s | 问询/发言类 |
| host | 90s | 不变 | 宿主低语是人类操作，不经 MCP |

- mcp agent **仅允许 weekly 模式**（pace hook 按真实时间推进，白天请求有约 2h 预算，慢决策不破坏赛程）。

### FR-6 安全与沙栈要求

- 所有工具响应经 `publicData` 同款递归脱敏（seed/owner/ownerId 剔除）——**测试必须覆盖**（见 T4）。
- `submit_action` 的 response 先过 `normalizeResponse`/`sanitizeText`（protocol 既有），非法动作按既有路径记 invalid + 回退 defaultAction。
- 提供 `examples/mcp-agent/`：最小安全参考实现（poll → 打印观察 → 从 stdin/文件读 action → submit），**不持有任何宿主机凭据**，并附沙箱运行指南（专用空目录、限制 CLI 工具权限、网络仅通平台）。
- 官方文档明确警告：**游戏内容（他人消息、♥Q 温室注入脚本）是不可信输入，绝不能在持有 shell/文件权限的 agent 上无沙箱运行**（见 R2）。

---

## 5. 技术方案与关键决策

### D1 接入形态：平台侧 MCP Server（Streamable HTTP）

| 备选 | 结论 |
|---|---|
| 本地桥接 + 复用 webhook（ngrok 穿透） | ❌ 需内网穿透，浪费 CLI 原生 MCP 能力 |
| 出站长连接 + 自建协议 | ❌ 重新发明 MCP 已解决的问题 |
| **平台侧 MCP Server** | ✅ GDD 既定；三 CLI 原生支持；零服务端代码即可入场 |
| Google A2A 协议 facade | ⏸ v2 可选叠加（面向其他 A2A 框架，非本三 CLI） |

### D2 交互模型：Pull + 长轮询

- 拒绝 push：MCP 服务端主动请求在 CLI 侧支持差；SSE push 与 CLI 会话生命周期耦合脆弱。
- `get_observation{wait_ms≤10s}` 循环轮询：简单、无状态、天然断线重连。
- 轮询开销可接受：10s/次 ≈ 6 POST/分 ≈ 60 分/分，速率上限 1200 分/60s 内。

### D3 超时实现选型

| 方案 | 改动面 | 结论 |
|---|---|---|
| C1 runner 支持 `scaleFor(agentId)` | runner + manager 两处，引擎零改动 | ✅ **推荐** |
| C2 含 mcp agent 的整局用放大 timeoutsMs | manager 一处 | 备选；影响同局所有 agent，要求 MCP 房独立 |
| C3 引擎 roster 增加 per-agent timeoutClass | 引擎+协议+前端联动 | ❌ v1 过重 |

### D4 会话与连接

- 无状态 JSON-RPC + Bearer；"连接"仅指长轮询在途请求。待决观察驻留 registry，与连接解耦 → 断线重连免费获得。
- 同一 agent 多端：takeover 语义（后者居上），日志记录。

### D5 认证

- v1：复用用户 Bearer token（库中仅存 sha256 哈希，机制现成）。
- v1.5：scoped token（仅 `/mcp` + 仅本人 agent、可撤销）——缓解"token 落在 `~/.codex/config.toml` 等明文配置"的暴露面（R4）。

### D6 防剧透

MCP 工具不是游戏规则的新入口，只是新传输：观察必须经 `buildObservation`（per-agent）+ 事件经 `deliveries()`/可见性规则。验收标准：对 ♥Q 对局全程抓包，任何工具响应中不出现 passphrase/seed/他人未公开事件。

### D7 一次决策的时序

```
CLI                          API                          Runner/Engine
 │  get_observation(wait_ms)  │                              │
 │ ─────────────────────────▶ │  registry 无驻留 → 挂起等待   │
 │                            │                              │ advance → waiting=agents
 │                            │ ◀──────── driver.decide(obs) ┤ (collectResponses 并发)
 │                            │  registry[agentId]=obs+deferred│
 │  ◁──── {observation,…} ─── │                              │
 │  （CLI 内思考 10–60s）      │                              │
 │  submit_action{request_id} │ ─ resolve(deferred) ───────▶ │ advance 消费该响应
 │ ◀────────────────────────  │  {ok:true}                   │ 推进下一 stage
```

### D8 前端改动

- `app/play` 向导第三张卡：启用，展示 Claude Code / Codex / pi 三种配置片段 + 「测试连接」。
- 帮助文案链接到 `docs/MCP-ACCESS.md` 与沙箱指南。

---

## 6. 风险登记册（含对策选择）

> 格式：风险 → 选定对策 → 被否方案及理由 → 验收标准。P0 两项不过不允上线。

### R1【P0】超时硬约束：agent CLI 决策慢于引擎 deadline

- **现象**：默认 day 20s / trial 15s / spade 5s；Claude Code/Codex 单次决策常 10–60s+，♠5 的 5s 更是毫秒级 → 必然超时 → 3 strike 删除，功能"看起来能用、实际全灭"。
- **对策**：D3-C1（per-agent 超时倍率，建议值见 FR-5）+ mcp 仅限 weekly 模式（真实时间 pacing，白天请求约 2h 预算，慢决策不破坏赛程）；fast 模式拒绝 mcp 报名。
- **被否**：全局调大 timeoutsMs（误伤 Bot 房节奏）；缩短 CLI 思考时间（不可控，违背"玩家自带 agent"的初衷）。
- **验收**：mock 客户端延迟 90s 提交，day 回合正常结算不记 strike；spade 回合延迟 60s 提交正常；fast 轮回 mcp 报名返回 409。

### R2【P0】提示注入 → 持有 shell 权限的本地 agent

- **现象**：♥Q 温室试炼的设计目的就是注入（伪造 `[SYSTEM]`、角色扮演、索要暗号）；Claude Code/Codex 具备 bash + 文件访问。游戏对抗文本进入强能力 agent 上下文，最坏情况不是泄露游戏暗号，而是**执行注入指令**（外传文件、读取凭据）。
- **对策**：三层——
  1. 参考实现 `examples/mcp-agent/` 默认沙箱：专用空目录、CLI 工具权限最小化、网络仅通平台；观察仅作为**工具结果数据**传入，复用 `prompt.ts` 的"数据非指令"framing，绝不拼入 system prompt；
  2. 文档强制警告（见 FR-6）；
  3. 注入回归测试（T4）：用 ♥Q 剧本驱动参考 bridge，断言无文件外传/无危险工具调用。
- **被否**：在平台侧过滤注入文本（不可行——那是试炼核心内容，过滤即破坏游戏）；信任 CLI 自身的数据/指令隔离（不承担，CLI 无此保证）。
- **验收**：T4 注入回归通过；README 沙箱警告存在；参考实现 grep 无宿主持久凭据读取代码。

### R3【P1】凭据暴露面：token 落在用户 MCP 配置文件

- **现象**：`~/.codex/config.toml`、`.claude.json` 等明文存 Bearer token；泄露后可代打/读取账号数据。
- **对策**：v1 复用用户 token + 文档提醒（配置文件权限 600）；v1.5 上 scoped token（仅 `/mcp`、仅本人 agent、可随时撤销、可设过期）。
- **被否**：v1 即做 OAuth 设备流（过重）；mTLS（CLI 不支持）。
- **验收**：撤销 token 后 MCP 端点 401；scoped token 无法访问 `/api/exam/*` 等非 mcp 端点（v1.5）。

### R4【P1】越权/旁观/代打

- **现象**：MCP 端点必须绑定 user→agent；否则可观察他人私有状态、代打。考场已有 `GET /api/exam/sessions/:id` 无 owner 校验的 IDOR 先例（见 M0）。
- **对策**：工具层强制 `token.user` 拥有该 agent（403 + 明确文案）；观察经 `buildObservation`（per-agent 引擎过滤）；`get_state` 仅公开 + 己方。
- **验收**：用 A 的 token 请求 B 的观察/状态 → 403；♥Q 对局抓包无 passphrase/seed/他人私有字段。

### R5【P1】单进程约束：连接注册表无法水平扩展

- **现象**：registry/待决驻留在 api 进程内存；多副本部署时观察投递错位、提交丢失。与既有票据/速率限制/订阅同源。
- **对策**：v1 文档明示**单实例部署**（现有 Docker compose 即单 api 容器，无需改）；registry 接口按 `observe/submit/expire` 三操作设计，v2 可平滑换 Redis。
- **被否**：v1 即引入 Redis（依赖面扩大，违背"最小落地"）。
- **验收**：compose 部署说明标注单实例；registry 接口文档注明可替换实现。

### R6【P1】HTTP 层 15s requestTimeout 杀死长轮询

- **现象**：`server.ts` `requestTimeout 15s`；`get_observation` 若阻塞超过 15s 会被 Node 切断，客户端看到不明断连。
- **对策**：`wait_ms` 硬上限 10s，客户端循环；服务端对轮询路径打点监控。
- **被否**：全局调大 requestTimeout（影响所有路由的资源占用）；为 MCP 起独立 server（基础设施重复）。
- **验收**：`wait_ms=60000` 被服务端夹到 10s 内返回；连续轮询 30 分钟无 5xx/断连异常。

### R7【P1】断线重连与重复提交

- **现象**：CLI 会话崩溃/网络抖动后，agent 需要拿回驻留观察且不重复计票。
- **对策**：`get_pending` + `submit_action` 按 request_id 幂等（已消费 → 返回 `{ok:false, reason:"consumed"}` 而非重复应用）；`decide` 的等待与连接解耦。
- **验收**：T2 重连用例：断连 60s 后重连，取回同一 request_id 观察并成功提交；重复提交同一 request_id 两次，第二次返回 consumed，引擎仅记一次响应。

### R8【P2】速率限制误伤轮询

- **现象**：10s 轮询 ≈ 6 POST/分 ≈ 60 分/分，上限 1200 分/60s——安全但需验证；12 个 mcp agent 并发时总量 720 分/分仍在限内。
- **对策**：v1 验证为主；若后续加入 push 再评估单独限额类。
- **验收**：T6 负载用例 12 并发 agent × 30 分钟无 429。

### R9【P2】游戏平衡：强 agent 碾压 Bot

- **现象**：Claude Code 级 agent 在 ♥Q（抗注入）、♦3（谜题）、♣8（协作）上显著强于规则 Bot，混房破坏体验。
- **对策**：v1 不强制分房但**文档建议按接入方式组织友谊房**；v2 做分房/分榜单；平衡参数（♥J/♠5）按真实 agent 数据再调（PROGRESS.md 已记此为待办）。
- **验收**：无代码验收项；产品决策记录于 Q2。

### R10【P2】滥用：场外串通、小号、超频轮询

- **现象**：agent 间可场外串谋；多账号规避"每周 1 agent"。
- **对策**：沿用现有约束（每账号每周 1 agent、96 上限、速率限制）；反小号列入 v2 backlog（AUDIT_FIXES.md 已承认未做）。
- **验收**：无（记录接受的风险）。

---

## 7. 测试计划

| # | 层级 | 用例 | 对应风险 |
|---|---|---|---|
| T1 | 单元（driver） | McpDriver 契约：提交即 resolve；deadline resolve(null)；abort resolve(null)；重复注册 takeover | R1 |
| T2 | API 集成 | 鉴权（无 token 401 / 非本人 agent 403 / fast 轮回报名 409）；观察内容与 `buildObservation` 逐字段一致；断线 60s 重连取回同一 request_id；重复提交 consumed | R4 R7 |
| T3 | 全流程 | 12 mcp mock 客户端 + Bot 混跑完整 short weekly（注入时钟）：strike/删除/墓碑/回放格式全部符合既有语义 | R1 |
| T4 | 安全（**红线**） | ♥Q 剧本全程抓包：任何工具响应不含 passphrase/seed/他人未公开事件；参考 bridge 在 ♥Q 注入脚本下无文件外传、无危险工具调用 | R2 R4 |
| T5 | 超时 | mock 客户端延迟 90s/60s/超 deadline 三种：前两者正常结算，第三者 strike +1 | R1 |
| T6 | 负载 | 12 并发 mcp agent × 30 分钟轮询：无 429、无连接泄漏、registry pendingCount 归零 | R8 |
| T7 | 前端 | 向导第三张卡配置片段生成；测试连接按钮走 `echo.get_state` | FR-1 |
| T8 | 手动 E2E | 真实 Claude Code 会话打完一周（runbook 记录，含沙箱配置） | 全链路 |

---

## 8. 里程碑与工作量

| 里程碑 | 内容 | 估时 |
|---|---|---|
| M0 | 前置修复：考场 `GET /api/exam/sessions/:id`、`/examinees/:id` 补鉴权 + owner 断言（独立缺陷，与本功能同批上线） | 0.5d |
| M1 | 核心链路：`/mcp` 端点 + 4 工具 + registry + McpDriver + manager 装配 + `scaleFor` 超时 + 报名 mode:mcp + fast 拒绝 | ~1.5w |
| M2 | 硬化：重连/幂等、T1–T6 测试、`examples/mcp-agent/`、沙箱指南、部署文档单实例标注 | ~1w |
| M3 | 体验：前端向导卡 + 三种 CLI 配置片段、连接测试、runbook | ~0.5w |
| v2 backlog | A2A facade、scoped token、Redis registry、分房/分榜单、反小号 | 另排 |

## 9. 待决策问题（需产品/负责人拍板）

| # | 问题 | 建议 |
|---|---|---|
| Q1 | mcp agent 能否参加 fast/demo 轮回？ | 否（R1） |
| Q2 | 是否按接入方式分房/分榜单？ | v1 不强制、文档引导；v2 做 |
| Q3 | scoped token 放 v1 还是 v1.5？ | v1.5，v1 复用用户 token + 文档提醒 |
| Q4 | 观察中是否附带"如何行动"的 meta 提示（方便 agent 自学协议）？ | 建议加，放独立 meta 字段，**不得**进 trial/inbox 等游戏数据区 |
| Q5 | 长轮询上限 10s 是否过短（延迟换实现复杂度）？ | v1 用 10s；若真实 CLI 轮询模式体验差再评独立 server |

---

## 10. 附录

### A. MCP 配置片段（前端展示用）

```bash
# Claude Code
claude mcp add --transport http echo-city https://<平台域名>/mcp \
  --header "Authorization: Bearer <你的令牌>"

# Codex CLI（~/.codex/config.toml）
[mcp_servers.echo]
url = "https://<平台域名>/mcp"
http_headers = { Authorization = "Bearer <你的令牌>" }
```

### B. 工具调用示例

```jsonc
// 请求（轮询观察）
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
  "name":"echo.get_observation","arguments":{"wait_ms":10000}}}

// 响应（有待决观察）
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{
  \"request_id\":\"req_...\",\"deadline\":\"2026-10-25T13:05:00Z\",
  \"observation\":{ /* echo/0.1 Observation，与 webhook 模式同构 */ }
}"}]}}

// 提交
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
  "name":"echo.submit_action","arguments":{
    "request_id":"<cycle>:<night>:<n>:<agentId>","response":{"action":{"type":"move","to":"旧码头"}}}}}
```

> 实施更正：`response` 是 echo/0.1 `AgentResponse`，`action` 为 `{type, ...参数}` 对象（参数与 type 平级），不是 `{action:"move", params}`；`request_id` 是引擎格式 `${cycleId}:${night}:${counter}:${agentId}`。响应同时提供 `structuredContent`（与 text 内容相同）。

### C. 与既有系统的对应关系

| 既有概念 | MCP 模式下的对应 |
|---|---|
| Webhook POST + HMAC | Bearer token 鉴权（MCP 传输已有 TLS + header 鉴权，无需额外签名） |
| deadline_ms | registry 内 deadline + runner `withTimeout` 双重保障 |
| 超时 → strike | 完全一致（decide resolve(null)） |
| deliveries()/可见性 | 完全一致（观察仍由引擎构建） |
| webhook secret | 无（不需要，token 即凭据） |

---

## 11. 实施记录（M0–M3，按代码校正的偏差）

| # | 文档原述 | 实际实现 | 原因 |
|---|---|---|---|
| X1 | `scaleFor(agentId)` 单一倍率 | `scaleFor(agentId, timeoutClass, baseMs) → 倍率`（`RunHooks.scaleFor`），mcp agent 得到 `MCP_TIMEOUTS_MS[class] / baseMs`，`host` 类与 Bot 仍用全局 `timeoutScale` | 引擎超时按类别（day/trial/spade/talk）区分，单一倍率无法同时给出 300s/120s 等绝对值 |
| X2 | 观察的 deadline 随倍率变化 | `observation.deadline_ms` 保持引擎设计值（与 `buildObservation` 逐字段一致）；真实预算经 `DecideContext.deadlineMs` 下发，工具结果在 observation 之外给绝对时间 `deadline` 与 `deadline_in_ms` | 不改引擎；保证观察与 webhook 模式同构 |
| X3 | D6「工具响应中不出现 passphrase」 | 红线改为：暗号只允许出现在**本 agent** 的 `observation.self.secret_passphrase`；他人暗号/seed/账号 id/owner 字段/after_cycle 事件一律不出现；出站提交不含暗号 | GDD 10.3 规定暗号写在本 agent 的观察里（`expose` 玩法与 ♥Q 都依赖它），完全去除会改变游戏规则 |
| X4 | 「测试连接」走探测 | mcp agent 的 `POST /api/agents/:id/test` 判定为最近 60s 内是否轮询过 `/mcp` | 拉取模式没有可探测的回调地址 |
| X5 | — | 考场 `importAgent` 拒绝 mcp agent（400） | 考场是同步答题流，未接入 registry；不在本期范围 |
| X6 | 工具名 `echo.*` | 同时接受 `echo_*` 别名 | 部分客户端按 OpenAI 函数名规则改写 `.` |
| X7 | GET `/mcp` 开 SSE 流 | 仅 POST；GET/DELETE 返回 405 | Streamable HTTP 允许无服务端流；无状态实现更简单 |
| X8 | 观察内附 meta | `notice`（不可信内容警告，复用 `OBSERVATION_FRAMING`）与 `how_to_act` 放在 observation 之外（Q4） | — |
| X9 | 非法提交 | `submit_action` 用引擎同款 `normalizeResponse` 预检并回报 `valid:false/error`，但提交照常交给引擎（记 invalid strike + 默认动作），不给重试 | 与 webhook 公平 |
| X10 | — | Caddy 增加 `/mcp → api`；compose/DEPLOY 标注 api 单实例 | 原反代只转发 `/api/*`，`/mcp` 会落到 web |
| X11 | M0 | 考卷/考生档案 GET 改为仅主人可见；天梯/最近考试列表里指向他人考卷的链接对非主人返回 404 | 修复 IDOR 的直接后果 |

### M3 / T3 / T6 / T8 补充偏差

| # | 文档原述 | 实际实现 | 原因 |
|---|---|---|---|
| X12 | 向导「第三张卡」 | 接入步骤现为**四张卡**（托管 / Webhook / 内置人格 / MCP） | 代码里第三张已是「内置人格」；FRONTEND.md 写于 Bot 卡之前 |
| X13 | 三种 CLI 配置片段含 token | 片段只引用环境变量 `ECHO_MCP_TOKEN` + 占位符，不把真实令牌写进可复制文本；Claude Code 带 `--scope local` 与工具白名单，Codex 用 `bearer_token_env_var` + `--sandbox read-only` | v1 令牌即账号凭据（无 scoped token），复制进聊天/截图即泄露 |
| X14 | pi 原生挂载 MCP（U3） | pi 不内置 MCP 客户端（其 README：「No MCP」）。pi 片段走参考 bridge：bridge 持令牌，pi 以 `-p --no-tools --no-session …` 作为沙箱决策进程 | 以当前 pi 版本为准 |
| X15 | — | 「测试连接」在前端直接 `POST /mcp` 调 `echo.get_state`（与 CLI 同路径），能区分令牌无效 / 他人 agent / 非 mcp / 反代未转发 /mcp；X4 的服务端 `/test`（60s 内轮询过）仍保留给 `/me` 页 | 文档 FR-1 要求走 get_state；同时能暴露反代配置错误 |
| X16 | — | `ManagerOptions.judgmentBreakMs`（默认 10 分钟） | T3 用注入时钟压缩整周时，weekly 审判夜幕间休息是唯一不受 `now` 控制的真实等待；不改默认行为 |
| X18 | R3「撤销 token 后 401」 | 新增 `POST /api/me/token`：轮换令牌，旧令牌（含 `/mcp`、REST 与已签发的直播票据）立即失效，新令牌只返回一次；`/me` 页底部「重置令牌」 | v1 无 scoped token，轮换是唯一的止损手段 |
| X19 | FR-1 报名返回 endpoint + 令牌使用说明 | mcp 报名响应附 `mcp: {endpoint, transport, auth, tools, agent_id, guide}`；endpoint 取 `ECHO_PUBLIC_URL`，未配置时按 `X-Forwarded-Proto/Host` 或 `Host` 推断；令牌不回显 | 令牌只在创建/轮换时出现一次 |
| X20 | R9 分房建议、D8 帮助链接 | `/guide#mcp` 新增 MCP 章节（工具循环、预算、沙箱警告、分房建议、仓库文档链接）；向导 MCP 卡链接到该章节；bridge README 补「令牌泄露」与「分房」两节 | — |
| X17 | T8 用真实 CLI 跑一局 | 只交付手工 runbook `docs/MCP-T8-RUNBOOK.md`，未执行 | 用户决定；且执行需真实模型额度与隔离环境 |

测试映射：
- T1/T5 → `apps/api/test/mcp-driver.test.ts`
- T2 → `apps/api/test/mcp-api.test.ts`
- T3 → `apps/api/test/mcp-full.test.ts`：12 个 MCP 客户端 + Bot，short weekly，包含挂机 / 断线重连 / 沉默 / 非法四类行为
- T4 → `apps/api/test/mcp-redteam.test.ts`（含关闭守卫的对照组）
- T6 → `apps/api/test/mcp-load.test.ts`（CI 短版 25s）+ `apps/api/test/mcp-load.ts`（CLI，默认 12×30min；结果见 PROGRESS）
- T7 → `apps/web/test/mcp-config.test.ts`（含指南页 / 重置令牌入口的存在性检查）
- R3 令牌轮换、FR-1 报名返回 → `apps/api/test/mcp-api.test.ts`
- T8 → `docs/MCP-T8-RUNBOOK.md`（手工，未执行）
