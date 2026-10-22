/**
 * 命令行入口。只读取下列环境变量，不读取任何文件或宿主凭据：
 *
 *   ECHO_MCP_URL     平台 MCP 地址，如 https://echo.example.com/mcp
 *   ECHO_MCP_TOKEN   你的用户令牌（只发往 ECHO_MCP_URL，绝不传给决策进程）
 *   ECHO_DECIDER     stdin（默认，手动/管道） | auto（挂机：总是第一个合法动作） | command
 *   ECHO_DECIDE_CMD  command 模式：决策程序，如 claude
 *   ECHO_DECIDE_ARGS command 模式：JSON 数组参数，如 ["-p","--allowedTools",""]
 *   ECHO_SANDBOX_DIR command 模式：专用空目录（决策进程的 cwd 与 HOME）
 *   ECHO_PASS_ENV    command 模式：逗号分隔的额外透传变量名（如 ANTHROPIC_API_KEY）
 *
 * 用法见 ../README.md（务必先读其中的沙箱警告）。
 */
import { createInterface } from "node:readline/promises";
import { autoDecider, commandDecider, lineDecider, McpClient, runBridge, type Decider } from "./bridge";

const env = process.env;
const url = env.ECHO_MCP_URL ?? "http://localhost:8787/mcp";
const token = env.ECHO_MCP_TOKEN;
if (!token) {
  console.error("需要 ECHO_MCP_TOKEN（POST /api/users 返回的 token）");
  process.exit(2);
}

function decider(): Decider {
  const kind = env.ECHO_DECIDER ?? "stdin";
  if (kind === "auto") return autoDecider;
  if (kind === "command") {
    if (!env.ECHO_DECIDE_CMD || !env.ECHO_SANDBOX_DIR) throw new Error("command 模式需要 ECHO_DECIDE_CMD 与 ECHO_SANDBOX_DIR");
    const args = env.ECHO_DECIDE_ARGS ? (JSON.parse(env.ECHO_DECIDE_ARGS) as string[]) : [];
    return commandDecider({ command: env.ECHO_DECIDE_CMD, args, workdir: env.ECHO_SANDBOX_DIR, passEnv: (env.ECHO_PASS_ENV ?? "").split(",").map((x) => x.trim()).filter(Boolean) });
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return lineDecider((prompt) => rl.question(prompt));
}

const ctrl = new AbortController();
process.once("SIGINT", () => ctrl.abort());
const stats = await runBridge({ client: new McpClient(url, token), decide: decider(), signal: ctrl.signal });
console.error(`[bridge] 观察 ${stats.observations} · 提交 ${stats.submitted} · 拦截泄露 ${stats.blockedLeaks} · 错误 ${stats.errors}`);
process.exit(0);
