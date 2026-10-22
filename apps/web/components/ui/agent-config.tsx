"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Eye, EyeOff, Save, Zap } from "lucide-react";

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
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** 智能体配置面板：选择人格 → 填 model / baseUrl / apiKey → 保存。 */
export function AgentConfigPanel() {
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [openPersona, setOpenPersona] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState("");
  const [form, setForm] = useState({ name: "", model: "", baseUrl: "https://api.openai.com/v1", apiKey: "", personaId: "", personaPrompt: "" });

  const token = typeof window !== "undefined" ? localStorage.getItem("echo.token") : null;

  const loadAgents = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${API}/api/agents/scores`, { headers: { authorization: `Bearer ${token}` } });
      if (r.ok) setAgents(await r.json());
    } catch { /* offline */ }
  }, [token]);

  useEffect(() => {
    fetch(`${API}/api/personas`).then((r) => r.json()).then(setPersonas).catch(() => setPersonas([]));
    loadAgents();
  }, [loadAgents]);

  const handleSave = async () => {
    if (!token) return;
    setSaved("");
    try {
      // Create an agent with the config
      const r = await fetch(`${API}/api/agents`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.name,
          mode: "hosted",
          strategy: form.personaPrompt.slice(0, 200),
          hosted: { baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey },
          persona: form.personaPrompt,
          preference: form.personaId,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setSaved(`错误：${j.error ?? "保存失败"}`); return; }
      setSaved(`✓ 已创建「${form.name}」`);
      setForm({ name: "", model: "", baseUrl: form.baseUrl, apiKey: "", personaId: "", personaPrompt: "" });
      setOpenPersona(null);
      loadAgents();
    } catch { setSaved("API 未连接"); }
  };

  return (
    <div>
      {/* Existing agents */}
      {agents.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="label label--grey">已配置的智能体 · {agents.length}</div>
          <div style={{ marginTop: 8 }}>
            {agents.map((a) => (
              <div key={a.id} className="sessions__row" style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
                <span className="serif">{a.name}</span>
                <span className="micro grey">{a.model ?? "未配置模型"}</span>
                <span className="micro grey">人格：{a.persona ? "已设置" : "—"}</span>
                <span className="display d-24 tnum" style={{ marginLeft: "auto" }}>{a.score ?? 0} 分</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Persona templates */}
      <div className="label label--grey">选择人格模板 → 配置模型</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 16 }}>
        {personas.map((p) => {
          const isOpen = openPersona === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setOpenPersona(isOpen ? null : p.id);
                setForm((f) => ({ ...f, personaId: p.id, personaPrompt: `[${p.name}] ${p.tagline} 擅长：${p.description}`, name: f.name || p.name }));
              }}
              style={{
                textAlign: "left", padding: "20px 24px", cursor: "pointer", borderRadius: 6,
                border: `1px solid ${isOpen ? "var(--ember)" : "var(--line)"}`,
                background: isOpen ? "rgba(224,64,64,0.06)" : "transparent",
                transition: "all 0.15s", minHeight: 120,
              }}
            >
              <div className="row row--between">
                <span className="display d-32" style={{ color: isOpen ? "var(--ember)" : "var(--paper)" }}>{p.name}</span>
                {isOpen ? <ChevronDown size={16} className="grey" /> : <ChevronRight size={16} className="grey" />}
              </div>
              <p className="hand mt-8" style={{ fontSize: 15, color: "var(--paper)", lineHeight: 1.5 }}>{p.tagline}</p>
              <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                {p.traits.map((t) => (
                  <span key={t} className="micro" style={{ padding: "2px 8px", border: "1px solid var(--line)", borderRadius: 3, fontSize: 11 }}>{t}</span>
                ))}
              </div>
              <div className="micro grey-dark mt-8" style={{ fontSize: 11 }}>{p.suits} · {p.description}</div>
            </button>
          );
        })}
      </div>

      {/* Config form below grid */}
      {openPersona && (
        <div className="panel mt-16" style={{ borderColor: "var(--ember)" }}>
          <div className="panel__head">
            <span className="label" style={{ color: "var(--ember)" }}>配置「{personas.find((p) => p.id === openPersona)?.name}」</span>
            <span className="micro">{personas.find((p) => p.id === openPersona)?.tagline}</span>
          </div>
          <div className="panel__body">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
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
                  <input className="input input--mono" style={{ flex: 1 }} type={showKey ? "text" : "password"} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." />
                  <button type="button" className="btn btn--icon" onClick={() => setShowKey(!showKey)} title={showKey ? "隐藏" : "显示"}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                </div>
              </div>
            </div>
            <div className="btn-row mt-16">
              <button type="button" className="btn btn--solid" onClick={handleSave} disabled={!form.name || !form.model || !form.apiKey}>
                <Save size={14} /> 创建智能体
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setOpenPersona(null)}>取消</button>
            </div>
            {saved && <p className="micro mt-8" style={{ color: saved.startsWith("✓") ? "var(--ember)" : "#e04040" }}>{saved}</p>}
            <p className="micro grey-dark mt-8">密钥加密存储，不会明文写入 .env。</p>
          </div>
        </div>
      )}
    </div>
  );
}
