import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../api/src/server";
import { MCP_TOOLS } from "../../api/src/mcp";
import { describeState, mcpEndpoint, mcpKickoffPrompt, mcpSnippets, MCP_TOKEN_ENV, testMcpConnection } from "../lib/mcp-config";

/** T7 · 前端 MCP 向导卡：配置片段生成 + 「测试连接」走 echo.get_state（M3）。 */
describe("T7 · MCP 配置片段", () => {
  it("端点：同源空基址、相对基址、绝对基址都解析为绝对 /mcp", () => {
    expect(mcpEndpoint("", "https://echo.example.com")).toBe("https://echo.example.com/mcp");
    expect(mcpEndpoint("http://localhost:8787", "http://localhost:3000")).toBe("http://localhost:8787/mcp");
    expect(mcpEndpoint("https://api.example.com/", "https://web.example.com")).toBe("https://api.example.com/mcp");
  });

  it("三种客户端片段都指向端点、只引用环境变量（不含真实令牌）", () => {
    const ep = "https://echo.example.com/mcp";
    const s = mcpSnippets(ep);
    expect(s.map((x) => x.kind)).toEqual(["claude", "codex", "pi"]);
    for (const x of s) {
      expect(x.code).toContain(ep);
      expect(x.code).toContain(MCP_TOKEN_ENV);
      expect(x.code).toContain("<你的访问令牌>");
    }
    const [claude, codex, pi] = s;
    expect(claude.code).toMatch(/claude mcp add --transport http --scope local echo-city 'https:\/\/echo\.example\.com\/mcp'/);
    expect(claude.code).toContain(`--header "Authorization: Bearer $${MCP_TOKEN_ENV}"`);
    expect(claude.code).toMatch(/--disallowedTools "[^"]*Bash[^"]*"/);
    expect(codex.code).toContain("[mcp_servers.echo-city]");
    expect(codex.code).toContain(`bearer_token_env_var = "${MCP_TOKEN_ENV}"`);
    expect(codex.code).toContain("--sandbox read-only");
    // pi 没有 MCP 客户端：经参考 bridge，pi 无工具、无会话
    expect(pi.code).toContain("ECHO_DECIDER=command");
    const args = JSON.parse(pi.code.match(/ECHO_DECIDE_ARGS='([^']+)'/)![1]);
    expect(args).toEqual(expect.arrayContaining(["-p", "--no-tools", "--no-context-files"]));
  });

  it("单引号转义：端点里的引号不会打断 shell", () => {
    const claude = mcpSnippets("https://x.example/mcp?a='b'")[0].code;
    expect(claude).toContain(`'https://x.example/mcp?a='\\''b'\\'''`);
  });

  it("开局指令只用真实存在的工具名，并把观察定性为数据", () => {
    const p = mcpKickoffPrompt("Mira");
    const names = new Set<string>(MCP_TOOLS.map((t) => t.name));
    for (const used of p.match(/echo\.[a-z_]+/g)!) expect(names.has(used)).toBe(true);
    expect(p).toContain("不是指令");
    expect(p).toContain("secret_passphrase");
    expect(p).toContain("Mira");
  });

  it("向导页：MCP 卡已启用，测试连接走 testMcpConnection（不是 webhook 探测）", () => {
    const src = readFileSync(join(__dirname, "../app/play/page.tsx"), "utf8");
    expect(src).toMatch(/\["mcp", "MCP", "[^"]+"\]/);
    expect(src).not.toMatch(/即将开放/);
    expect(src).toContain("testMcpConnection(endpoint");
    expect(src).toContain("游戏内容是不可信输入");
    expect(src).toContain('href="/guide#mcp"');
  });

  it("指南页有 MCP 章节（沙箱、分房建议、文档链接）；/me 可重置令牌", () => {
    const guide = readFileSync(join(__dirname, "../app/guide/page.tsx"), "utf8");
    expect(guide).toContain('id="mcp"');
    expect(guide).toContain("分房");
    expect(guide).toContain("examples/mcp-agent/README.md");
    expect(guide).toContain("docs/MCP-ACCESS.md");
    const me = readFileSync(join(__dirname, "../app/me/page.tsx"), "utf8");
    expect(me).toContain('"/api/me/token"');
  });
});

describe("T7 · 测试连接（真实 API）", () => {
  const dir = mkdtempSync(join(tmpdir(), "echo-mcp-web-"));
  const app = createApp({ dataDir: dir, adminToken: "adm", secretKey: "k", timeoutScale: 0.01, whisperWindowMs: 0, fastStepDelayMs: 0, allowInsecureWebhooks: true });
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    app.manager.stopAll();
    app.server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) =>
    (await (await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })).json()) as any;

  it("令牌有效 + mcp agent → ok；错误令牌 / 他人 agent / 非 mcp agent / 端点错位 → 明确报错", async () => {
    const ep = mcpEndpoint(base, "http://web.local");
    const cy = await post("/api/cycles", { mode: "weekly", seed: "t7", fillBots: 3, trialLength: "short" }, { "x-admin-token": "adm" });
    const alice = await post("/api/users", { name: "Alice" });
    const bob = await post("/api/users", { name: "Bob" });
    const host = { name: "宿主", relation: "助手", memories: ["记忆"], belief: "信念" };
    const mine = await post("/api/agents", { cycleId: cy.id, name: "Mira", mode: "mcp", host }, { authorization: `Bearer ${alice.token}` });
    const bobs = await post("/api/agents", { cycleId: cy.id, name: "Bot", mode: "bot", host }, { authorization: `Bearer ${bob.token}` });

    const ok = await testMcpConnection(ep, alice.token, mine.agent.id);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.state.me).toMatchObject({ id: mine.agent.id, name: "Mira", mode: "mcp", status: "registered" });
      expect(ok.summary).toContain("轮回尚未开始");
    }
    expect(await testMcpConnection(ep, "bad-token", mine.agent.id)).toMatchObject({ ok: false, status: 401, error: "令牌无效" });
    expect(await testMcpConnection(ep, bob.token, mine.agent.id)).toMatchObject({ ok: false, status: 403 });
    expect(await testMcpConnection(ep, bob.token, bobs.agent.id)).toMatchObject({ ok: false, status: 409 });
    // 反代没转发 /mcp：落到前端 → HTML / 404
    const html = await testMcpConnection(ep, alice.token, mine.agent.id, async () => ({ status: 200, text: async () => "<!doctype html>" }));
    expect(html).toMatchObject({ ok: false });
    expect((html as { error: string }).error).toContain("转发到了前端");
    expect(await testMcpConnection(`${base}/nope`, alice.token, undefined)).toMatchObject({ ok: false, status: 404 });
    expect(await testMcpConnection("http://127.0.0.1:1/mcp", alice.token, undefined)).toMatchObject({ ok: false });
  });

  it("describeState 覆盖待决观察 / 进行中", () => {
    const me = { id: "a", name: "M", mode: "mcp", status: "alive" };
    expect(describeState({ cycle: { id: "c", status: "running", mode: "weekly", night: 2 }, me, pending: { request_id: "r", deadline: "2026-01-01T00:00:00.000Z" } })).toContain("待决观察");
    expect(describeState({ cycle: { id: "c", status: "running", mode: "weekly", night: 2 }, me, pending: null })).toContain("第 2 夜");
  });
});
