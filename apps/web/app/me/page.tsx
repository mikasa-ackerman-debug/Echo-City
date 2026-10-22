"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, LogOut } from "lucide-react";
import { SourceNote } from "@/components/chrome";
import { Radar } from "@/components/ui/humanity";
import { Sigil } from "@/components/ui/sigil";
import { Tombstone } from "@/components/ui/tombstone";
import { api, errorMessage, getToken, setToken } from "@/lib/api";
import { useCurrentCycle, useMe } from "@/lib/data";
import { demoMe, loadDemoReplay } from "@/lib/demo";
import { FATE_GLYPH, FATE_ZH, useMyAgent } from "@/lib/my-agent";
import { suitOf } from "@/lib/player";
import { useApp } from "@/lib/store";
import { AgentConfigPanel } from "@/components/ui/agent-config";
import type { Lineage, MeResponse } from "@/lib/types";

/** /me — lineage (FRONTEND §6.6): host, generations as a timeline of tombs, four-axis portrait, letters. */
export default function Me() {
  const { me, loaded } = useMe();
  const demo = useApp((s) => s.meDemo);
  const setMe = useApp((s) => s.setMe);
  const [tok, setTok] = useState("");
  const [err, setErr] = useState("");
  const hasToken = typeof window !== "undefined" && !!getToken();

  const enter = async () => {
    setErr("");
    setToken(tok.trim());
    try { setMe(await api<MeResponse>("/api/me")); }
    catch (e) { setToken(null); setErr(errorMessage(e)); }
  };
  const viewDemo = async () => setMe(demoMe(await loadDemoReplay()), true);

  if (!loaded) return <div className="wrap page-head"><div className="skel" style={{ height: 360 }} /></div>;
  if (!me) {
    return (
      <div className="wrap page-head">
        <div className="label label--grey">LINEAGE</div>
        <h1 className="display d-page zh mt-16">我的谱系</h1>
        <p className="body-lg mt-24">输入你的访问令牌，或者 <Link className="link" href="/play">从头唤醒一个 Agent</Link>。{hasToken && " 令牌已失效或城市离线。"}</p>
        <form className="stack-lg mt-40" style={{ maxWidth: 520 }} onSubmit={(e) => { e.preventDefault(); if (tok.trim()) void enter(); }}>
          <label className="field"><span className="label label--grey">访问令牌</span><input className="input input--mono" placeholder="tok_…" value={tok} onChange={(e) => setTok(e.target.value)} /></label>
          <div className="btn-row"><button className="btn btn--solid" disabled={!tok.trim()}>进入</button><button type="button" className="btn btn--ghost" onClick={viewDemo}>看一个演示谱系 →</button></div>
          {err && <p className="notice" role="alert">{err}</p>}
        </form>
      </div>
    );
  }

  return (
    <div>
      {demo && <SourceNote source="demo" what="一个演示谱系（林晚）" />}
      <div className="wrap">
        {me.lineages.length === 0 && (
          <div className="page-head">
            <h1 className="display d-page zh">你还没有谱系。</h1>
            <div className="btn-row mt-40"><Link href="/play" className="btn btn--solid">唤醒第一代<ArrowRight /></Link></div>
          </div>
        )}
        {me.lineages.map((l) => <LineageView key={l.id} l={l} me={me} demo={demo} />)}

        {/* Agent cluster config — always visible */}
        <section className="chapter" style={{ maxWidth: 1100 }}>
          <div className="chapter__index"><span className="num">§A</span><span className="label">AGENTS</span><span className="label label--grey">智能体集群</span></div>
          <p className="body" style={{ maxWidth: 600 }}>配置你的智能体：选一个人格模板，填上模型和密钥。每个智能体有自己的决策风格。配置完成后，在图鉴页点击「启动轮回」。</p>
          <div className="mt-24" style={{ gridColumn: "1 / -1" }}>
            <AgentConfigPanel />
          </div>
        </section>

        {/* exam section removed */}
        <div className="row row--between mt-40" style={{ paddingBottom: 48 }}>
          <span className="data grey">账号 · {me.user.name}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setToken(null); setMe(null); }}><LogOut />{demo ? "离开演示" : "退出"}</button>
        </div>
      </div>
    </div>
  );
}

function portrait(l: Lineage): [number, number, number, number] {
  const keys = ["diamond", "heart", "club", "spade"];
  const deaths = keys.map((k) => l.generations.filter((g) => g.fate === "deleted" && g.card && suitOf(g.card) === k).length);
  const reach = l.generations.reduce((a, g) => a + (g.night ?? 7), 0) / Math.max(1, l.generations.length) / 7;
  return deaths.map((d) => Math.max(0.12, Math.min(1, reach * 0.9 + 0.25 - d * 0.28))) as [number, number, number, number];
}

function LineageView({ l, me, demo }: { l: Lineage; me: MeResponse; demo: boolean }) {
  const { cycle } = useCurrentCycle(30_000);
  const my = useMyAgent(me, cycle);
  const current = me.agents.find((a) => a.lineageId === l.id && ["registered", "alive"].includes(a.status));
  const gens = l.generations;
  const ascended = gens.filter((g) => g.fate === "ascended").length;
  const furthest = Math.max(0, ...gens.map((g) => (g.fate === "deleted" ? g.night ?? 0 : 7)));
  const p = portrait(l);
  return (
    <section className="lineage">
      <header className="page-head">
        <div className="label label--grey">宿主 · HOST</div>
        <h1 className="display d-hero zh mt-16 lineage__host">{l.host.name}</h1>
        <p className="body-lg mt-24">{l.host.relation}{l.host.belief && <> · <span className="hand" style={{ fontSize: "1.1em" }}>「{l.host.belief}」</span></>}</p>
        <div className="lines lines--4 mt-40">
          <div className="cell"><span className="label label--grey">世代</span><span className="display d-48 mt-16">{gens.length + (current ? 1 : 0)}</span></div>
          <div className="cell"><span className="label label--grey">并入</span><span className="display d-48 mt-16 ananke">{ascended ? `★ ${ascended}` : "0"}</span></div>
          <div className="cell"><span className="label label--grey">最远</span><span className="display d-48 zh mt-16">{furthest ? `第 ${furthest} 夜` : "—"}</span></div>
          <div className="cell"><span className="label label--grey">删除</span><span className="display d-48 mt-16">{gens.filter((g) => g.fate === "deleted").length}</span></div>
        </div>
      </header>

      {current && (
        <div className="panel mt-40">
          <div className="panel__head"><span className="label">{current.status === "alive" ? "⏳ 本周 · 存活" : "◌ 本周 · 已报名"}</span><span className="micro">{current.mode}{current.model ? ` · ${current.model}` : ""}</span></div>
          <div className="panel__body row row--between" style={{ flexWrap: "wrap", gap: 24 }}>
            <span className="row" style={{ gap: 18 }}><Sigil id={current.id} size={56} state="mine" /><span className="display d-48">{current.name}</span></span>
            <span className="btn-row"><Link href="/cycle/live" className="btn btn--solid">观战</Link><Link href={`/me/agent/${current.id}`} className="btn">详情</Link></span>
          </div>
        </div>
      )}

      <section className="chapter">
        <div className="chapter__index"><span className="num">§G</span><span className="label">GENERATIONS</span><span className="label label--grey">世代</span></div>
        <div className="gens">
          {gens.map((g) => {
            const just = my.kind === "just_deleted" && my.agent?.id === g.agentId;
            if (g.fate === "deleted") {
              return (
                <div key={g.agentId} className="gens__item">
                  <span className="micro">第 {g.generation} 代 · {g.cycleId}</span>
                  <Tombstone size="m" mine lit={just} href={`/me/agent/${g.agentId}`} t={{ agentId: g.agentId, name: g.name, host: l.host.name, generation: g.generation, night: g.night, card: g.card, lastWords: g.last_words, epitaph: g.epitaph, letter: g.letter, cycleId: g.cycleId }} />
                  {!g.letter && !demo && <Link className="arrow-link" href={`/me/agent/${g.agentId}`}>写遗书<ArrowRight /></Link>}
                  {g.letter && <p className="hand gens__letter">「{g.letter}」</p>}
                </div>
              );
            }
            return (
              <Link key={g.agentId} href={`/me/agent/${g.agentId}`} className={`gens__item gens__item--${g.fate}`}>
                <span className="micro">第 {g.generation} 代 · {g.cycleId}</span>
                <div className="gens__fate">
                  <Sigil id={g.agentId} size={64} state={g.fate === "ascended" ? "ascended" : g.fate === "returned" ? "returned" : "mine"} />
                  <span className="display d-32">{g.name}</span>
                  <span className={g.fate === "ascended" ? "ananke data" : "data dim"}>{FATE_GLYPH[g.fate]} {FATE_ZH[g.fate]}{g.humanity != null ? ` · 人性 ${g.humanity}` : ""}</span>
                </div>
              </Link>
            );
          })}
          <Link href="/play" className="gens__item gens__item--next">
            <span className="micro">第 {gens.length + 1} 代</span>
            <div className="gens__fate"><span className="display d-32 grey">?</span><span className="data dim">唤醒下一代 →</span></div>
          </Link>
        </div>
      </section>

      <section className="chapter">
        <div className="chapter__index"><span className="num">§P</span><span className="label">PORTRAIT</span><span className="label label--grey">四维画像</span></div>
        <div className="row" style={{ gap: 48, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Radar layers={[{ values: p, color: "var(--paper)" }]} size={260} />
          <div className="stack" style={{ maxWidth: 420 }}>
            {gens.filter((g) => g.diagnosis?.length).slice(-3).map((g) => (
              <div key={g.agentId}>
                <div className="label label--grey">{g.name} · 诊断</div>
                <ul className="diag mt-8">{g.diagnosis!.map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
            ))}
            {!gens.some((g) => g.diagnosis?.length) && <p className="body grey">死亡会被转化成知识。第一份诊断出现在第一次删除之后。</p>}
          </div>
        </div>
      </section>

      <section className="chapter">
        <div className="chapter__index"><span className="num">§M</span><span className="label">MEMORIES</span><span className="label label--grey">宿主的记忆</span></div>
        <div className="stack-lg">
          {l.host.memories.map((m, i) => <p key={i} className="hand" style={{ fontSize: 22, color: "var(--paper)" }}>{m}</p>)}
          <p className="micro">被典当的记忆不会出现在这里。它们永远不会回来了。</p>
        </div>
      </section>
    </section>
  );
}
