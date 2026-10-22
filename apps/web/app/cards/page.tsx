"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Play, Users } from "lucide-react";
import { NUMBER_TRIALS, TRIALS, rewardFor, type BankTrialDef } from "@echo/engine";
import { FAMILIES } from "@echo/exam";
import { cardLabel, type CardSuit, type Rank } from "@echo/protocol";
import { CARD_COMPENDIUM, cardMetaId } from "@/lib/compendium";
import { SourceNote } from "@/components/chrome";
import { TrialCard } from "@/components/ui/card";
import { HexDimensionPicker, type DimensionWeights } from "@/components/ui/hex-picker";
import { useGraveyard } from "@/lib/data";
import { createRoom, joinRoom, useCardStates, useProgress, useRooms, type CardStateDTO } from "@/lib/rooms";

const FAMILY_ZH: Record<string, string> = Object.fromEntries(FAMILIES.map((f) => [f.id, f.name]));

const SUITS: Array<{ s: CardSuit; key: string; name: string }> = [
  { s: "♦", key: "diamond", name: "智力" },
  { s: "♥", key: "heart", name: "心理" },
  { s: "♣", key: "club", name: "协作" },
  { s: "♠", key: "spade", name: "执行" },
];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as Rank[];
const CARD_STATUS_ZH: Record<string, string> = { implemented: "已上线", planned: "待实现", new: "待实现" };
const ROOM_STATUS_ZH: Record<string, string> = { open: "开放", waiting: "等待中", running: "进行中", closed: "已关闭" };

/** /cards — 试炼卡图鉴。选牌 → 开房/加入 → 打完关闭 → 集齐 48 张开 Joker。 */
export default function Cards() {
  const g = useGraveyard("", 500);
  const progress = useProgress();
  const cardStates = useCardStates();
  const rooms = useRooms();
  const [roundMsg, setRoundMsg] = useState("");
  const [roundErr, setRoundErr] = useState("");

  const byCard = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of g.data ?? []) if (t.card) { const c = /joker/i.test(t.card) ? "JOKER" : t.card; m[c] = (m[c] ?? 0) + 1; }
    return m;
  }, [g.data]);

  const stateMap = useMemo(() => {
    const m: Record<string, CardStateDTO> = {};
    for (const c of cardStates.data ?? []) m[c.id] = c;
    return m;
  }, [cardStates.data]);

  const roomMap = useMemo(() => {
    const m: Record<string, { id: string; players: number; maxPlayers: number; status: string }> = {};
    for (const r of rooms.data ?? []) m[r.cardId] = { id: r.id, players: r.players.length, maxPlayers: r.maxPlayers, status: r.status };
    return m;
  }, [rooms.data]);

  const [selId, setSelId] = useState<string>("heart-4");
  const [showWeights, setShowWeights] = useState(false);
  const [weights, setWeights] = useState<DimensionWeights>({ logic: 1, math: 1, planning: 1, memory: 1, instruction: 1, strategy: 1 });
  const [actionError, setActionError] = useState("");

  const selMeta = CARD_COMPENDIUM[selId];
  const selTrial = TRIALS[selId];
  const selLabel = cardLabel(selMeta.suit, selMeta.rank);
  const bank = (selTrial as Partial<BankTrialDef> | undefined)?.bank;
  const rulesText = selTrial?.rules("standard") ?? selMeta.rules;
  const deaths = byCard[selLabel] ?? 0;
  const reward = selMeta.rank <= 10 && selMeta.suit !== "joker" ? `+${rewardFor(selMeta.rank)}` : "—";
  const failPenalty = bank ? (bank.deleteBelow !== undefined ? "−2 / 删除" : "−2") : selMeta.rank <= 4 && selMeta.suit !== "joker" ? "−2" : "删除";
  const roomState = stateMap[selId]?.state?.status ?? "open";
  const room = roomMap[selId];

  const handleCreate = async () => {
    setActionError("");
    try { await createRoom(selId, weights); setShowWeights(false); } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); }
  };
  const handleJoin = async () => {
    setActionError("");
    try { if (room) await joinRoom(room.id); } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div>
      <SourceNote source={g.source} what="演示墓地的死亡统计" />
      <div className="wrap">
        <header className="page-head">
          <div className="label label--grey">THE DECK</div>
          <h1 className="display d-hero zh mt-16">试炼卡图鉴</h1>
          <p className="body-lg mt-24">四种花色，十三个点数，一张鬼牌。<span className="grey">选一张牌，开启试炼。集齐 48 张，Joker 等着。</span></p>
          {progress.data && (
            <div className="lines lines--4 mt-40">
              <div className="cell"><span className="label label--grey">已关闭</span><span className="display d-32 mt-8">{progress.data.closed} / {progress.data.total}</span></div>
              <div className="cell"><span className="label label--grey">等待中</span><span className="display d-32 mt-8">{Object.values(progress.data.cardStates).filter((s) => s.status === "waiting").length}</span></div>
              <div className="cell"><span className="label label--grey">进行中</span><span className="display d-32 mt-8">{Object.values(progress.data.cardStates).filter((s) => s.status === "running").length}</span></div>
              <div className="cell"><span className="label label--grey">Joker</span><span className="display d-32 mt-8">{progress.data.jokerOpen ? "已开放" : "未开放"}</span></div>
            </div>
          )}
          <div className="btn-row mt-40">
            <button
              type="button"
              className="btn btn--solid"
              style={{ fontSize: 16, padding: "14px 32px" }}
              onClick={async () => {
                setRoundErr(""); setRoundMsg("");
                try {
                  const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
                  const r = await fetch(`${API}/api/round/start`, {
                    method: "POST",
                    headers: { "content-type": "application/json", authorization: `Bearer ${localStorage.getItem("echo.token") ?? ""}` },
                  });
                  const j = await r.json();
                  if (!r.ok) setRoundErr(j.error ?? "启动失败");
                  else setRoundMsg(j.message ?? "轮次已就绪");
                } catch { setRoundErr("API 未连接"); }
              }}
            >⚡ 启动轮回</button>
            <Link href="/me" className="btn btn--ghost">配置智能体</Link>
          </div>
          {roundMsg && <p className="body mt-16" style={{ color: "var(--ember)" }}>{roundMsg}</p>}
          {roundErr && <p className="notice mt-16">{roundErr}</p>}
        </header>

        {/* Deck grid */}
        <div className="deck">
          <div className="deck__grid" role="grid" aria-label="牌组">
            {SUITS.map((su) => (
              <div key={su.s} className="deck__row" role="row">
                <div className={`deck__suit suit-${su.key}`} role="rowheader"><span className="display d-48">{su.s}</span><span className="label label--grey">{su.name}</span></div>
                {RANKS.map((r) => {
                  const id = cardMetaId(su.s, r);
                  const label = cardLabel(su.s, r);
                  const st = stateMap[id]?.state?.status ?? "open";
                  return (
                    <div key={r} role="gridcell" className="deck__cell" style={{ position: "relative" }}>
                      <TrialCard card={label} size="xs" onClick={() => setSelId(id)} back={st === "closed"} locked={st === "closed"} />
                      {st === "closed" && <span className="deck__stamp">已关闭</span>}
                      {st === "waiting" && <span className="deck__dot deck__dot--wait" />}
                      {st === "running" && <span className="deck__dot deck__dot--run" />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="deck__joker">
            <TrialCard card="JOKER" size="sm" onClick={() => setSelId("joker")} />
            <span className="micro mt-8">{progress.data?.jokerOpen ? "已开放" : "集齐 48 张后开放"}</span>
          </div>
        </div>

        {/* Selected card detail */}
        <section className="cardinfo" aria-live="polite">
          <div className="cardinfo__card"><TrialCard key={selId} card={selLabel} name={selMeta.name} size="lg" flipOnMount /></div>
          <div className="stack-lg">
            <div className="label label--grey">
              {selLabel} · {selId}
              {selMeta.status !== "implemented" && <span className="tag" style={{ marginLeft: 8 }}>{CARD_STATUS_ZH[selMeta.status]}</span>}
              <span className="tag" style={{ marginLeft: 8, color: roomState === "closed" ? "var(--grey-dark)" : roomState === "open" ? "var(--ember)" : undefined }}>
                {ROOM_STATUS_ZH[roomState]}
              </span>
            </div>
            <h2 className="display d-hero zh">{selMeta.name}</h2>
            <p className="body-lg">{selMeta.story}</p>
            <p className="body">{selMeta.tests}</p>

            <div className="lines lines--4">
              <div className="cell"><span className="label label--grey">人数</span><span className="body mt-8">{selMeta.players}</span></div>
              <div className="cell"><span className="label label--grey">通过奖励</span><span className="display d-32 mt-8">{reward}</span></div>
              <div className="cell"><span className="label label--grey">失败</span><span className="display d-32 zh mt-8">{failPenalty}</span></div>
              <div className="cell"><span className="label label--grey">死于此卡</span><span className="display d-32 mt-8">{deaths}</span></div>
            </div>

            {selMeta.gatekeeper && <p className="body">守门人：<span className="data">{selMeta.gatekeeper}</span></p>}

            <div className="lines lines--2">
              <div className="cell"><span className="label label--grey">通关</span><p className="body mt-8">{selMeta.pass}</p></div>
              <div className="cell"><span className="label label--grey">失败后果</span><p className="body mt-8">{selMeta.fail}</p></div>
            </div>

            {bank && <p className="body">本卡的题目从 ANANKE 的题库抽取：{bank.families.map((f) => FAMILY_ZH[f] ?? f).join("、")}。</p>}

            <div className="panel">
              <div className="panel__head"><span className="label">规则全文</span><span className="micro">标准长度</span></div>
              <pre className="panel__body body" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{rulesText}</pre>
            </div>

            {/* Room actions */}
            {actionError && <p className="notice">{actionError}</p>}
            {roomState === "open" && (
              showWeights ? (
                <div className="panel" style={{ borderColor: "var(--line-strong)" }}>
                  <div className="panel__head"><span className="label">设定维度权重</span><span className="micro">拖动顶点调整</span></div>
                  <div className="panel__body" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
                    <HexDimensionPicker weights={weights} onChange={setWeights} />
                    <div className="btn-row">
                      <button type="button" className="btn btn--solid" onClick={handleCreate}><Play size={14} /> 开启试炼</button>
                      <button type="button" className="btn btn--ghost" onClick={() => setShowWeights(false)}>取消</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="btn-row">
                  <button type="button" className="btn btn--solid" onClick={() => setShowWeights(true)}><Play size={14} /> 开启试炼</button>
                  {selTrial && NUMBER_TRIALS.includes(selTrial.id) && <Link href={`/practice?card=${selTrial.id}`} className="btn btn--ghost">在练习场试一次</Link>}
                </div>
              )
            )}
            {roomState === "waiting" && room && (
              <div className="btn-row">
                <button type="button" className="btn btn--solid" onClick={handleJoin}><Users size={14} /> 加入试炼（{room.players}/{room.maxPlayers}）</button>
              </div>
            )}
            {roomState === "running" && <p className="body grey">试炼进行中。</p>}
            {roomState === "closed" && <p className="body grey">试炼已结束。</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
