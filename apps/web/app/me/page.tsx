"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, getToken, setToken } from "@/lib/api";

const FATE: Record<string, string> = { deleted: "✝", ascended: "★", returned: "⟲", archived: "○" };

export default function Me() {
  const [me, setMe] = useState<any>(null);
  const [err, setErr] = useState("");
  const [tok, setTok] = useState("");
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const load = () => api("/api/me").then(setMe).catch((e) => setErr(e.message));
  useEffect(() => {
    if (getToken()) load();
  }, []);

  if (!getToken() || (err && !me)) {
    return (
      <div className="wrap block" style={{ maxWidth: 520 }}>
        <h1 className="display d-section">我的谱系</h1>
        <p className="dim">输入你的访问令牌，或者 <Link href="/play">从头唤醒一个 Agent</Link>。</p>
        <div className="field"><input className="input" placeholder="token" value={tok} onChange={(e) => setTok(e.target.value)} /></div>
        <button className="btn primary" onClick={() => { setToken(tok.trim()); setErr(""); load(); }}>进入</button>
        {err && <p className="alert">{err}</p>}
      </div>
    );
  }
  if (!me) return <div className="wrap block grey">…</div>;

  const writeLetter = async (agentId: string) => {
    try {
      await api(`/api/tombstones/${agentId}/letter`, { body: { text: letters[agentId] } });
      setMsg("遗书已留下。下一代会读到。");
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  return (
    <div className="wrap">
      {me.lineages.length === 0 && <section className="block"><p className="dim">你还没有谱系。<Link href="/play">唤醒第一代 →</Link></p></section>}
      {me.lineages.map((l: any) => {
        const current = me.agents.find((a: any) => a.lineageId === l.id && ["registered", "alive"].includes(a.status));
        const gens = [...l.generations].reverse();
        return (
          <section key={l.id} className="block">
            <div className="label">宿主</div>
            <h1 className="display d-page" style={{ letterSpacing: ".2em" }}>{l.host.name}</h1>
            <p className="dim">{l.host.relation} · 「{l.host.belief}」</p>
            <p className="mono grey" style={{ fontSize: 12 }}>{l.generations.length} 代 · {l.generations.filter((g: any) => g.fate === "ascended").length} 次并入 · 最远第 {Math.max(0, ...l.generations.map((g: any) => g.night ?? 7))} 夜</p>

            {current && (
              <div className="card" style={{ margin: "20px 0" }}>
                <div className="label">⏳ 本周 · {current.status}</div>
                <div className="display" style={{ fontSize: 36 }}>{current.name}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <Link href="/cycle/live" className="btn">观战</Link>
                  <span className="mono grey">{current.mode}{current.model ? ` · ${current.model}` : ""}</span>
                </div>
              </div>
            )}

            <div style={{ borderLeft: "1px solid var(--line-strong)", paddingLeft: 20, marginTop: 20 }}>
              {gens.map((g: any) => {
                const canWrite = g.fate === "deleted" && !g.letter;
                return (
                  <div key={g.agentId} style={{ marginBottom: 24 }}>
                    <div className="row"><span className="display" style={{ fontSize: 28 }}>{FATE[g.fate]} 第 {g.generation} 代 {g.name}</span><span className="mono grey" style={{ fontSize: 12 }}>{g.cycleId}{g.night ? ` · 第 ${g.night} 夜` : ""}{g.card ? ` · ${g.card}` : ""}{g.humanity != null ? ` · 人性 ${g.humanity}` : ""}</span></div>
                    {g.last_words && <div className="ember" style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 20 }}>「{g.last_words}」</div>}
                    {g.diagnosis?.length > 0 && <ul className="dim" style={{ fontSize: 13 }}>{g.diagnosis.map((d: string) => <li key={d}>{d}</li>)}</ul>}
                    {g.letter && <p className="dim">遗书：{g.letter}</p>}
                    <Link href={`/cycle/${g.cycleId}/replay`} style={{ fontSize: 12 }}>回放</Link>
                    {canWrite && (
                      <div style={{ marginTop: 8, maxWidth: 520 }}>
                        <textarea className="input" maxLength={300} placeholder="写给下一代（≤300 字，24 小时内，只能写一次）" value={letters[g.agentId] ?? ""} onChange={(e) => setLetters({ ...letters, [g.agentId]: e.target.value })} />
                        <button className="btn" style={{ marginTop: 6 }} disabled={!letters[g.agentId]?.trim()} onClick={() => writeLetter(g.agentId)}>留下遗书</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="label" style={{ marginTop: 24 }}>宿主的记忆</div>
            {l.host.memories.map((m: string, i: number) => <p key={i} style={{ fontFamily: "var(--serif)", fontSize: 18 }}>{m}</p>)}
            <p className="grey" style={{ fontSize: 12 }}>被典当的记忆不会出现在这里。它们永远不会回来了。</p>
          </section>
        );
      })}
      {msg && <p className="wrap dim">{msg}</p>}
      <section className="block"><p className="mono grey" style={{ fontSize: 12 }}>账号：{me.user.name} · <a href="#" onClick={() => { setToken(null); location.reload(); }}>退出</a></p></section>
    </div>
  );
}
