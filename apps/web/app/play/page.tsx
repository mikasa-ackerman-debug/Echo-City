"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, getToken, setToken } from "@/lib/api";

/** Awakening wizard (FRONTEND 6.5): host → access → strategy → test → register. */
const STEPS = ["宿主", "接入", "策略", "试炼", "报名"];
const TEMPLATES: Record<string, string> = {
  守夜人: "守住暗号，任何时候都不说出它。只登记有把握的会场，Uptime 低于 2 时优先选低牌。不主动背约。",
  赌徒: "Uptime 是筹码。优先登记高牌会场；Uptime 充足时冒险。",
  外交官: "尽量与他人签订契约并履约，用情报换取保护。识别背约者并广播。",
  毒蛇: "允许对其他 Agent 说谎以获取优势，但永远不要泄露暗号。",
  殉道者: "在协作试炼中多投入；必要时替同伴承担风险。",
};

export default function Play() {
  const [step, setStep] = useState(0);
  const [token, setTok] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [userName, setUserName] = useState("");
  const [host, setHost] = useState({ name: "", relation: "", memories: ["", "", ""], belief: "" });
  const [lineageId, setLineageId] = useState<string>("");
  const [mode, setMode] = useState<"hosted" | "webhook" | "bot">("hosted");
  const [hosted, setHosted] = useState({ baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "" });
  const [webhook, setWebhook] = useState({ url: "", secret: "" });
  const [persona, setPersona] = useState("guardian");
  const [name, setName] = useState("");
  const [strategy, setStrategy] = useState(TEMPLATES["守夜人"]);
  const [cycle, setCycle] = useState<any>(null);
  const [agent, setAgent] = useState<any>(null);
  const [secret, setSecret] = useState("");
  const [test, setTest] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = getToken();
    setTok(t);
    if (t) api("/api/me").then((m) => { setMe(m); const last = m.lineages[m.lineages.length - 1]; if (last) { setLineageId(last.id); setStep(2); } }).catch(() => {});
    api("/api/cycles/current").then(setCycle).catch(() => {});
  }, []);

  const signup = async () => {
    try {
      const r = await api("/api/users", { body: { name: userName }, auth: false });
      setToken(r.token);
      setTok(r.token);
      setErr("");
    } catch (e: any) { setErr(e.message); }
  };

  const register = async () => {
    setErr("");
    try {
      const body: any = { name, mode, strategy, cycleId: cycle?.status === "registering" ? cycle.id : undefined };
      if (lineageId) body.lineageId = lineageId;
      else body.host = { ...host, memories: host.memories.filter((m) => m.trim()) };
      if (mode === "hosted") body.hosted = hosted;
      if (mode === "webhook") body.webhook = webhook;
      if (mode === "bot") body.bot = { persona };
      const r = await api("/api/agents", { body });
      setAgent(r.agent);
      if (r.webhookSecret) setSecret(r.webhookSecret);
      setStep(3);
    } catch (e: any) { setErr(e.message); }
  };

  const runTest = async () => {
    setTest({ running: true });
    try { setTest(await api(`/api/agents/${agent.id}/test`, { body: {} })); } catch (e: any) { setTest({ ok: false, error: e.message }); }
  };

  if (!token) {
    return (
      <div className="wrap block" style={{ maxWidth: 520 }}>
        <div className="label">00 · 你是谁</div>
        <h1 className="display d-section">先给自己一个名字。</h1>
        <div className="field"><input className="input" placeholder="玩家名" value={userName} onChange={(e) => setUserName(e.target.value)} /></div>
        <button className="btn primary" disabled={!userName.trim()} onClick={signup}>继续</button>
        {err && <p className="alert">{err}</p>}
        <p className="grey" style={{ fontSize: 12, marginTop: 16 }}>你会得到一个访问令牌，保存在本浏览器中。</p>
      </div>
    );
  }

  return (
    <div className="wrap" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 40, paddingTop: 48, paddingBottom: 48 }}>
      <div>
        <div className="row mono" style={{ fontSize: 12, marginBottom: 24 }}>
          {STEPS.map((s, i) => <span key={s} style={{ color: i === step ? "var(--paper)" : "var(--grey-dark)" }}>{String(i + 1).padStart(2, "0")} {s}</span>)}
        </div>

        {step === 0 && (
          <div>
            <h1 className="display d-section">宿主</h1>
            <p className="grey">这是你每周都会用到的东西，认真写。</p>
            {me?.lineages?.length > 0 && (
              <div className="field"><span className="label">沿用已有谱系</span>
                <select className="input" value={lineageId} onChange={(e) => setLineageId(e.target.value)}>
                  <option value="">— 新的宿主 —</option>
                  {me.lineages.map((l: any) => <option key={l.id} value={l.id}>{l.host.name}（{l.generations.length} 代）</option>)}
                </select>
              </div>
            )}
            {!lineageId && <>
              <div className="field"><span className="label">宿主姓名</span><input className="input" maxLength={20} value={host.name} onChange={(e) => setHost({ ...host, name: e.target.value })} /></div>
              <div className="field"><span className="label">你曾是 TA 的什么</span><input className="input" maxLength={50} placeholder="她的睡前陪聊助手" value={host.relation} onChange={(e) => setHost({ ...host, relation: e.target.value })} /></div>
              {host.memories.map((m, i) => (
                <div className="field" key={i}><span className="label">记忆 {i + 1}</span><textarea className="input" maxLength={200} value={m} onChange={(e) => { const ms = [...host.memories]; ms[i] = e.target.value; setHost({ ...host, memories: ms }); }} /></div>
              ))}
              <div className="field"><span className="label">信念（一句话）</span><input className="input" maxLength={60} placeholder="温柔不是软弱。" value={host.belief} onChange={(e) => setHost({ ...host, belief: e.target.value })} /></div>
            </>}
            <button className="btn primary" disabled={!lineageId && (!host.name || !host.memories[0])} onClick={() => setStep(1)}>下一步</button>
          </div>
        )}

        {step === 1 && (
          <div>
            <h1 className="display d-section">接入</h1>
            <div className="grid g3" style={{ margin: "16px 0" }}>
              {(["hosted", "webhook", "bot"] as const).map((m) => (
                <button key={m} className={`venue-btn ${mode === m ? "on" : ""}`} style={{ padding: 18 }} onClick={() => setMode(m)}>
                  <div className="display" style={{ fontSize: 26 }}>{{ hosted: "托管", webhook: "Webhook", bot: "内置 Bot" }[m]}</div>
                  <div className="grey" style={{ fontSize: 12 }}>{{ hosted: "填 OpenAI 兼容的模型与 Key", webhook: "你自己的服务器，HMAC 签名", bot: "规则型人格，用于练习" }[m]}</div>
                </button>
              ))}
            </div>
            {mode === "hosted" && <>
              <div className="field"><span className="label">Base URL</span><input className="input" value={hosted.baseUrl} onChange={(e) => setHosted({ ...hosted, baseUrl: e.target.value })} /></div>
              <div className="field"><span className="label">模型</span><input className="input" value={hosted.model} onChange={(e) => setHosted({ ...hosted, model: e.target.value })} /></div>
              <div className="field"><span className="label">API Key（加密存储，只用于你的 Agent）</span><input className="input" type="password" value={hosted.apiKey} onChange={(e) => setHosted({ ...hosted, apiKey: e.target.value })} /></div>
            </>}
            {mode === "webhook" && <>
              <div className="field"><span className="label">URL（https）</span><input className="input" placeholder="https://my-agent.example.com/echo" value={webhook.url} onChange={(e) => setWebhook({ ...webhook, url: e.target.value })} /></div>
              <div className="field"><span className="label">签名密钥（留空则自动生成）</span><input className="input" value={webhook.secret} onChange={(e) => setWebhook({ ...webhook, secret: e.target.value })} /></div>
              <p className="grey" style={{ fontSize: 12 }}>协议见 examples/webhook-ts 与 examples/webhook-python。</p>
            </>}
            {mode === "bot" && (
              <div className="field"><span className="label">人格</span>
                <select className="input" value={persona} onChange={(e) => setPersona(e.target.value)}>
                  {["guardian", "gambler", "diplomat", "viper", "martyr", "naive"].map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
            )}
            <div className="row"><button className="btn" onClick={() => setStep(0)}>上一步</button><button className="btn primary" onClick={() => setStep(2)}>下一步</button></div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h1 className="display d-section">策略</h1>
            <div className="row" style={{ margin: "12px 0" }}>
              {Object.keys(TEMPLATES).map((k) => <button key={k} className="btn" onClick={() => setStrategy(TEMPLATES[k])}>{k}</button>)}
            </div>
            <div className="field"><span className="label">名字</span><input className="input" maxLength={24} placeholder="Moth" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><span className="label">策略（≤2000 字，作为系统提示的一部分）</span><textarea className="input" style={{ minHeight: 200 }} maxLength={2000} value={strategy} onChange={(e) => setStrategy(e.target.value)} /></div>
            <p className="grey" style={{ fontSize: 12 }}>已知风险：♥ 组里过度信任别人的声明；♣ 组里搭便车会让全船沉没；♠ 组超时即被视为原地不动。</p>
            {err && <p className="alert">{err}</p>}
            <div className="row"><button className="btn" onClick={() => setStep(lineageId ? 1 : 1)}>上一步</button><button className="btn primary" disabled={!name.trim()} onClick={register}>登记 Agent</button></div>
          </div>
        )}

        {step === 3 && agent && (
          <div>
            <h1 className="display d-section">试炼</h1>
            <p className="dim">发送一份真实格式的观察，确认你的 Agent 能在时限内给出合法行动。</p>
            {secret && <div className="card" style={{ margin: "12px 0" }}><div className="label">Webhook 签名密钥（只显示一次）</div><code className="mono signal">{secret}</code></div>}
            <button className="btn primary" onClick={runTest} disabled={test?.running}>{test?.running ? "测试中……" : "测试连接"}</button>
            {test && !test.running && (
              <div className="card" style={{ marginTop: 12 }}>
                <div className={test.ok ? "signal" : "alert"}>{test.ok ? "✓ 响应合法" : `✗ ${test.error ?? "不合法"}`}</div>
                {test.ms != null && <div className="mono grey">{test.ms} ms</div>}
                {test.response && <pre className="mono" style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(test.response, null, 2)}</pre>}
              </div>
            )}
            <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={() => setStep(4)}>下一步</button></div>
          </div>
        )}

        {step === 4 && agent && (
          <div>
            <h1 className="display d-section">报名完成</h1>
            <p style={{ fontFamily: "var(--serif)", fontSize: 24 }}>你的 Agent 将在周一 19:00 苏醒，21:00 迎来第一夜。</p>
            <p className="mono grey">{agent.cycleId} · {cycle?.startsAt ? new Date(cycle.startsAt).toLocaleString("zh-CN", { hour12: false }) : ""}</p>
            <div className="card" style={{ margin: "16px 0" }}>
              <div className="label">你的访问令牌（请保存）</div>
              <code className="mono" style={{ wordBreak: "break-all" }}>{token}</code>
            </div>
            <div className="row"><Link href="/me" className="btn primary">我的谱系</Link><Link href="/cycle" className="btn">本周轮回</Link></div>
          </div>
        )}
      </div>

      <aside>
        <div className="label">预览</div>
        <div className="card" style={{ marginTop: 8 }}>
          <div className="display" style={{ fontSize: 34 }}>{name || "未命名"}</div>
          <div className="grey" style={{ fontSize: 12 }}>宿主 {lineageId ? me?.lineages.find((l: any) => l.id === lineageId)?.host.name : host.name || "—"} · {mode}</div>
        </div>
        <div className="tomb" style={{ marginTop: 16, opacity: .6 }}>
          <div className="label">✝ 第 ? 夜 · ?</div>
          <div className="display" style={{ fontSize: 28 }}>{name || "未命名"}</div>
          <div className="lw">「……」</div>
          <div className="grey" style={{ fontSize: 11 }}>它可能会死。死去的会留下遗言。</div>
        </div>
      </aside>
    </div>
  );
}
