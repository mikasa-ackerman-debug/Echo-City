"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Share2 } from "lucide-react";
import { LIMITS } from "@echo/protocol";
import { api, errorMessage, HttpError } from "@/lib/api";
import { loadMe, useMe, useNow, useReplay, useResource } from "@/lib/data";
import { demoMe, demoTombstones, loadDemoReplay } from "@/lib/demo";
import { humanityLogs, cycleHumanities } from "@/lib/playback";
import { useApp } from "@/lib/store";
import type { TombstoneDTO } from "@/lib/types";
import { SourceNote } from "./chrome";
import { HumanityCurve } from "./ui/humanity";
import { Sigil } from "./ui/sigil";
import { Tombstone } from "./ui/tombstone";
import { Countdown, Narrator } from "./ui/text";

const LETTER_WINDOW = 24 * 3600_000;

/** One agent's page: the tomb (L) if it died, its letter, humanity curve once the cycle ended, and diagnosis. */
export function AgentDossier({ agentId, from }: { agentId: string; from: "me" | "graveyard" }) {
  const { me } = useMe();
  const toast = useApp((s) => s.toast);
  const now = useNow(1000);
  const tomb = useResource<TombstoneDTO | null>(`tomb:${agentId}`, async (signal) => {
    try { return await api<TombstoneDTO>(`/api/tombstones/${encodeURIComponent(agentId)}`, { signal, auth: false }); }
    catch (e) { if (e instanceof HttpError && e.status === 404) return null; throw e; }
  }, { fallback: async () => demoTombstones(await loadDemoReplay()).find((t) => t.agentId === agentId) ?? null });

  const [demoGen, setDemoGen] = useState<ReturnType<typeof demoMe> | null>(null);
  const meAgent = me?.agents.find((a) => a.id === agentId);
  const gen = (me ?? demoGen)?.lineages.flatMap((l) => l.generations.map((g) => ({ g, l }))).find((x) => x.g.agentId === agentId);
  useEffect(() => { if (tomb.source === "demo") void loadDemoReplay().then((r) => setDemoGen(demoMe(r))); }, [tomb.source]);
  const t = tomb.data;
  const cycleId = t?.cycleId ?? gen?.g.cycleId ?? meAgent?.cycleId ?? null;
  const replay = useReplay(cycleId && (tomb.source === "demo" || t) ? cycleId : null);
  const ended = !!replay.data?.summary.ended && replay.data.id === cycleId;
  const log = useMemo(() => (ended && replay.data ? humanityLogs(replay.data.events)[agentId] ?? [] : []), [ended, replay.data, agentId]);
  const finalH = ended && replay.data ? cycleHumanities(replay.data.events)[agentId] : undefined;
  const diag = t?.diagnosis ?? gen?.g.diagnosis ?? replay.data?.agents.find((a) => a.id === agentId)?.diagnosis ?? [];
  const mine = !!me?.agents.some((a) => a.id === agentId) || !!me?.lineages.some((l) => l.generations.some((g) => g.agentId === agentId));

  const [letter, setLetter] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const deletedAt = t?.deletedAt ? Date.parse(t.deletedAt) : NaN;
  const canWrite = mine && !!t && !t.letter && Number.isFinite(deletedAt) && now - deletedAt < LETTER_WINDOW && tomb.source === "api";
  const submit = async () => {
    setBusy(true); setMsg("");
    try { await api(`/api/tombstones/${agentId}/letter`, { body: { text: letter } }); setMsg("遗书已留下。下一代会读到。"); tomb.reload(); void loadMe(true); }
    catch (e) { setMsg(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const share = () => { void navigator.clipboard?.writeText(window.location.href); toast("链接已复制。"); };

  if (tomb.loading && !t) return <div className="wrap page-head"><div className="skel" style={{ height: 420 }} /></div>;

  const name = t?.name ?? gen?.g.name ?? meAgent?.name ?? agentId;
  const fate = t ? "deleted" : gen?.g.fate ?? meAgent?.status ?? "unknown";

  return (
    <div>
      <SourceNote source={tomb.source} />
      <div className="wrap">
        <nav className="crumbs" aria-label="面包屑"><Link href={from === "me" ? "/me" : "/graveyard"}>{from === "me" ? "我的谱系" : "墓地"}</Link><span>/</span><span>{name}</span></nav>
        {t ? (
          <div className="dossier">
            <div className="dossier__tomb">
              <Tombstone size="l" t={t} mine={mine} href={null} lit={canWrite} />
              <div className="btn-row mt-24">
                <button type="button" className="btn btn--sm" onClick={share}><Share2 />分享墓碑</button>
                <Link className="btn btn--sm btn--ghost" href={`/cycle/${t.cycleId}/replay`}>回放<ArrowRight /></Link>
              </div>
            </div>
            <div className="dossier__side stack-lg">
              <div className="label label--grey">{t.cycleId} · 第 {t.night} 夜 · 第 {t.order} 个被删除</div>
              <Narrator text={`感谢你的服务，${t.name}。`} />
              {canWrite && (
                <div className="letter">
                  <div className="row row--between"><span className="label">写给下一代</span><span className="micro">剩 <Countdown to={deletedAt + LETTER_WINDOW} /></span></div>
                  <p className="body mt-8">只能写一次。下一代苏醒时，会在记忆里读到它。</p>
                  <textarea className="input input--hand input--box mt-16" rows={5} maxLength={LIMITS.letter} value={letter} onChange={(e) => setLetter(e.target.value)} placeholder="别急着相信第一个告诉你花色的人。" />
                  <div className="row row--between mt-8"><span className="micro tnum">{[...letter].length} / {LIMITS.letter}</span><button type="button" className="btn btn--solid" disabled={busy || !letter.trim()} onClick={submit}>留下遗书</button></div>
                </div>
              )}
              {mine && !t.letter && !canWrite && tomb.source === "api" && <p className="micro">遗书的窗口已经关闭。</p>}
              {msg && <p className="notice" role="status">{msg}</p>}
              {diag.length > 0 && (
                <div>
                  <div className="label">能力诊断</div>
                  <ul className="diag mt-8">{diag.map((d) => <li key={d}>{d}</li>)}</ul>
                </div>
              )}
              {ended && (
                <div>
                  <div className="row row--between"><span className="label">人性曲线</span><span className="micro">最终 {finalH ?? t.humanity ?? "—"}</span></div>
                  <div className="mt-16"><HumanityCurve log={log} final={finalH ?? t.humanity ?? 50} /></div>
                </div>
              )}
              {!ended && <p className="micro">人性只在本周轮回结束后公开。</p>}
            </div>
          </div>
        ) : (
          <div className="page-head">
            <div className="row" style={{ gap: 24, alignItems: "flex-end" }}>
              <Sigil id={agentId} size={96} state={fate === "ascended" ? "ascended" : fate === "returned" ? "returned" : mine ? "mine" : "alive"} />
              <div>
                <div className="label label--grey">{fate === "ascended" ? "★ 并入者" : fate === "alive" ? "⏳ 存活" : fate === "registered" ? "◌ 已报名" : fate}</div>
                <h1 className="display d-page mt-8">{name}</h1>
              </div>
            </div>
            {gen?.g.last_words && <p className="hand hand--ember mt-40" style={{ fontSize: 26 }}>「{gen.g.last_words}」</p>}
            {meAgent && (
              <div className="panel mt-40">
                <div className="panel__head"><span className="label">策略</span><span className="micro">{meAgent.mode}{meAgent.model ? ` · ${meAgent.model}` : ""}{meAgent.persona ? ` · ${meAgent.persona}` : ""}</span></div>
                <pre className="panel__body data" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{meAgent.strategy}</pre>
              </div>
            )}
            {diag.length > 0 && <ul className="diag mt-40">{diag.map((d) => <li key={d}>{d}</li>)}</ul>}
            <div className="btn-row mt-40">
              {meAgent && ["alive", "registered"].includes(meAgent.status) && <Link href="/cycle/live" className="btn btn--solid">观战</Link>}
              {cycleId && <Link href={`/cycle/${cycleId}/replay`} className="btn">回放</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
