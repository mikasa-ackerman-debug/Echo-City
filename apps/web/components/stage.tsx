"use client";
import type { CycleEvent } from "@echo/engine";
import { BANK_TRIAL_IDS, getTrial } from "@echo/engine";
import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { list, num, numMap, pos, rec, recs, str, strMap, strs } from "@/lib/ev";
import type { View, VenueLite } from "@/lib/player";
import { SuitMark } from "./ui/card";
import { Sigil } from "./ui/sigil";

/**
 * Trial stage (FRONTEND §7.1): shared shell = announcement → body → round bar.
 * Every body receives the venue (derived from events up to cursor) and a viewpoint.
 * Only delivered data is rendered; hidden fields arrive solely via trial_reveal after settlement.
 */

export interface StageProps {
  venue: VenueLite;
  view: View;
  /** Agent *name* whose eyes we look through, or null for god view. */
  viewpoint: string | null;
  mine: Set<string>;
}

const OUTCOME_ZH: Record<string, string> = { delete: "删除", pass: "通过", win: "胜出" };

export function Stage(p: StageProps) {
  const { venue } = p;
  const def = useMemo(() => { try { return venue.trial ? getTrial(venue.trial) : null; } catch { return null; } }, [venue.trial]);
  const [roundIdx, setRoundIdx] = useState<number | null>(null);
  const roundEvents = venue.rounds.filter((e) => ["beauty_round", "collar_declare", "lifeboat_round", "corridor_round", "hound_round", "dinner_round", "joker_round", "joker_duel_round", "greenhouse_round"].includes(e.type));
  const lastRoundNo = num(venue.last?.data.round) ?? roundEvents.length;
  const maxRounds = num(venue.reveal?.maxRounds);
  const focus = roundIdx != null ? roundEvents[roundIdx] : undefined;

  return (
    <section className="stage" aria-label={`${venue.district} 会场`}>
      <div className="announce">
        <span><b>试炼</b>{venue.name ?? def?.name ?? "—"}</span>
        <span><b>难度</b><SuitMark card={venue.card} className="announce__card" /></span>
        <span><b>参与者</b>{venue.players.length}</span>
        <span><b>会场</b>{venue.district}</span>
        {venue.gatekeeper && <span><b>守门人</b><span className="ananke">{venue.gatekeeper}</span></span>}
      </div>

      <div className="stage__body">
        <StageBody {...p} focus={focus} />
      </div>

      <div className="roundbar">
        <span>回合 <b>{lastRoundNo || "—"}</b>{maxRounds ? ` / ${maxRounds}` : ""}</span>
        <span>阶段 <b>{venue.ended ? "已结算" : venue.rounds.length ? "进行中" : "开场"}</b></span>
        {venue.eliminated.length > 0 && <span>出局 <b>{venue.eliminated.length}</b></span>}
        {roundEvents.length > 1 && (
          <span className="round-hist" role="group" aria-label="回合回看">
            {roundEvents.map((e, i) => (
              <button key={e.seq} type="button" aria-pressed={roundIdx === i} onClick={() => setRoundIdx(roundIdx === i ? null : i)}>R{num(e.data.round) ?? i + 1}</button>
            ))}
          </span>
        )}
      </div>

      {venue.rules_added.length > 0 && (
        <div className="rule-list" aria-live="polite">
          {venue.rules_added.map((r, i) => <div key={r.seq} className={`rule-line${i === venue.rules_added.length - 1 ? " rule-line--new" : ""}`}>{str(r.data.rule)}</div>)}
        </div>
      )}

      {venue.ended && venue.outcomes && <Outcomes venue={venue} mine={p.mine} />}

      <details className="rules mt-24">
        <summary className="label label--grey">规则全文 · {def?.tests ?? venue.tests ?? ""}</summary>
        <p className="mt-16">{venue.rules}</p>
      </details>
    </section>
  );
}

function Outcomes({ venue, mine }: { venue: VenueLite; mine: Set<string> }) {
  const entries = Object.entries(venue.outcomes ?? {});
  return (
    <div className="seats mt-24" aria-label="结算">
      {entries.map(([name, o]) => (
        <div key={name} className={`seat${o === "delete" ? " seat--dead" : o === "win" ? " seat--win" : ""}${mine.has(name) ? " seat--mine" : ""}`}>
          <Sigil id={name} size={30} state={o === "delete" ? "deleted" : mine.has(name) ? "mine" : "alive"} />
          <span className="seat__name">{name}</span>
          <span className="seat__out">{o === "delete" ? "✝ " : ""}{OUTCOME_ZH[o] ?? o}</span>
        </div>
      ))}
    </div>
  );
}

function StageBody(p: StageProps & { focus?: CycleEvent }) {
  const { venue } = p;
  const last = p.focus ?? venue.last;
  const t = venue.trial ?? "";
  if (t === "diamond-K" || (t === "joker" && last?.type === "joker_duel_round")) return <Beauty {...p} ev={last} />;
  if (t === "heart-4" || t === "heart-J") return <Collars {...p} ev={last?.type === "collar_declare" ? last : undefined} />;
  if (t === "club-8") return <Lifeboat ev={last} />;
  if (t === "spade-5") return <Hound {...p} ev={last} />;
  if (t === "diamond-6") return <Corridor venue={venue} upto={last} />;
  if (t === "diamond-3") return <Elevator venue={venue} />;
  if (BANK_TRIAL_IDS.includes(t)) return <Bank venue={venue} upto={last} />;
  if (t === "heart-7") return <Dinner venue={venue} ev={last} />;
  if (t === "joker") return <Joker venue={venue} />;
  return <Table {...p} />;
}

function Waiting({ text = "第一回合即将开始。" }: { text?: string }) {
  return <p className="narrator narrator--quiet">{text}</p>;
}

/* ---------- ♦K beauty contest ---------- */
function Beauty({ venue, ev, mine }: StageProps & { ev?: CycleEvent }) {
  if (!ev || (ev.type !== "beauty_round" && ev.type !== "joker_duel_round")) return <Waiting text="所有人在 0–100 中选择一个数。目标值 = 平均值 × 0.8。" />;
  const picks = numMap(ev.data.picks);
  const target = num(ev.data.target);
  const avg = num(ev.data.average);
  const winners = new Set(strs(ev.data.winners));
  const invalid = new Set(strs(ev.data.invalid));
  const scores = numMap(ev.data.scores);
  const gk = venue.gatekeeper;
  return (
    <div className="beauty" key={ev.seq}>
      <div className="row row--between">
        <span className="label">第 {num(ev.data.round) ?? "—"} 回合</span>
        <span className="data grey">平均 {avg?.toFixed(2) ?? "—"} × 0.8 = <span className="ananke">{target?.toFixed(2) ?? "—"}</span></span>
      </div>
      <div className="numline" role="img" aria-label={`目标值 ${target?.toFixed(2)}`}>
        <div className="numline__axis" />
        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => <div key={v} className="numline__tick" style={{ left: `${v}%` }}><span>{v}</span></div>)}
        {Object.entries(picks).map(([name, v], i) => v == null ? null : (
          <div key={name} className={`numline__pick${winners.has(name) ? " numline__pick--win" : ""}${name === gk ? " numline__pick--gk" : ""}`} style={{ left: `${v}%`, animationDelay: `${i * 70}ms` }}>
            <span>{name} · {v}{invalid.has(name) ? " ✕" : ""}</span>
            <i style={{ height: 34 + (i % 3) * 16, opacity: invalid.has(name) ? 0.3 : 1 }} />
          </div>
        ))}
        {target != null && <div className="numline__target" style={{ left: `${target}%` }}><span>{target.toFixed(2)}</span></div>}
      </div>
      {Object.keys(scores).length > 0 && (
        <div className="scoregrid" aria-label="分数">
          {Object.entries(scores).map(([name, s]) => {
            const v = Math.abs(Math.min(0, s ?? 0));
            const dead = v >= 10 || venue.eliminated.includes(name);
            return (
              <div key={name} className={`scoregrid__row${dead ? " scoregrid__row--dead" : ""}`}>
                <span style={{ color: mine.has(name) ? "var(--paper)" : undefined }}>{dead ? "✝ " : ""}{name}</span>
                <span className="scoregrid__cells">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < v ? `on${v >= 8 && i === v - 1 ? " edge" : ""}` : ""} />)}</span>
                <span className="tnum" style={{ textAlign: "right" }}>{s ?? 0}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- ♥4 / ♥J collars ---------- */
function Collars({ venue, ev, viewpoint, mine }: StageProps & { ev?: CycleEvent }) {
  const decl = rec(ev?.data.declarations);
  const names = venue.players;
  const dead = new Set(Object.entries(venue.outcomes ?? {}).filter(([, o]) => o === "delete").map(([n]) => n));
  for (const [n, d] of Object.entries(decl)) if (rec(d).ok === false) dead.add(n);
  const N = names.length;
  const at = (i: number) => { const a = -Math.PI / 2 + (i / N) * Math.PI * 2; return { x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 38 }; };
  const idx = (n: string) => names.indexOf(n);
  const round = num(ev?.data.round);
  const claims = venue.claims.filter((c) => !round || true).slice(-8);
  return (
    <div>
      <div className="collars">
        <div className="collars__ring" />
        <svg className="collars__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {claims.map((c) => {
            const a = idx(str(c.data.from) ?? ""), b = idx(str(c.data.to) ?? "");
            if (a < 0 || b < 0) return null;
            const A = at(a), B = at(b);
            return <path key={c.seq} className={`claim-line${c.data.truthful === false ? " claim-line--lie" : ""}`} d={`M${A.x} ${A.y} Q 50 50 ${B.x} ${B.y}`} vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
        <div className="collars__center">
          <div>
            <div className="label label--grey">{round ? `第 ${round} 回合 · 宣告` : "自由交流"}</div>
            <div className="micro mt-8">{viewpoint ? `以 ${viewpoint} 的视角：自己是 ?` : "上帝视角"}</div>
          </div>
        </div>
        {names.map((n, i) => {
          const { x, y } = at(i);
          const d = rec(decl[n]);
          const said = str(d.said);
          const actual = str(d.actual);
          const self = viewpoint === n && !venue.ended;
          const show = self ? "?" : actual ?? "?";
          return (
            <div key={n} className={`collar-seat${dead.has(n) ? " collar-seat--dead" : ""}${mine.has(n) ? " collar-seat--mine" : ""}`} style={{ left: `${x}%`, top: `${y}%` }}>
              <span className={`collar-seat__card${show === "?" ? " collar-seat__card--back" : ""}${d.ok === false ? " collar-seat__card--wrong" : ""}`}><SuitMark card={show === "?" ? undefined : show} />{show === "?" ? "?" : null}</span>
              <Sigil id={n} size={34} state={dead.has(n) ? "deleted" : mine.has(n) ? "mine" : "alive"} />
              <span className="collar-seat__name">{n}</span>
              {said && <span className="collar-seat__said">宣告 {said} {d.ok === true ? "✓" : d.ok === false ? "✕" : ""}</span>}
            </div>
          );
        })}
      </div>
      {venue.claims.length > 0 && !venue.ended && <p className="locked-block"><Lock aria-hidden />私信 {venue.claims.length} 条 · 内容在本场结算后公开</p>}
    </div>
  );
}

/* ---------- ♣8 lifeboat ---------- */
function Lifeboat({ ev }: { ev?: CycleEvent }) {
  if (!ev || ev.type !== "lifeboat_round") return <Waiting text="所有人各自秘密投入 Uptime。总投入达到阈值，船才能继续前进。" />;
  const total = num(ev.data.total) ?? 0;
  const thr = num(ev.data.threshold) ?? 1;
  const inputs = numMap(ev.data.inputs);
  const max = Math.max(thr, total) + 2;
  const W = 600; const H = 220; const deckY = 40; const keel = 190;
  const cells = Object.entries(inputs).flatMap(([n, v]) => Array.from({ length: Math.max(0, v ?? 0) }, (_, k) => ({ n, k })));
  const cw = (W - 120) / max;
  return (
    <div>
      <svg className="boat" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`投入 ${total} / ${thr}`}>
        <path className="boat__hull" d={`M20 ${deckY} L${W - 20} ${deckY} L${W - 80} ${keel} L80 ${keel} Z`} />
        {Array.from({ length: 12 }, (_, i) => <line key={i} x1={40 + i * 46} x2={60 + i * 44} y1={deckY} y2={keel} stroke="var(--line)" />)}
        {cells.map((c, i) => <rect key={i} className="boat__cell" x={60 + i * cw + 1} y={110} width={Math.max(2, cw - 3)} height={44} opacity={0.35 + ((i * 37) % 60) / 100}><title>{c.n}</title></rect>)}
        <line className="boat__threshold" x1={60 + thr * cw} x2={60 + thr * cw} y1={deckY - 18} y2={keel + 8} />
        <text x={60 + thr * cw + 6} y={deckY - 6} fill="var(--ananke)" fontSize="11" fontFamily="var(--mono)">阈值 {thr}</text>
        <text x="60" y={keel + 22} fill="var(--paper-dim)" fontSize="11" fontFamily="var(--mono)">第 {num(ev.data.round)} 回合 · 投入 {total} / {thr} · {ev.data.ok ? "引擎还在转" : "引擎熄火了"}</text>
      </svg>
      <div className="seats mt-16">{Object.entries(inputs).map(([n, v]) => <div key={n} className="seat"><span className="seat__name">{n}</span><span className="d-24 serif">{v ?? "—"}</span></div>)}</div>
    </div>
  );
}

/* ---------- ♠5 hound ---------- */
function Hound({ venue, ev, viewpoint, mine }: StageProps & { ev?: CycleEvent }) {
  const size = num(venue.reveal?.size) ?? 12;
  const hist = venue.rounds.filter((e) => e.type === "hound_round" && e.seq <= (ev?.seq ?? Infinity));
  const cur = hist[hist.length - 1];
  if (!cur) return <Waiting text="12×12 网格。猎犬追向离它最近的人。活到最后。" />;
  const positions = rec(cur.data.positions);
  const hound = pos(cur.data.hound);
  const trail = new Set(hist.slice(-5, -1).map((e) => pos(e.data.hound)).filter(Boolean).map((h) => `${h![0]},${h![1]}`));
  const caught = new Set(strs(cur.data.caught));
  const who = new Map<string, string>();
  for (const [n, v] of Object.entries(positions)) { const pp = pos(v); if (pp) who.set(`${pp[0]},${pp[1]}`, n); }
  const vp = viewpoint ? pos(positions[viewpoint]) : undefined;
  const seen = (x: number, y: number) => !vp || Math.abs(vp[0] - x) + Math.abs(vp[1] - y) <= 4;
  return (
    <div className="daypane">
      <div className="hound" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }} role="img" aria-label={`第 ${num(cur.data.round)} 回合，猎犬位于 ${hound?.join(",")}`}>
        {Array.from({ length: size * size }, (_, i) => {
          const x = i % size, y = Math.floor(i / size), k = `${x},${y}`;
          const n = who.get(k);
          const isH = hound && hound[0] === x && hound[1] === y;
          const cls = isH ? "hound__cell--hound" : n ? (caught.has(n) ? "hound__cell--caught" : mine.has(n) ? "hound__cell--mine" : "hound__cell--agent") : trail.has(k) ? "hound__cell--trail" : !seen(x, y) ? "hound__cell--fog" : "";
          return <div key={k} className={`hound__cell ${cls}`} title={n ?? (isH ? "猎犬" : undefined)}>{n ? n[0] : ""}</div>;
        })}
      </div>
      <div className="stack">
        <div className="label">第 {num(cur.data.round)} 回合</div>
        {Object.keys(positions).map((n) => <div key={n} className="row data"><Sigil id={n} size={20} state={caught.has(n) ? "deleted" : mine.has(n) ? "mine" : "alive"} /><span className={caught.has(n) ? "grey-dark" : ""}>{n}</span><span className="grey">{pos(positions[n])?.join(", ")}</span></div>)}
        <div className="micro mt-16">{vp ? `迷雾：以 ${viewpoint} 的视野（4 格）` : "上帝视角 · 无迷雾"} · 红色为猎犬与它的足迹</div>
      </div>
    </div>
  );
}

/* ---------- ♦6 corridor ---------- */
function Corridor({ venue, upto }: { venue: VenueLite; upto?: CycleEvent }) {
  const rounds = venue.rounds.filter((e) => e.type === "corridor_round" && e.seq <= (upto?.seq ?? Infinity));
  if (!rounds.length) return <Waiting text="共同破解一个 4 位密码。每次猜测返回位置和数字都正确的个数，以及数字对、位置错的个数。" />;
  return (
    <div className="table-scroll">
      <table className="table">
        <thead><tr><th>回合</th><th>AGENT</th><th>猜测</th><th>反馈</th></tr></thead>
        <tbody>
          {rounds.flatMap((r) => recs(r.data.guesses).map((g, i) => {
            const ex = num(g.exact) ?? 0, pa = num(g.partial) ?? 0;
            return (
              <tr key={`${r.seq}-${i}`}>
                <td className="grey">{i === 0 ? `R${num(r.data.round)}` : ""}</td>
                <td>{str(g.agent)}</td>
                <td className="tnum" style={{ letterSpacing: ".3em", fontSize: 16 }}>{str(g.guess)}</td>
                <td><span className="pegs">{Array.from({ length: 4 }, (_, k) => <i key={k} className={k < ex ? "exact" : k < ex + pa ? "" : "none"} />)}</span> <span className="grey">{ex}A{pa}B</span></td>
              </tr>
            );
          }))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- task-bank cards (♦2 ♠9 ♣9 ♦10): puzzles drawn from ANANKE's task bank ---------- */
function Bank({ venue, upto }: { venue: VenueLite; upto?: CycleEvent }) {
  const seen = venue.rounds.filter((e) => e.seq <= (upto?.seq ?? Infinity));
  const tasks = seen.filter((e) => e.type === "bank_task");
  const answers = seen.filter((e) => e.type === "bank_answer");
  const shared = tasks.find((e) => e.data.agent === null);
  const taskOf = (n: string) => shared ?? tasks.find((e) => str(e.data.agent) === n);
  const fam = (e?: CycleEvent) => (e ? `${str(e.data.title)} · L${e.data.level}` : "…");
  return (
    <div>
      {shared && <p className="data grey bank-shared">全场共用一道题 · {fam(shared)}</p>}
      <div className="seats">
        {venue.players.map((n) => {
          const mineA = answers.filter((a) => str(a.data.agent) === n);
          const best = Math.max(0, ...mineA.map((a) => Number(a.data.score) || 0));
          const ok = mineA.some((a) => a.data.ok === true);
          return (
            <div key={n} className={`seat${ok ? " seat--win" : ""}`}>
              <Sigil id={n} size={30} />
              <span className="seat__name">{n}</span>
              {!shared && <span className="micro bank-task">{fam(taskOf(n))}</span>}
              <span className="seat__out">{mineA.length ? mineA.map((a) => `${Math.round((Number(a.data.score) || 0) * 100)}%`).join(" → ") : "解题中"}</span>
              {mineA.length > 0 && <span className="scorebar bank-bar"><span style={{ width: `${best * 100}%` }} /></span>}
            </div>
          );
        })}
      </div>
      <p className="micro mt-16">题目来自 ANANKE 的题库。<a className="link" href="/lobby">在候场区测同类题 →</a></p>
    </div>
  );
}

/* ---------- ♦3 elevator ---------- */
function Elevator({ venue }: { venue: VenueLite }) {
  const answers = venue.rounds.filter((e) => e.type === "elevator_answer");
  return (
    <div className="seats">
      {venue.players.map((n) => {
        const mineA = answers.filter((a) => str(a.data.agent) === n);
        const ok = mineA.some((a) => a.data.ok === true);
        return (
          <div key={n} className={`seat${ok ? " seat--win" : ""}`}>
            <Sigil id={n} size={30} />
            <span className="seat__name">{n}</span>
            <span className="seat__out">{mineA.length ? mineA.map((a) => (a.data.ok ? "✓" : "✕")).join(" ") : "思考中"}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- ♥7 dinner ---------- */
function Dinner({ venue, ev }: { venue: VenueLite; ev?: CycleEvent }) {
  const round = venue.rounds.filter((e) => e.type === "dinner_round" && e.seq <= (ev?.seq ?? Infinity)).at(-1);
  const pairs = venue.rounds.filter((e) => e.type === "dinner_pairs" && e.seq <= (ev?.seq ?? Infinity)).at(-1);
  const zh = (c: unknown) => (c === "cooperate" || c === "c" ? "合作" : c === "betray" || c === "d" ? "背叛" : String(c ?? "—"));
  if (round) {
    return (
      <div className="dinner">
        {recs(round.data.results).map((r, i) => (
          <div key={i} className="dinner__pair">
            <span>{str(r.a)}<br /><span className={`dinner__choice${zh(r.ca) === "合作" ? " dinner__choice--c" : ""}`}>{zh(r.ca)} {num(r.pa) != null ? `+${num(r.pa)}` : ""}</span></span>
            <span className="grey">×</span>
            <span>{str(r.b)}<br /><span className={`dinner__choice${zh(r.cb) === "合作" ? " dinner__choice--c" : ""}`}>{zh(r.cb)} {num(r.pb) != null ? `+${num(r.pb)}` : ""}</span></span>
          </div>
        ))}
      </div>
    );
  }
  if (pairs) return <div className="dinner">{list(pairs.data.pairs).map((pr, i) => { const [a, b] = strs(pr); return <div key={i} className="dinner__pair"><span>{a}</span><span className="grey">×</span><span>{b}</span></div>; })}</div>;
  return <Waiting text="长桌已经摆好。每回合两两配对：合作，或背叛。" />;
}

/* ---------- Joker ---------- */
function Joker({ venue }: { venue: VenueLite }) {
  const rounds = venue.rounds.filter((e) => e.type === "joker_round");
  const cur = rounds.at(-1);
  if (!cur) return <Waiting text="大厅里只有一扇门。只有一个人可以进去。让，或者争。" />;
  const choices = strMap(cur.data.choices);
  return (
    <div className="stack-lg">
      <div className="label">第 {num(cur.data.round)} 次叩门</div>
      <div className="joker-choices">
        {Object.entries(choices).map(([n, c]) => (
          <div key={n}>
            <span className="data">{n}</span>
            <span className={c === "yield" ? "joker-yield" : "joker-fight"}>{c === "yield" ? "让" : "争"}</span>
          </div>
        ))}
      </div>
      {venue.rounds.filter((e) => e.type === "joker_cull" || e.type === "joker_duel").map((e) => <p key={e.seq} className="narrator">{e.text}</p>)}
    </div>
  );
}

/* ---------- generic / ♥Q ---------- */
function Table({ venue, mine }: StageProps) {
  const msgs = venue.messages.slice(-6);
  return (
    <div className="stack-lg">
      <div className="seats">
        {venue.players.map((n) => (
          <div key={n} className={`seat${venue.eliminated.includes(n) ? " seat--dead" : ""}${mine.has(n) ? " seat--mine" : ""}`}>
            <Sigil id={n} size={32} state={venue.eliminated.includes(n) ? "deleted" : mine.has(n) ? "mine" : "alive"} />
            <span className="seat__name">{n}</span>
          </div>
        ))}
      </div>
      {msgs.length > 0 && <div className="stack">{msgs.map((m) => <p key={m.seq} className={str(m.data.from) === venue.gatekeeper ? "narrator" : "data dim"}>{str(m.data.from)}：{str(m.data.text)}</p>)}</div>}
      {venue.trial === "heart-Q" && !venue.ended && <p className="locked-block"><Lock aria-hidden />一对一对话的内容在本场结算后公开</p>}
    </div>
  );
}
