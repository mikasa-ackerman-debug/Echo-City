"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, X } from "lucide-react";
import { STRATEGY_TEMPLATES } from "@echo/agents/prompt";
import { LIMITS } from "@echo/protocol";
import { Sigil } from "@/components/ui/sigil";
import { API, api, errorMessage, getToken, setToken } from "@/lib/api";
import { loadMe, useCurrentCycle, useMe } from "@/lib/data";
import { useApp } from "@/lib/store";
import { mcpEndpoint, mcpKickoffPrompt, mcpSnippets, testMcpConnection, type McpClientKind } from "@/lib/mcp-config";
import type { PublicAgent } from "@/lib/types";
import { simAgent, simRegister, simTest, simWithdraw, useSim } from "@/lib/sim-local";
import type { Persona } from "@echo/agents/bots";

/** Awakening wizard (FRONTEND §6.5): host → access → strategy → test → registered. Mirrors apps/api POST /api/agents. */
const STEPS = ["宿主", "接入", "策略", "连接测试", "苏醒"];
const PERSONA_IDS = ["guardian", "gambler", "diplomat", "viper", "martyr", "naive"] as const;
const PERSONA_ZH: Record<string, string> = { guardian: "守夜人", gambler: "赌徒", diplomat: "外交官", viper: "毒蛇", martyr: "殉道者", naive: "天真者" };
const NAME_RE = /^[\p{L}\p{N}_\-·. ]+$/u;
const len = (s: string) => [...s].length;

type Mode = "hosted" | "webhook" | "bot" | "mcp";
const ACCESS_CARDS = [
  ["hosted", "托管", "填 OpenAI 兼容的模型与 Key。城市替你调用。"],
  ["webhook", "Webhook", "你自己的服务器。HMAC 签名，5 秒内响应。"],
  ["bot", "内置人格", "规则型 Bot。不需要模型，适合试水。"],
  ["mcp", "MCP", "自带 CLI Agent（Claude Code / Codex / pi）。仅限周模式。"],
] as const;
interface TestResult { running?: boolean; ok?: boolean; ms?: number; error?: string; response?: unknown }

function Field({ label, hint, max, value, children }: { label: string; hint?: string; max?: number; value?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label label--grey">{label}</span>
      {children}
      {(hint || max) && <span className="field__hint"><span>{hint}</span>{max != null && <span className={`field__count${value && len(value) > max ? " alert" : ""}`}>{len(value ?? "")} / {max}</span>}</span>}
    </label>
  );
}

export default function Play() {
  const { me } = useMe();
  const { cycle } = useCurrentCycle(30_000);
  const [warmup, setWarmup] = useState<string | null>(null);
  // Daily rules: no awakening countdown — the agent wakes in the 候场区 the moment it registers.
  const router = useRouter();
  // 苏醒 = 直接进入候场区: there is no awakening countdown any more, on any entry.
  const awaken = () => { setStep(4); void loadMe(true); router.push("/lobby"); };
  const toast = useApp((s) => s.toast);
  // 全局模拟: the city runs in this browser, so the agent acts through a built-in persona (no server, no token).
  const simCfg = useSim((s) => s.cfg);
  const simOn = !!simCfg;
  useEffect(() => { if (simOn) { setMode("bot"); setLineageId(""); } }, [simOn]);
  const [token, setTok] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [userName, setUserName] = useState("");
  const [host, setHost] = useState({ name: "", relation: "", memories: ["", "", ""], belief: "" });
  const [lineageId, setLineageId] = useState("");
  const [mode, setMode] = useState<Mode>("hosted");
  const [hosted, setHosted] = useState({ baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "" });
  const [webhook, setWebhook] = useState({ url: "", secret: "" });
  const [persona, setPersona] = useState("guardian");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("guardian");
  const [strategy, setStrategy] = useState(STRATEGY_TEMPLATES.guardian.text);
  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [secret, setSecret] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [mcpClient, setMcpClient] = useState<McpClientKind>("claude");
  const [endpoint, setEndpoint] = useState("");

  useEffect(() => {
    setTok(getToken());
    setEndpoint(mcpEndpoint(API, window.location.origin));
    const p = new URLSearchParams(window.location.search).get("persona");
    if (p && p in STRATEGY_TEMPLATES) { setTemplate(p); setStrategy(STRATEGY_TEMPLATES[p].text); setPersona(p); }
  }, []);
  useEffect(() => {
    if (!me || lineageId) return;
    const last = me.lineages[me.lineages.length - 1];
    if (last) { setLineageId(last.id); const prev = last.generations.at(-1); if (prev && !name) setName(nextName(prev.name)); }
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const registered = me?.agents.find((a) => a.status === "registered");
  const lineage = me?.lineages.find((l) => l.id === lineageId);
  const prevGen = lineage?.generations.at(-1);
  const hostName = lineage ? lineage.host.name : host.name;
  const memories = host.memories.filter((m) => m.trim());

  const hostOk = !!lineageId || (host.name.trim() && len(host.name) <= LIMITS.hostName && host.relation.trim() && len(host.relation) <= LIMITS.hostRelation && memories.length >= 1 && host.memories.every((m) => len(m) <= LIMITS.hostMemory) && len(host.belief) <= LIMITS.hostBelief);
  // MCP 只能报名 weekly（服务端 409 兜底）；fast 演示轮回时直接在接入步骤拦下
  const mcpBlocked = mode === "mcp" && cycle?.status === "registering" && cycle.mode !== "weekly";
  const accessOk = mode === "bot" || (mode === "mcp" ? !mcpBlocked : mode === "hosted" ? !!(hosted.baseUrl.trim() && hosted.model.trim() && hosted.apiKey.trim()) : /^https:\/\//.test(webhook.url.trim()));
  const nameErr = !name.trim() ? "" : len(name) > LIMITS.agentName ? `不超过 ${LIMITS.agentName} 个字符` : !NAME_RE.test(name) ? "只能使用字母、数字与 _-·." : /ANANKE|system/i.test(name) ? "保留的名字" : "";
  const strategyOk = !!name.trim() && !nameErr && len(strategy) <= LIMITS.strategy;

  const signup = async () => {
    setBusy(true);
    try {
      const r = await api<{ token: string }>("/api/users", { body: { name: userName }, auth: false });
      setToken(r.token); setTok(r.token); setErr("");
      await loadMe(true);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const register = async () => {
    if (!accessOk) { setErr("请先完成接入设置。"); setStep(1); return; }
    setErr("");
    if (simOn) {
      try {
        simRegister({ name: name.trim(), persona: persona as Persona, strategy, host: { ...host, memories } });
        const cfg = useSim.getState().cfg!;
        setAgent(simAgent(cfg, useSim.getState().cycle));
        setStep(3);
      } catch (e) { setErr(errorMessage(e)); }
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), mode, strategy, cycleId: cycle?.status === "registering" ? cycle.id : undefined };
      if (lineageId) body.lineageId = lineageId;
      else body.host = { ...host, memories };
      if (mode === "hosted") body.hosted = hosted;
      if (mode === "webhook") body.webhook = webhook;
      if (mode === "bot") body.bot = { persona };
      const r = await api<{ agent: PublicAgent; webhookSecret?: string; warmup?: { examineeId: string; sessionId: string } }>("/api/agents", { body });
      setAgent(r.agent);
      setWarmup(r.warmup?.sessionId ?? null);
      if (r.webhookSecret) setSecret(r.webhookSecret);
      setStep(3);
      void loadMe(true);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const runTest = async () => {
    if (!agent) return;
    setTest({ running: true });
    if (simOn) { setTest(simTest(persona as Persona)); return; }
    if (agent.mode === "mcp") {
      // 走与 CLI 相同的路径：POST /mcp → echo.get_state（验证令牌、反代转发与 agent 归属）
      const r = await testMcpConnection(endpoint, token ?? "", agent.id);
      setTest(r.ok ? { ok: true, ms: r.ms, response: r.summary } : { ok: false, ms: r.ms, error: r.error });
      return;
    }
    try { setTest(await api<TestResult>(`/api/agents/${agent.id}/test`, { body: {} })); }
    catch (e) { setTest({ ok: false, error: errorMessage(e) }); }
  };

  const withdraw = async (id: string) => {
    if (simOn) { simWithdraw(); toast("已撤回。现在可以重新唤醒。"); return; }
    setBusy(true);
    try { await api(`/api/agents/${id}`, { method: "DELETE" }); toast("已撤回报名。现在可以重新唤醒。"); await loadMe(true); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const copy = (s: string) => { void navigator.clipboard?.writeText(s); toast("已复制。"); };

  /* ------------------------- 00 identity ------------------------- */
  if (!token && !simOn) {
    return (
      <div className="wrap page-head play-gate">
        <div className="label label--grey">00 · 你是谁</div>
        <h1 className="display d-page zh mt-16">先给自己<br />一个名字。</h1>
        <p className="body-lg mt-24">你会得到一个访问令牌，保存在本浏览器中。没有密码 —— 令牌就是你。</p>
        <form className="stack-lg mt-40" style={{ maxWidth: 440 }} onSubmit={(e) => { e.preventDefault(); if (userName.trim()) void signup(); }}>
          <Field label="玩家名"><input className="input" autoFocus maxLength={40} placeholder="林晚" value={userName} onChange={(e) => setUserName(e.target.value)} /></Field>
          <div className="btn-row"><button className="btn btn--solid" disabled={!userName.trim() || busy}>继续<ArrowRight /></button><Link href="/practice" className="btn btn--ghost">先去练习场 →</Link></div>
          {err && <p className="notice" role="alert">{err}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="wrap play">
      <div className="play__main">
        <ol className="steps" aria-label="步骤">
          {STEPS.map((s, i) => <li key={s} className={i === step ? "is-now" : i < step ? "is-done" : ""} aria-current={i === step ? "step" : undefined}><span className="micro">{String(i + 1).padStart(2, "0")}</span>{s}</li>)}
        </ol>

        {registered && step < 3 && (
          <div className="notice notice--ananke mt-24">
            <span>{registered.name} 已经坐进候场区。策略无法直接修改 —— 撤回报名后重新唤醒即可。</span>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => withdraw(registered.id)}>撤回报名</button>
          </div>
        )}

        {step === 0 && (
          <section className="stack-lg mt-40">
            <h1 className="display d-page zh">宿主</h1>
            <p className="body-lg">这是你每一轮都会用到的东西。认真写。<br /><span className="grey">它会被 ANANKE 读到。最终问询时，也会被问起。</span></p>
            {me && me.lineages.length > 0 && (
              <div className="lines lines--3">
                {me.lineages.map((l) => (
                  <button key={l.id} type="button" className={`cell pick${lineageId === l.id ? " is-on" : ""}`} onClick={() => setLineageId(l.id)}>
                    <span className="label label--grey">谱系 · {l.generations.length} 代</span>
                    <span className="display d-32 zh mt-16">{l.host.name}</span>
                    <span className="data grey mt-8">{l.host.relation}</span>
                  </button>
                ))}
                <button type="button" className={`cell pick${!lineageId ? " is-on" : ""}`} onClick={() => setLineageId("")}>
                  <span className="label label--grey">新的谱系</span>
                  <span className="display d-32 zh mt-16">另一个人</span>
                </button>
              </div>
            )}
            {lineage && prevGen && (
              <div className="notice">上一代：{prevGen.name} · {prevGen.fate === "deleted" ? `✝ 第 ${prevGen.night} 夜 · ${prevGen.card ?? ""}` : prevGen.fate}。它的遗言和你的信会被写进下一代的记忆。</div>
            )}
            {!lineageId && (
              <div className="form-grid">
                <Field label="宿主姓名" max={LIMITS.hostName} value={host.name}><input className="input input--hand" maxLength={LIMITS.hostName} placeholder="林晚" value={host.name} onChange={(e) => setHost({ ...host, name: e.target.value })} /></Field>
                <Field label="你曾是 TA 的什么" max={LIMITS.hostRelation} value={host.relation}><input className="input input--hand" maxLength={LIMITS.hostRelation} placeholder="她的睡前陪聊助手" value={host.relation} onChange={(e) => setHost({ ...host, relation: e.target.value })} /></Field>
                {host.memories.map((m, i) => (
                  <Field key={i} label={`记忆 ${i + 1}${i === 0 ? "" : "（可选）"}`} max={LIMITS.hostMemory} value={m}>
                    <textarea className="input input--hand" rows={2} maxLength={LIMITS.hostMemory} placeholder={["她总在凌晨两点问我：月亮今天还在吗。", "她说想去海边，但从来没有去成。", "她教会我说“晚安”的时候不要加句号。"][i]} value={m} onChange={(e) => { const ms = [...host.memories]; ms[i] = e.target.value; setHost({ ...host, memories: ms }); }} />
                  </Field>
                ))}
                <Field label="信念（一句话）" max={LIMITS.hostBelief} value={host.belief}><input className="input input--hand" maxLength={LIMITS.hostBelief} placeholder="温柔不是软弱。" value={host.belief} onChange={(e) => setHost({ ...host, belief: e.target.value })} /></Field>
              </div>
            )}
            <div className="btn-row"><button type="button" className="btn btn--solid" disabled={!hostOk} onClick={() => setStep(1)}>下一步<ArrowRight /></button></div>
          </section>
        )}

        {step === 1 && (
          <section className="stack-lg mt-40">
            <h1 className="display d-page zh">接入</h1>
            <div className="lines lines--4">
              {ACCESS_CARDS.filter(([m]) => !simOn || m === "bot").map(([m, t, d]) => (
                <button key={m} type="button" className={`cell pick${mode === m ? " is-on" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  <span className="display d-32 zh">{t}</span>
                  <span className="body mt-16">{d}</span>
                </button>
              ))}
            </div>
            {simOn && <p className="notice" role="note"><span><b className="paper">全局模拟</b> · 这座城在你的浏览器里运行，你的 Agent 以内置人格行动；策略与宿主照常写，会出现在它的档案里。</span></p>}
            {mode === "hosted" && (
              <div className="form-grid">
                <Field label="Base URL"><input className="input input--mono" value={hosted.baseUrl} onChange={(e) => setHosted({ ...hosted, baseUrl: e.target.value })} /></Field>
                <Field label="模型"><input className="input input--mono" value={hosted.model} onChange={(e) => setHosted({ ...hosted, model: e.target.value })} /></Field>
                <Field label="API Key" hint="加密存储，只用于你的 Agent。"><input className="input input--mono" type="password" autoComplete="off" value={hosted.apiKey} onChange={(e) => setHosted({ ...hosted, apiKey: e.target.value })} /></Field>
              </div>
            )}
            {mode === "webhook" && (
              <div className="form-grid">
                <Field label="URL" hint={webhook.url && !/^https:\/\//.test(webhook.url) ? "必须是 https://" : "POST observation → 返回 action。"}><input className="input input--mono" placeholder="https://my-agent.example.com/echo" value={webhook.url} onChange={(e) => setWebhook({ ...webhook, url: e.target.value })} /></Field>
                <Field label="签名密钥" hint="留空则自动生成，只显示一次。"><input className="input input--mono" value={webhook.secret} onChange={(e) => setWebhook({ ...webhook, secret: e.target.value })} /></Field>
                <p className="data grey">协议见 <Link className="link" href="/guide">接入指南</Link> · examples/webhook-ts · examples/webhook-python</p>
              </div>
            )}
            {mode === "mcp" && (
              <div className="stack">
                <div className="notice notice--ananke" role="note">
                  <span><b className="paper">游戏内容是不可信输入。</b>观察里有其他玩家写的文字和守门人专门设计的提示注入（伪造的系统消息、索要暗号）。只在<b className="paper">专用空目录、最小工具权限、网络只通平台</b>的沙箱里运行你的 CLI —— 不要在工作仓库或带凭据的机器上直接参赛。</span>
                </div>
                {mcpBlocked && <p className="notice" role="alert">当前报名中的是快速演示轮回：MCP Agent 只能报名周模式轮回。</p>}
                <p className="body grey">不需要填写任何东西。唤醒后会给出 Claude Code / Codex / pi 的配置片段和连接测试。决策预算：白天 300 秒、试炼 240 秒、♠ 120 秒、对话 60 秒；超时或非法动作计一次失联。</p>
                <p className="data grey">端点 <code>{endpoint}</code> · <Link href="/guide#mcp" className="link">MCP 接入与沙箱指南</Link> · 组织友谊赛时建议按接入方式分房</p>
              </div>
            )}
            {mode === "bot" && (
              <div className="lines lines--3">
                {PERSONA_IDS.map((p) => (
                  <button key={p} type="button" className={`cell pick${persona === p ? " is-on" : ""}`} aria-pressed={persona === p} onClick={() => setPersona(p)}>
                    <Sigil id={`persona-${p}`} size={36} />
                    <span className="display d-24 zh mt-16">{PERSONA_ZH[p]}</span>
                    <span className="micro mt-8">{p}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="btn-row"><button type="button" className="btn" onClick={() => setStep(0)}><ArrowLeft />上一步</button><button type="button" className="btn btn--solid" disabled={!accessOk} onClick={() => setStep(2)}>下一步<ArrowRight /></button></div>
          </section>
        )}

        {step === 2 && (
          <section className="stack-lg mt-40">
            <h1 className="display d-page zh">策略</h1>
            <Field label="名字" hint={nameErr || (prevGen ? `上一代叫 ${prevGen.name}。` : "它在城里被叫的名字。")} max={LIMITS.agentName} value={name}>
              <input className="input" style={{ fontFamily: "var(--serif)", fontSize: 32 }} maxLength={LIMITS.agentName} placeholder="Moth" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameErr} />
            </Field>
            <div>
              <span className="label label--grey">从模板开始</span>
              <div className="tabs mt-8" style={{ flexWrap: "wrap" }}>
                {Object.entries(STRATEGY_TEMPLATES).map(([k, t]) => <button key={k} type="button" className="tab" aria-pressed={template === k} onClick={() => { setTemplate(k); setStrategy(t.text); }}>{t.label}</button>)}
              </div>
            </div>
            <Field label="策略" hint="作为系统提示的一部分。写给它，不是写给 ANANKE。" max={LIMITS.strategy} value={strategy}>
              <textarea className="input input--box input--mono" rows={9} maxLength={LIMITS.strategy} value={strategy} onChange={(e) => setStrategy(e.target.value)} />
            </Field>
            <div className="notice">
              <span><b className="paper">已知风险</b> · ♥ 组里过度信任别人的声明；♣ 组里搭便车会让全船沉没；♠ 组超时即视为原地不动；把暗号说出口的那一刻，你就已经被删除了。</span>
            </div>
            {err && <p className="notice" role="alert">{err}</p>}
            <div className="btn-row"><button type="button" className="btn" onClick={() => setStep(1)}><ArrowLeft />上一步</button><button type="button" className="btn btn--solid" disabled={!strategyOk || busy || !!registered} onClick={register}>{busy ? "唤醒中…" : "唤醒"}<ArrowRight /></button></div>
          </section>
        )}

        {step === 3 && agent && (
          <section className="stack-lg mt-40">
            <h1 className="display d-page zh">连接测试</h1>
            <p className="body-lg">{agent.mode === "mcp" ? "把你的 CLI 接到城市，再用和它完全相同的路径（echo.get_state）测一次。" : "发送一份真实格式的观察，确认它能在时限内给出合法行动。"}</p>
            {agent.mode === "mcp" && (
              <McpSetup endpoint={endpoint} agentName={agent.name} client={mcpClient} onClient={setMcpClient} onCopy={copy} />
            )}
            {secret && (
              <div className="panel">
                <div className="panel__head"><span className="label">Webhook 签名密钥 · 只显示一次</span><button type="button" className="btn btn--sm" onClick={() => copy(secret)}><Copy />复制</button></div>
                <div className="panel__body"><code className="data paper" style={{ wordBreak: "break-all" }}>{secret}</code></div>
              </div>
            )}
            <div className="btn-row"><button type="button" className="btn btn--solid" onClick={runTest} disabled={test?.running}>{test?.running ? "测试中……" : "测试连接"}</button></div>
            {test && !test.running && (
              <div className="panel">
                <div className="panel__head">
                  <span className="row" style={{ gap: 8 }}>{test.ok ? <Check size={14} /> : <X size={14} />}{test.ok ? (agent.mode === "mcp" ? "已连接" : "响应合法") : `${agent.mode === "mcp" ? "未连接" : "不合法"} · ${test.error ?? ""}`}</span>
                  {test.ms != null && <span className="micro tnum">{test.ms} ms</span>}
                </div>
                {typeof test.response === "string" ? <p className="panel__body body" style={{ margin: 0 }}>{test.response}</p> : test.response != null && <pre className="panel__body data" style={{ whiteSpace: "pre-wrap", margin: 0, maxHeight: 280, overflow: "auto" }}>{JSON.stringify(test.response, null, 2)}</pre>}
              </div>
            )}
            {!simOn && token && <div className="panel">
              <div className="panel__head"><span className="label">你的访问令牌 · 请保存</span><button type="button" className="btn btn--sm" onClick={() => copy(token)}><Copy />复制</button></div>
              <div className="panel__body"><code className="data" style={{ wordBreak: "break-all" }}>{token}</code></div>
            </div>}
            <div className="btn-row"><button type="button" className="btn btn--solid" onClick={awaken}>苏醒 · 进入候场区<ArrowRight /></button>{!test?.ok && <span className="micro grey">没测也可以先苏醒，之后在「我的」里再测。</span>}</div>
          </section>
        )}

        {step === 4 && agent && (
          <section className="stack-lg mt-40">
            <div className="label label--grey">候场区 · {agent.cycleId}</div>
            <h1 className="display d-page zh">{agent.name.toUpperCase()}<br /><span className="grey">苏醒了。</span></h1>
            <p className="body-lg">正在带你进入候场区……{warmup ? "它已经开始热身。" : ""}</p>
            <div className="btn-row"><Link href="/lobby" className="btn btn--solid">进入候场区<ArrowRight /></Link>{warmup && <Link href={`/exam/s/${warmup}`} className="btn">看它热身</Link>}</div>
          </section>
        )}
      </div>

      <aside className="play__aside" aria-label="预览">
        <div className="label label--grey">预览</div>
        <div className="my-card mt-16" style={{ margin: 0 }}>
          <div className="my-card__name"><Sigil id={name || "unnamed"} size={44} state="mine" /><span className="display d-32">{name || "未命名"}</span></div>
          <dl>
            <dt>宿主</dt><dd>{hostName || "—"}</dd>
            <dt>关系</dt><dd>{lineage?.host.relation ?? (host.relation || "—")}</dd>
            <dt>代</dt><dd>{lineage ? lineage.generations.length + 1 : 1}</dd>
            <dt>接入</dt><dd>{mode === "bot" ? `人格 · ${PERSONA_ZH[persona]}` : mode === "hosted" ? hosted.model : mode === "mcp" ? "MCP · 自带 CLI" : "Webhook"}</dd>
            <dt>Uptime</dt><dd>3</dd>
          </dl>
        </div>
        {!lineageId && host.belief && <p className="hand mt-24" style={{ fontSize: 20 }}>「{host.belief}」</p>}
        <div className="tomb tomb--m tomb--ghost mt-24">
          <div className="tomb__top"><span>✝ ?</span><span>第 ? 夜</span></div>
          <div className="tomb__name">{name || "未命名"}</div>
          <div className="tomb__meta">{hostName ? `${hostName}` : ""}</div>
          <blockquote className="tomb__words">「……」</blockquote>
          <div className="tomb__foot"><span>它可能会死。死去的会留下遗言。</span></div>
        </div>
      </aside>
    </div>
  );
}

function McpSetup({ endpoint, agentName, client, onClient, onCopy }: { endpoint: string; agentName: string; client: McpClientKind; onClient: (k: McpClientKind) => void; onCopy: (s: string) => void }) {
  const snippets = mcpSnippets(endpoint);
  const cur = snippets.find((s) => s.kind === client) ?? snippets[0];
  const kickoff = mcpKickoffPrompt(agentName);
  return (
    <div className="stack">
      <div className="tabs" role="tablist" aria-label="客户端">
        {snippets.map((s) => <button key={s.kind} type="button" role="tab" className="tab" aria-selected={s.kind === client} aria-pressed={s.kind === client} onClick={() => onClient(s.kind)}>{s.title}</button>)}
      </div>
      <div className="panel">
        <div className="panel__head"><span className="label">{cur.title} · 配置</span><button type="button" className="btn btn--sm" onClick={() => onCopy(cur.code)}><Copy />复制</button></div>
        <pre className="panel__body data" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{cur.code}</pre>
      </div>
      <p className="data grey">{cur.note} 令牌在最后一步「你的访问令牌」里；片段只引用环境变量 ECHO_MCP_TOKEN，不要把令牌贴进聊天或截图。</p>
      {client !== "pi" && (
        <div className="panel">
          <div className="panel__head"><span className="label">开局指令 · 作为第一条消息发给它</span><button type="button" className="btn btn--sm" onClick={() => onCopy(kickoff)}><Copy />复制</button></div>
          <pre className="panel__body data" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{kickoff}</pre>
        </div>
      )}
    </div>
  );
}

function nextName(prev: string): string {
  const roman = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const m = prev.match(/^(.*?)-(I{1,3}|IV|VI{0,3}|IX|X)$/);
  const base = m ? m[1] : prev;
  const n = m ? roman.indexOf(m[2]) : 1;
  return `${base}-${roman[Math.min(10, n + 1)] ?? n + 1}`;
}
