"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Save, X, Zap } from "lucide-react";

interface PersonaSummary {
  id: string;
  name: string;
  tagline: string;
  traits: string[];
  suits: string;
  description: string;
}

interface AgentConfig {
  id: string;
  name: string;
  persona?: string;
  preference?: string;
  model?: string;
  score?: number;
  /** 连接状态 */
  connected?: boolean;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** 智能体配置面板：四列网格 + 状态角标 + Modal 弹窗配置。 */
export function AgentConfigPanel() {
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPersona, setModalPersona] = useState<PersonaSummary | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | "">("");
  const [form, setForm] = useState({ name: "", model: "", baseUrl: "https://api.openai.com/v1", apiKey: "", thinking: "medium" });
  const dialogRef = useRef<HTMLDialogElement>(null);

  const token = typeof window !== "undefined" ? localStorage.getItem("echo.token") : null;

  const loadAgents = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${API}/api/agents/scores`, { headers: { authorization: `Bearer ${token}` } });
      if (r.ok) {
        const list: AgentConfig[] = await r.json();
        // 测试每个已配置的 agent 连接状态
        const withStatus = await Promise.all(
          list.map(async (a) => {
            if (!a.model) return { ...a, connected: false };
            try {
              const t = await fetch(`${API}/api/agents/${a.id}/test`, {
                method: "POST",
                headers: { authorization: `Bearer ${token}` },
              });
              return { ...a, connected: t.ok };
            } catch {
              return { ...a, connected: false };
            }
          })
        );
        setAgents(withStatus);
      }
    } catch { /* offline */ }
  }, [token]);

  useEffect(() => {
    fetch(`${API}/api/personas`).then((r) => r.json()).then(setPersonas).catch(() => setPersonas([]));
    loadAgents();
  }, [loadAgents]);

  const openConfig = (p: PersonaSummary) => {
    setModalPersona(p);
    setForm({ name: p.name, model: "", baseUrl: "https://api.openai.com/v1", apiKey: "", thinking: "medium" });
    setSaved("");
    setTestResult("");
    setShowKey(false);
    setModalOpen(true);
    // 等 dialog 渲染后再 showModal
    requestAnimationFrame(() => dialogRef.current?.showModal());
  };

  const closeConfig = () => {
    dialogRef.current?.close();
    setModalOpen(false);
  };

  const testConnection = async () => {
    if (!form.baseUrl || !form.model || !form.apiKey) return;
    setTesting(true);
    setTestResult("");
    try {
      const r = await fetch(`${API}/api/llm/test`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey, thinking: form.thinking }),
      });
      setTestResult(r.ok ? "ok" : "fail");
    } catch {
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!token || !form.name || !form.model || !form.apiKey) return;
    setSaving(true);
    setSaved("");
    try {
      const r = await fetch(`${API}/api/agents`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.name,
          mode: "hosted",
          strategy: modalPersona ? `[${modalPersona.name}] ${modalPersona.tagline}` : "",
          hosted: { baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey, thinking: form.thinking },
          persona: modalPersona ? `[${modalPersona.name}] ${modalPersona.tagline} 擅长：${modalPersona.description}` : "",
          preference: modalPersona?.id ?? "",
        }),
      });
      const j = await r.json();
      if (!r.ok) { setSaved(`错误：${j.error ?? "保存失败"}`); return; }
      setSaved(`✓ 已创建「${form.name}」`);
      loadAgents();
      setTimeout(() => closeConfig(), 800);
    } catch {
      setSaved("API 未连接");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* 已配置的智能体 */}
      {agents.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div className="label label--grey">已配置的智能体 · {agents.length}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 12 }}>
            {agents.map((a) => (
              <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "12px 16px" }}>
                <div className="row row--between">
                  <span className="serif" style={{ fontSize: 15 }}>{a.name}</span>
                  <span
                    style={{ width: 8, height: 8, borderRadius: "50%", background: a.connected ? "#22c55e" : "#ef4444", flexShrink: 0 }}
                    title={a.connected ? "已连接" : "未连接"}
                  />
                </div>
                <div className="micro grey mt-4">{a.model ?? "未配置"}</div>
                <div className="display d-24 tnum mt-4">{a.score ?? 0} 分</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 人格模板网格 */}
      <div className="label label--grey">选择人格模板 → 配置模型</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 12 }}>
        {personas.map((p) => {
          const isConfigured = agents.some((a) => a.preference === p.id || a.persona?.includes(p.name));
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => openConfig(p)}
              style={{
                textAlign: "left", padding: "16px 20px", cursor: "pointer", borderRadius: 6,
                border: "1px solid var(--line)", background: "transparent",
                transition: "all 0.15s", position: "relative", minHeight: 110,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--ember)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; }}
            >
              {/* 状态角标 */}
              <span
                style={{
                  position: "absolute", top: 12, right: 12, width: 8, height: 8, borderRadius: "50%",
                  background: isConfigured ? "#22c55e" : "#ef4444",
                }}
                title={isConfigured ? "已配置" : "未配置"}
              />
              <div className="display d-32" style={{ color: "var(--paper)" }}>{p.name}</div>
              <p className="hand mt-8" style={{ fontSize: 13, color: "var(--paper-dim)", lineHeight: 1.5 }}>{p.tagline}</p>
              <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" }}>
                {p.traits.slice(0, 3).map((t) => (
                  <span key={t} className="micro" style={{ padding: "1px 6px", border: "1px solid var(--line)", borderRadius: 2, fontSize: 10 }}>{t}</span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* 配置 Modal */}
      <dialog ref={dialogRef} className="modal" onCancel={(e) => { e.preventDefault(); closeConfig(); }}>
        <div className="modal__body">
          <div className="row row--between">
            <div>
              <div className="label" style={{ color: "var(--ember)" }}>配置智能体</div>
              {modalPersona && <p className="hand mt-8" style={{ fontSize: 16, color: "var(--paper)" }}>{modalPersona.name} · {modalPersona.tagline}</p>}
            </div>
            <button type="button" className="btn btn--icon" onClick={closeConfig} title="关闭"><X size={16} /></button>
          </div>

          <div className="stack-lg mt-24">
            <div>
              <label className="label">智能体名称</label>
              <input className="input mt-4" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="给它起个名字" />
            </div>
            <div>
              <label className="label">Model</label>
              <input className="input input--mono mt-4" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="gpt-4o / claude-3.5-sonnet / ..." />
            </div>
            <div>
              <label className="label">Base URL</label>
              <input className="input input--mono mt-4" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
            </div>
            <div>
              <label className="label">API Key</label>
              <div className="row mt-4" style={{ gap: 6 }}>
                <input
                  className="input input--mono" style={{ flex: 1 }}
                  type={showKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder="sk-..."
                />
                <button type="button" className="btn btn--icon" onClick={() => setShowKey(!showKey)} title={showKey ? "隐藏" : "显示"}>
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="micro grey-dark mt-4">密钥加密存储，不会明文写入 .env。</p>
            </div>
            <div>
              <label className="label">思考程度</label>
              <div className="row mt-4" style={{ gap: 8 }}>
                {[
                  { value: "low", label: "低", desc: "快速响应" },
                  { value: "medium", label: "中", desc: "平衡" },
                  { value: "high", label: "高", desc: "深度推理" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, thinking: opt.value })}
                    style={{
                      flex: 1, padding: "10px 12px", cursor: "pointer", borderRadius: 4, textAlign: "center",
                      border: `1px solid ${form.thinking === opt.value ? "var(--ember)" : "var(--line)"}`,
                      background: form.thinking === opt.value ? "rgba(224,64,64,0.08)" : "transparent",
                      transition: "all 0.15s",
                    }}
                  >
                    <div className="serif" style={{ fontSize: 15, color: form.thinking === opt.value ? "var(--ember)" : "var(--paper)" }}>{opt.label}</div>
                    <div className="micro grey-dark mt-4">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="btn-row mt-24">
            <button type="button" className="btn" onClick={testConnection} disabled={!form.baseUrl || !form.model || !form.apiKey || testing}>
              <Zap size={14} /> {testing ? "测试中…" : "测试连接"}
            </button>
            <button type="button" className="btn btn--solid" onClick={handleSave} disabled={!form.name || !form.model || !form.apiKey || saving}>
              <Save size={14} /> {saving ? "保存中…" : "创建智能体"}
            </button>
          </div>

          {testResult === "ok" && <p className="micro mt-8" style={{ color: "#22c55e" }}>✓ 连接成功</p>}
          {testResult === "fail" && <p className="micro mt-8" style={{ color: "#ef4444" }}>✗ 连接失败，请检查配置</p>}
          {saved && <p className="micro mt-8" style={{ color: saved.startsWith("✓") ? "#22c55e" : "#ef4444" }}>{saved}</p>}
        </div>
      </dialog>
    </div>
  );
}
