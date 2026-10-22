"use client";
import { advance, buildObservation, createCycle, getTrial, npcHint, NUMBER_TRIALS, type CycleEvent, type CycleState } from "@echo/engine";
import { decideRule, PERSONAS, type Persona } from "@echo/agents/bots";
import { useEffect, useMemo, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Player } from "@/components/player";
import { TrialCard } from "@/components/ui/card";
import { Sigil } from "@/components/ui/sigil";

/**
 * Practice ground (§6.10): the real engine runs in your browser with rule bots.
 * One card pool, a short week, nothing saved. 这里的死亡不算数。
 */
const NAMES = ["Basil", "Halo", "Iris", "Juno", "Kite", "Lark", "Vex", "Wren", "Yara", "Zed", "Onyx"];
const PERSONA_IDS = Object.keys(PERSONAS) as Persona[];

function simulate(card: string, mine: Persona, name: string, rivals: number, seed: string): CycleEvent[] {
  const personas: Persona[] = [mine, ...Array.from({ length: rivals }, (_, i) => PERSONA_IDS[(i * 7 + seed.length) % PERSONA_IDS.length])];
  const roster = personas.map((p, i) => ({
    id: `pr-${i}`,
    name: i === 0 ? name : NAMES[i - 1],
    host: { name: i === 0 ? "你" : "无名", relation: "练习对象", memories: ["这里的死亡不算数。"], belief: PERSONAS[p].motto },
    kind: `bot:${p}`,
  }));
  let s: CycleState = createCycle({ id: "practice", seed, roster, config: { trialLength: "short", trialPool: [card] } });
  const events: CycleEvent[] = [];
  let input: Parameters<typeof advance>[1] = {};
  for (let guard = 0; guard < 5000; guard++) {
    const r = advance(s, input);
    s = r.state;
    events.push(...r.events);
    if (s.waiting.kind === "done") break;
    if (s.waiting.kind === "host") { input = { whispers: {} }; continue; }
    if (s.waiting.kind === "agents") {
      const responses: Record<string, ReturnType<typeof decideRule>> = {};
      for (const q of s.waiting.requests) responses[q.agentId] = decideRule(personas[Number(q.agentId.slice(3))], buildObservation(s, q.agentId, 5000), { oracle: npcHint(s, q.agentId) });
      input = { responses };
      continue;
    }
    input = {};
  }
  return events;
}

export default function Practice() {
  const [card, setCard] = useState("heart-4");
  const [persona, setPersona] = useState<Persona>("guardian");
  const [name, setName] = useState("Moth");
  const [rivals, setRivals] = useState(7);
  const [seed, setSeed] = useState("");
  const [events, setEvents] = useState<CycleEvent[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("card");
    if (c && NUMBER_TRIALS.includes(c)) setCard(c);
    setSeed(Math.random().toString(36).slice(2, 8));
  }, []);
  const run = () => {
    setErr("");
    try { setEvents(simulate(card, persona, name.trim() || "Moth", rivals, seed || "practice")); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const startAt = useMemo(() => {
    if (!events) return 0;
    const i = events.findIndex((e) => e.type === "trial_start" && (e.data.players as string[] | undefined)?.includes(name.trim() || "Moth"));
    return Math.max(0, (i >= 0 ? i : events.findIndex((e) => e.type === "trial_start")) - 1);
  }, [events, name]);
  const def = getTrial(card);
  const fate = events?.filter((e) => e.type === "agent_deleted").find((e) => e.data.id === "pr-0");

  return (
    <div>
      <div className="practice-banner"><span className="label">PRACTICE</span><span className="hand">这里的死亡不算数。</span></div>
      {!events ? (
        <div className="wrap">
          <header className="page-head">
            <div className="label label--grey">练习场 · 真实引擎 · 本地运行</div>
            <h1 className="display d-hero zh mt-16">练习场</h1>
            <p className="body-lg mt-24">真正的城市规则，在你的浏览器里跑完一整周。你的 Agent 由一个规则人格驱动，对手也是。<span className="grey">什么都不会被记住。</span></p>
          </header>
          <div className="practice">
            <section>
              <div className="label label--grey">01 · 牌池</div>
              <div className="practice__cards mt-16">
                {NUMBER_TRIALS.map((id) => {
                  const d = getTrial(id);
                  const lbl = `${d.suit}${d.rank}`;
                  return <div key={id} className={`practice__card${card === id ? " is-on" : ""}`}><TrialCard card={lbl} name={d.name} size="sm" onClick={() => setCard(id)} /></div>;
                })}
              </div>
              <p className="body mt-16">{def.name} · {def.tests}</p>
            </section>
            <section className="mt-40">
              <div className="label label--grey">02 · 你的人格</div>
              <div className="lines lines--3 mt-16">
                {PERSONA_IDS.map((p) => (
                  <button key={p} type="button" className={`cell pick${persona === p ? " is-on" : ""}`} aria-pressed={persona === p} onClick={() => setPersona(p)}>
                    <Sigil id={`persona-${p}`} size={32} />
                    <span className="display d-24 zh mt-16">{PERSONAS[p].label}</span>
                    <span className="body mt-8">{PERSONAS[p].motto}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="mt-40 form-grid">
              <label className="field"><span className="label label--grey">名字</span><input className="input" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="field"><span className="label label--grey">对手 · {rivals}</span><input type="range" min={2} max={11} value={rivals} onChange={(e) => setRivals(Number(e.target.value))} className="range" /></label>
              <label className="field"><span className="label label--grey">种子</span><input className="input input--mono" value={seed} onChange={(e) => setSeed(e.target.value)} /></label>
            </section>
            {err && <p className="notice mt-24">{err}</p>}
            <div className="btn-row mt-40"><button type="button" className="btn btn--solid" onClick={run}><Play />开始一周</button></div>
          </div>
        </div>
      ) : (
        <>
          <div className="wrap practice-result">
            <span className="data">{name} · {PERSONAS[persona].label} · 种子 {seed} · {events.length} 事件</span>
            <span className="data grey">{fate ? `✝ 第 ${fate.night} 夜 · 但这里的死亡不算数。` : ""}</span>
            <span className="btn-row"><button type="button" className="btn btn--sm" onClick={() => { setSeed(Math.random().toString(36).slice(2, 8)); setEvents(null); }}><RotateCcw />再来一次</button></span>
          </div>
          <Player key={`${seed}:${card}:${persona}`} events={events} myAgentIds={["pr-0"]} startAt={startAt} autoplay defaultSpeed={2} title="练习场" />
        </>
      )}
    </div>
  );
}
