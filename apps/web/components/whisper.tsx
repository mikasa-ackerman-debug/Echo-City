"use client";
import { ARK, DISTRICT_POOL, validateWhisper } from "@echo/engine";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorMessage, getToken } from "@/lib/api";
import type { WhisperWindow } from "@/lib/types";

/**
 * Host whisper window (FRONTEND §6.3.2). Opens for 90 s after each night's settlement,
 * only for players with a living agent. Native <dialog> handles focus trap + Escape.
 * Validation mirrors the server (engine validateWhisper); offending words get a grey wavy underline.
 */

const RULES: Array<{ re: RegExp; why: string }> = [
  { re: /[♦♥♣♠]|方块|红心|黑桃|梅花|diamond|heart|spade|club/gi, why: "花色" },
  { re: /\d+|[零一二三四五六七八九十]+\s*(号|格|步|点|分|天)/g, why: "数字或坐标" },
  { re: new RegExp([...DISTRICT_POOL.map((d) => d.name), ARK, "方舟"].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g"), why: "街区名" },
];

function marks(text: string, names: string[]) {
  const out: Array<{ from: number; to: number; why: string }> = [];
  const rules = [...RULES];
  const ns = names.filter((n) => n.length >= 2).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (ns.length) rules.push({ re: new RegExp(ns.join("|"), "gi"), why: "Agent 的名字" });
  for (const r of rules) for (const m of text.matchAll(r.re)) out.push({ from: m.index ?? 0, to: (m.index ?? 0) + m[0].length, why: r.why });
  return out.sort((a, b) => a.from - b.from);
}

function Underlined({ text, ms }: { text: string; ms: ReturnType<typeof marks> }) {
  const parts: ReactNode[] = [];
  let i = 0;
  ms.forEach((m, k) => {
    if (m.from < i) return;
    parts.push(text.slice(i, m.from));
    parts.push(<mark key={k} className="wavy" title={`不能包含${m.why}`}>{text.slice(m.from, m.to)}</mark>);
    i = m.to;
  });
  parts.push(text.slice(i));
  return <>{parts}</>;
}

export function WhisperOverlay({ cycleId, agentNames = {}, otherNames = [] }: { cycleId: string; agentNames?: Record<string, string>; otherNames?: string[] }) {
  const [w, setW] = useState<WhisperWindow | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(0);
  const clockOffset = useRef(0);
  const open = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const night = w?.night ?? 0;
  const pending = w?.open ? (w.agents ?? []).filter((id) => !(w.submitted ?? []).includes(id) && !submitted.includes(`${night}:${id}`) && !dismissed.includes(`${night}:${id}`)) : [];
  const agentId = pending.includes(selected) ? selected : pending[0];
  const key = `${night}:${agentId}`;
  const text = drafts[key] ?? "";
  const active = !!agentId;
  open.current = !!w?.open;

  useEffect(() => {
    setW(null); setDismissed([]); setSubmitted([]); setDrafts({});
    if (!getToken()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const started = Date.now();
      try {
        const next = await api<WhisperWindow>(`/api/cycles/${encodeURIComponent(cycleId)}/whisper`);
        if (stopped) return;
        const received = Date.now();
        const serverNow = Date.parse(next.serverNow);
        if (Number.isFinite(serverNow)) clockOffset.current = serverNow - (started + received) / 2;
        open.current = !!next.open;
        setW(next);
        setNow(received + clockOffset.current);
      } catch { /* the window simply stays closed */ }
      if (!stopped) timer = setTimeout(poll, open.current ? 1000 : 10000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [cycleId]);

  useEffect(() => {
    if (!active) { dialog.current?.close(); return; }
    if (!dialog.current?.open) dialog.current?.showModal();
    const timer = setInterval(() => setNow(Date.now() + clockOffset.current), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => { setMsg(""); }, [agentId, night]);

  const others = useMemo(() => otherNames.filter((n) => n !== agentNames[agentId ?? ""]), [otherNames, agentNames, agentId]);
  const ms = useMemo(() => marks(text, others), [text, others]);
  const local = text.trim() ? validateWhisper(text) : null;
  const warn = ms.length ? `不能包含${[...new Set(ms.map((m) => m.why))].join("、")}` : local && !local.ok ? local.reason : "";
  const deadline = w?.deadline ? Date.parse(w.deadline) : NaN;
  const left = Number.isFinite(deadline) ? Math.max(0, Math.floor((deadline - now) / 1000)) : null;
  const count = [...text].length;

  const dismiss = () => { if (agentId) { setDismissed((prev) => [...prev, key]); setMsg(""); } };
  const send = async () => {
    setSending(true);
    try {
      await api(`/api/cycles/${encodeURIComponent(cycleId)}/whisper`, { body: { agentId, text } });
      setSubmitted((prev) => [...prev, key]);
      setMsg("它听到了。");
    } catch (e) { setMsg(errorMessage(e)); }
    finally { setSending(false); }
  };

  return (
    <dialog ref={dialog} className="whisper" aria-labelledby="whisper-title" aria-describedby="whisper-rules" onCancel={(e) => { e.preventDefault(); if (!sending) dismiss(); }}>
      <div className="whisper__box">
        <div className="row row--between">
          <span className="label label--grey">宿主低语 · 第 {night} 夜</span>
          <span className={`countdown${left != null && left < 60 ? " countdown--alert" : ""}`} aria-label="剩余时间">{left == null ? "—" : `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`}</span>
        </div>
        <h2 id="whisper-title" className="whisper__title">今夜，你可以对它说一句话。</h2>
        {pending.length > 1 && (
          <div className="tabs" role="tablist" aria-label="低语对象">
            {pending.map((id) => <button key={id} type="button" role="tab" className="tab" aria-selected={id === agentId} onClick={() => setSelected(id)}>{agentNames[id] ?? id}</button>)}
          </div>
        )}
        {pending.length === 1 && <p className="data dim">对 <span className="paper">{agentNames[agentId ?? ""] ?? agentId}</span></p>}
        <div className="whisper__field">
          <div className="whisper__ghost" aria-hidden><Underlined text={text} ms={ms} />{"\u200b"}</div>
          <textarea aria-label="给 Agent 的低语" aria-describedby="whisper-rules whisper-warn" aria-invalid={!!warn} className="whisper__input" maxLength={140} value={text} disabled={sending} onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))} autoFocus placeholder="晚晚以前说过，不要为了活下去，变成不是自己的东西。" />
        </div>
        <div className="row row--between data">
          <span className={count > 140 ? "alert" : "grey"}>{count} / 140</span>
          <span id="whisper-warn" role="status" className={warn ? "grey" : "dim"}>{warn || msg}</span>
        </div>
        <p id="whisper-rules" className="label label--grey zh">不能包含：坐标、花色、数字、街区、其他 Agent 的名字</p>
        <div className="btn-row" style={{ justifyContent: "center" }}>
          <button type="button" className="btn btn--solid" disabled={!active || sending || !text.trim() || !!warn || left === 0} onClick={send}>{sending ? "发送中…" : "低语"}</button>
          <button type="button" className="btn" disabled={sending} onClick={dismiss}>沉默</button>
        </div>
        <p className="micro" style={{ textAlign: "center" }}>沉默也是一个选择。回放里会记下：宿主沉默了。</p>
      </div>
    </dialog>
  );
}
