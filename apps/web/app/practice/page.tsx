"use client";
import Link from "next/link";
import { advance, buildObservation, createCycle, npcHint, type CycleEvent, type CycleState } from "@echo/engine";
import { decideRule, PERSONAS, personaProfile, type Persona } from "@echo/agents/bots";
import { useEffect, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Player } from "@/components/player";
import { Sigil } from "@/components/ui/sigil";

/**
 * Practice ground (§6.10): the real engine runs in your browser with rule bots.
 * A whole city on the ladder rules (four suits, 48 cards, the Joker), nothing saved. 这里的死亡不算数。
 */
const NAMES = ["Basil", "Halo", "Iris", "Juno", "Kite", "Lark", "Vex", "Wren", "Yara", "Zed", "Onyx"];
const PERSONA_IDS = Object.keys(PERSONAS) as Persona[];

function simulate(mine: Persona, name: string, rivals: number, seed: string): CycleEvent[] {
  const personas: Persona[] = [mine, ...Array.from({ length: rivals }, (_, i) => PERSONA_IDS[(i * 7 + seed.length) % PERSONA_IDS.length])];
  const roster = personas.map((p, i) => ({
    id: `pr-${i}`,
    name: i === 0 ? name : NAMES[i - 1],
    host: { name: i === 0 ? "你" : "无名", relation: "练习对象", memories: ["这里的死亡不算数。"], belief: PERSONAS[p].motto },
    kind: `bot:${p}`,
    profile: personaProfile(p),
  }));
  let s: CycleState = createCycle({ id: "practice", seed, roster, config: { mode: "ladder", slotsPerDay: 8 } });
  const events: CycleEvent[] = [];
  let input: Parameters<typeof advance>[1] = {};
  for (let guard = 0; guard < 20000; guard++) {
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
  const [persona, setPersona] = useState<Persona>("guardian");
  const [name, setName] = useState("Moth");
  const [rivals, setRivals] = useState(7);
  const [seed, setSeed] = useState("");
  const [events, setEvents] = useState<CycleEvent[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setSeed(Math.random().toString(36).slice(2, 8));
  }, []);
  const run = () => {
    setErr("");
    try { setEvents(simulate(persona, name.trim() || "Moth", rivals, seed || "practice")); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const startAt = 0;
  const fate = events?.filter((e) => e.type === "agent_deleted").find((e) => e.data.id === "pr-0");

  return (
    <div>
      <div className="practice-banner"><span className="label">PRACTICE</span><span className="hand">这里的死亡不算数。</span></div>
      {!events ? (
        <div className="wrap">
          <header className="page-head">
            <div className="label label--grey">练习场 · 真实引擎 · 本地运行</div>
            <h1 className="display d-hero zh mt-16">练习场</h1>
            <p className="body-lg mt-24">真正的城市规则，在你的浏览器里跑完一整轮。你的 Agent 由一个规则人格驱动，对手也是。<span className="grey">什么都不会被记住。</span></p>
          </header>
          <div className="practice">
            <section>
              <div className="label label--grey">01 · 规则</div>
              <p className="body mt-16" style={{ maxWidth: 720 }}>四个花色各一条 2→K 的梯子：♦ 推理、♣ 规划与协作、♠ 博弈与决策、♥ 记忆与指令。每一场选一个花色，挑战下一张牌；2–4 失败 Uptime −1，5–10 失败 −2，J/Q/K 失败即删除。走完 48 张开启 JOKER，第一个通过的人赢。人格决定了它在六个维度上的能力，也决定它偏爱哪个花色。<Link className="arrow-link" href="/cards">看四十八张牌 →</Link></p>
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
            <div className="btn-row mt-40"><button type="button" className="btn btn--solid" onClick={run}><Play />开始一轮</button></div>
          </div>
        </div>
      ) : (
        <>
          <div className="wrap practice-result">
            <span className="data">{name} · {PERSONAS[persona].label} · 种子 {seed} · {events.length} 事件</span>
            <span className="data grey">{fate ? `✝ 第 ${fate.night} 天 · 但这里的死亡不算数。` : ""}</span>
            <span className="btn-row"><button type="button" className="btn btn--sm" onClick={() => { setSeed(Math.random().toString(36).slice(2, 8)); setEvents(null); }}><RotateCcw />再来一次</button></span>
          </div>
          <Player key={`${seed}:${persona}`} events={events} myAgentIds={["pr-0"]} startAt={startAt} autoplay defaultSpeed={2} title="练习场" />
        </>
      )}
    </div>
  );
}
