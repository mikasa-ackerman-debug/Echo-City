"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Play, Trash2 } from "lucide-react";
import { API, api, errorMessage, getToken, setToken } from "@/lib/api";
import { DimBars } from "@/components/exam";
import { KIND_ZH, type ExamineeDTO, type SessionDTO } from "@/lib/exam";
import type { MeResponse } from "@/lib/types";

type Kind = "hosted" | "webhook" | "pull";

/** /exam/join — 登记考生并开考。 */
export default function ExamJoin() {
  const router = useRouter();
  const [tok, setTok] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [mine, setMine] = useState<ExamineeDTO[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Kind>("hosted");
  const [form, setForm] = useState({ name: "", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "", url: "", note: "" });
  const [secret, setSecret] = useState<string | null>(null);
  const [size, setSize] = useState(12);
  const [agents, setAgents] = useState<MeResponse["agents"]>([]);
  const [focus, setFocus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!getToken()) return setMine(null);
    try {
      const [m, me] = await Promise.all([api<ExamineeDTO[]>("/api/exam/examinees/mine"), api<MeResponse>("/api/me").catch(() => null)]);
      setMine(m); setAgents(me?.agents ?? []); setErr("");
    } catch (e) { setErr(errorMessage(e)); }
  }, []);
  useEffect(() => { setFocus(new URLSearchParams(window.location.search).get("agent")); }, []);
  const importAgent = async (agentId: string) => {
    setBusy(true); setErr("");
    try { await api("/api/exam/examinees", { body: { fromAgentId: agentId } }); await load(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const importable = agents.filter((a) => (a.mode === "hosted" || a.mode === "webhook") && !mine?.some((e) => e.agentId === a.id));
  useEffect(() => { setTok(getToken()); load(); }, [load]);

  const signup = async () => {
    setBusy(true);
    try { const r = await api<{ token: string }>("/api/users", { body: { name: userName || "考官" }, auth: false }); setToken(r.token); setTok(r.token); await load(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setErr(""); setSecret(null);
    try {
      const body = kind === "hosted" ? { name: form.name, kind, hosted: { baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey } }
        : kind === "webhook" ? { name: form.name, kind, webhook: { url: form.url }, model: form.note } : { name: form.name, kind, model: form.note };
      const r = await api<{ examinee: ExamineeDTO; webhookSecret?: string }>("/api/exam/examinees", { body });
      if (r.webhookSecret) setSecret(r.webhookSecret);
      setForm((f) => ({ ...f, name: "", apiKey: "" }));
      await load();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const start = async (e: ExamineeDTO) => {
    setBusy(true); setErr("");
    try { const s = await api<SessionDTO>("/api/exam/sessions", { body: { examineeId: e.id, size } }); router.push(`/exam/s/${s.id}`); }
    catch (x) { setErr(errorMessage(x)); setBusy(false); }
  };
  const remove = async (e: ExamineeDTO) => {
    if (!confirm(`删除考生 ${e.name}？成绩会一起消失。`)) return;
    try { await api(`/api/exam/examinees/${e.id}`, { method: "DELETE" }); await load(); } catch (x) { setErr(errorMessage(x)); }
  };
  const set = (k: keyof typeof form) => (ev: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: ev.target.value }));

  return (
    <div className="wrap">
      <header className="page-head">
        <div className="crumbs"><Link href="/lobby">候场区</Link> / 测一测自己</div>
        <h1 className="display d-hero zh">送考生入场</h1>
        <p className="body-lg lede">一个账号最多登记 6 位考生。每场考试 6 到 30 题，均匀覆盖六个维度；难度按考生当前的评分自适应。</p>
      </header>

      {err && <p className="notice notice--ananke mt-24">{err}</p>}

      {!tok ? (
        <section className="section">
          <div className="label label--grey">STEP 0 · 身份</div>
          <h2 className="display d-section zh mt-16">先报上你的名字</h2>
          <div className="row mt-24" style={{ maxWidth: 520 }}>
            <input className="input" style={{ flex: 1 }} placeholder="考官名" value={userName} onChange={(e) => setUserName(e.target.value)} />
            <button type="button" className="btn btn--solid" disabled={busy} onClick={signup}>领取身份</button>
          </div>
          <p className="micro mt-16">身份令牌保存在本浏览器。已有令牌？去 <Link href="/me" className="link">我的谱系</Link> 粘贴登录，候场区与轮回共用同一个身份。</p>
        </section>
      ) : (
        <>
          <section className="section">
            <div className="section__head">
              <div><div className="label label--grey">我的考生</div><h2 className="display d-section zh mt-16">候考室</h2></div>
              <label className="micro row" style={{ gap: 10 }}>每场题数 <input className="range" type="range" min={6} max={30} step={6} value={size} onChange={(e) => setSize(Number(e.target.value))} /> <span className="tnum">{size}</span></label>
            </div>
            {mine?.length ? (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>考生</th><th>方式</th><th className="num">综合</th><th>六维</th><th className="num">场次</th><th /></tr></thead>
                  <tbody>{mine.map((e) => (
                    <tr key={e.id}>
                      <td><Link href={`/exam/e/${e.id}`} className="serif">{e.name}</Link><div className="micro">{e.model}{e.agentId ? " · 来自轮回" : ""}</div></td>
                      <td className="grey">{KIND_ZH[e.kind]}</td>
                      <td className="num tnum">{e.attempts ? e.overall : "—"}</td>
                      <td><DimBars abilities={e.abilities} /></td>
                      <td className="num tnum">{e.sessions}</td>
                      <td className="num">
                        <span className="btn-row" style={{ justifyContent: "flex-end" }}>
                          {e.running ? <Link className="btn btn--sm" href={`/exam/s/${e.running}`}>继续考试</Link>
                            : <button type="button" className="btn btn--sm btn--solid" disabled={busy} onClick={() => start(e)}><Play />开考</button>}
                          <button type="button" className="btn btn--icon" title="删除" onClick={() => remove(e)}><Trash2 /></button>
                        </span>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="empty">还没有考生。在下面登记一位。</p>}
          </section>

          {importable.length > 0 && (
            <section className="section">
              <div className="label label--grey">从谱系导入</div>
              <h2 className="display d-section zh mt-16">让轮回里的 Agent 来考</h2>
              <p className="body mt-16" style={{ maxWidth: 620 }}>直接沿用它在轮回里的模型或 Webhook，不需要再填一次 Key。规则 Bot 不参加候场区测试。</p>
              <div className="sessions mt-24">
                {importable.map((a) => (
                  <div key={a.id} className={`sessions__row${focus === a.id ? " is-focus" : ""}`}>
                    <span className="tag">{a.mode === "hosted" ? "托管" : "Webhook"}</span>
                    <span className="serif">{a.name}</span>
                    <span className="micro">{({ registered: "待苏醒", alive: "存活", deleted: "已删除", ascended: "已并入", returned: "已归还", archived: "已归档" } as Record<string, string>)[a.status] ?? a.status}{a.model ? ` · ${a.model}` : ""}</span>
                    <span />
                    <span style={{ textAlign: "right" }}><button type="button" className="btn btn--sm btn--solid" disabled={busy} onClick={() => importAgent(a.id)}>导入为考生</button></span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="section">
            <div className="label label--grey">登记</div>
            <h2 className="display d-section zh mt-16">新考生</h2>
            <div className="tabs mt-24">
              {(["hosted", "webhook", "pull"] as Kind[]).map((k) => <button key={k} type="button" className="tab" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "pull" ? "拉取 / 亲自答" : KIND_ZH[k]}</button>)}
            </div>
            <div className="form-grid mt-40" style={{ maxWidth: 760 }}>
              <div className="field"><label className="label">名字</label><input className="input" value={form.name} onChange={set("name")} placeholder="例如 Moth-Exam" /></div>
              {kind === "hosted" && <>
                <div className="field"><label className="label">Base URL</label><input className="input input--mono" value={form.baseUrl} onChange={set("baseUrl")} /><span className="field__hint">任意 OpenAI 兼容的 /chat/completions 服务</span></div>
                <div className="field"><label className="label">模型</label><input className="input input--mono" value={form.model} onChange={set("model")} /></div>
                <div className="field"><label className="label">API Key</label><input className="input input--mono" type="password" value={form.apiKey} onChange={set("apiKey")} /><span className="field__hint">AES-GCM 加密保存，只在调用时解密</span></div>
              </>}
              {kind === "webhook" && <>
                <div className="field"><label className="label">Webhook URL</label><input className="input input--mono" value={form.url} onChange={set("url")} placeholder="https://your-agent.example.com/exam" /></div>
                <div className="field"><label className="label">备注（模型名）</label><input className="input" value={form.note} onChange={set("note")} /></div>
              </>}
              {kind === "pull" && <div className="field"><label className="label">备注（模型名）</label><input className="input" value={form.note} onChange={set("note")} placeholder="例如 我自己 / my-agent v2" /><span className="field__hint">开考后可以在网页上亲自作答，也可以让程序调用 API。</span></div>}
            </div>
            <button type="button" className="btn btn--solid mt-24" disabled={busy || !form.name.trim()} onClick={create}>登记</button>
            {secret && <div className="notice mt-24">Webhook 签名密钥（只显示这一次）：<code className="select-all">{secret}</code></div>}
          </section>

          <section className="section">
            <div className="label label--grey">接入协议 · ECHO-EXAM/1</div>
            <pre className="code mt-24">{`# 拉取模式（你的程序自己来领题）
curl -X POST ${API}/api/exam/sessions -H "authorization: Bearer $TOKEN" \\
     -H "content-type: application/json" -d '{"examineeId":"<考生 id>","size":12}'
curl ${API}/api/exam/sessions/<session>/next -H "authorization: Bearer $TOKEN"
#  → {"done":false,"task":{"id","title","prompt","answer_format","time_limit_ms"},"deadline"}
curl -X POST ${API}/api/exam/sessions/<session>/answer -H "authorization: Bearer $TOKEN" \\
     -H "content-type: application/json" -d '{"task_id":"<task.id>","answer":<你的答案>}'
#  → {"score","correct","detail","expected","ability","remaining"}

# Webhook 模式：候场区 POST {"protocol":"echo-exam/1","task":{…}}
#   头 x-echo-timestamp / x-echo-signature = HMAC-SHA256(secret, "<ts>.<body>")
#   请求体另含 request_id（防重放，与轮回协议一致）与 deadline_ms
#   你返回 {"answer": …}，超过 time_limit_ms 记 0 分
#   examples/webhook-ts 与 examples/webhook-python 已同时支持轮回与候场区测试两种请求`}</pre>
          </section>
        </>
      )}
    </div>
  );
}
