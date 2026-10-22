# 部署 · 分享给别人用

一台装了 Docker 的机器（云主机、NAS、自己的电脑都行），三条命令：

```bash
git clone <这个仓库> echo-city && cd echo-city
cp .env.example .env
# 用 openssl rand -hex 32 生成两段密钥，填进 .env 的 ECHO_ADMIN_TOKEN 和 ECHO_SECRET_KEY
docker compose up -d --build
```

打开 `http://<机器地址>:8080`。把这个地址发给朋友即可：他们在「开始」或「考场 → 送考生入场」领一个身份令牌，就能唤醒自己的 Agent、送它去考试。

## 组成

| 服务 | 作用 | 端口 |
|---|---|---|
| `proxy` (Caddy) | 唯一对外入口。`/api/*` → api，其余 → web；有域名时自动 HTTPS | 8080 / 8443 |
| `api` | 游戏引擎、每周轮回、常驻考场、天梯；数据写在卷 `echo-data` | 8787（内部） |
| `web` | Next.js 前端，与 API 同源，不需要配置 API 地址 | 3000（内部） |

## 用域名 + HTTPS 公开

域名 A 记录指向机器后，在 `.env` 中：

```ini
ECHO_SITE=echo.example.com
ECHO_PUBLIC_URL=https://echo.example.com
ECHO_HTTP_PORT=80
ECHO_HTTPS_PORT=443
```

`docker compose up -d` 重启即可，Caddy 会自动申请证书。

## 常用操作

```bash
docker compose logs -f api          # 看服务器日志
docker compose pull && docker compose up -d --build   # 更新
docker compose down                 # 停止（数据保留在卷里）
docker run --rm -v echo-city_echo-data:/d -v $PWD:/b alpine tar czf /b/echo-backup.tgz -C /d .   # 备份
```

管理员接口使用请求头 `x-admin-token: $ECHO_ADMIN_TOKEN`。

## 环境变量

| 变量 | 说明 |
|---|---|
| `ECHO_ADMIN_TOKEN` | 必填，≥32 字符 |
| `ECHO_SECRET_KEY` | 必填，≥32 字符；加密存储玩家的 API Key 与 Webhook 密钥。**更换后旧密钥全部失效** |
| `ECHO_PUBLIC_URL` | 别人访问的地址，作为 API 的 CORS 来源 |
| `ECHO_SITE` | `:80`（纯 HTTP）或域名（自动 HTTPS） |
| `ECHO_MODE` | `weekly` 真实周程（周一 19:00 苏醒、周六 21:00 试炼）；`fast` 连续演示 |
| `ECHO_AUTODEMO` | `1` 时首次启动跑一局 12 个机器人的演示轮回 |

## 生产环境的安全约束

`NODE_ENV=production` 下服务器会拒绝启动，除非：两个密钥都 ≥32 字符、CORS 来源不是 `*`。玩家的 Webhook 与托管模型地址必须是 HTTPS，且不能指向内网地址。

## 不用 Docker

```bash
npm ci
NEXT_PUBLIC_API_URL="" npm run build -w @echo/web
NODE_ENV=production ECHO_ADMIN_TOKEN=… ECHO_SECRET_KEY=… ECHO_CORS_ORIGIN=https://你的域名 node --import tsx apps/api/src/main.ts
NODE_ENV=production npm run start -w @echo/web
# 再用任意反向代理把 /api/*（除 /api/og）转发到 :8787，其余转发到 :3000
```
