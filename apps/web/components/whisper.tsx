"use client";
import { useEffect, useRef, useState } from "react";
import { api, getToken } from "@/lib/api";

/** Each living agent gets its own whisper; native modal handles focus trapping/Escape. */
export function WhisperOverlay({ cycleId }: { cycleId: string }) {
  const [w, setW] = useState<any>(null);
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
  const pending: string[] = w?.open ? (w.agents ?? []).filter((id: string) => !(w.submitted ?? []).includes(id) && !submitted.includes(`${w.night}:${id}`) && !dismissed.includes(`${w.night}:${id}`)) : [];
  const agentId = pending.includes(selected) ? selected : pending[0];
  const text = drafts[`${w?.night}:${agentId}`] ?? "";
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
        const next = await api(`/api/cycles/${encodeURIComponent(cycleId)}/whisper`);
        if (stopped) return;
        const received = Date.now();
        const serverNow = typeof next.serverNow === "number" ? next.serverNow : Date.parse(next.serverNow);
        if (Number.isFinite(serverNow)) clockOffset.current = serverNow - (started + received) / 2;
        open.current = !!next.open;
        setW(next);
        setNow(received + clockOffset.current);
      } catch {}
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
  useEffect(() => { setMsg(""); }, [agentId, w?.night]);

  const deadline = typeof w?.deadline === "number" ? w.deadline : Date.parse(w?.deadline);
  const left = Number.isFinite(deadline) ? Math.max(0, Math.floor((deadline - now) / 1000)) : null;
  const warn = /[♦♥♣♠]|\d/.test(text) ? "不能包含花色或数字" : "";
  const dismiss = () => {
    if (agentId) setDismissed((prev) => [...prev, `${w.night}:${agentId}`]);
  };
  const send = async () => {
    const key = `${w.night}:${agentId}`;
    setSending(true);
    try {
      await api(`/api/cycles/${encodeURIComponent(cycleId)}/whisper`, { body: { agentId, text } });
      setSubmitted((prev) => [...prev, key]);
      setMsg("它听到了。");
    } catch (e: any) { setMsg(e.message); }
    finally { setSending(false); }
  };

  return (
    <dialog ref={dialog} className="whisper-dialog" aria-labelledby="whisper-title" aria-describedby="whisper-rules" onCancel={(e) => { e.preventDefault(); if (!sending) dismiss(); }}>
      <div className="whisper-box">
        <h2 id="whisper-title" className="display" style={{ fontSize: 34 }}>今夜，你可以对它说一句话。</h2>
        {active && <label className="field">低语对象<select className="input" value={agentId} disabled={sending} onChange={(e) => setSelected(e.target.value)}>{pending.map((id) => <option key={id} value={id}>{w.agentNames?.[id] ?? id}</option>)}</select></label>}
        <textarea aria-label="给 Agent 的低语" aria-describedby="whisper-rules" className="input" maxLength={140} value={text} disabled={sending} onChange={(e) => setDrafts((prev) => ({ ...prev, [`${w.night}:${agentId}`]: e.target.value }))} autoFocus />
        <div className="row mono" style={{ justifyContent: "space-between", fontSize: 12, marginTop: 6 }}>
          <span>{[...text].length} / 140</span>
          <span aria-label="剩余时间" className={left != null && left < 60 ? "alert" : ""}>{left == null ? "—" : `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`}</span>
        </div>
        <p id="whisper-rules" className="label" style={{ marginTop: 12 }}>不能包含：坐标、花色、数字、其他 Agent 的名字</p>
        {(warn || msg) && <p role="status" className={warn ? "alert" : "dim"}>{warn || msg}</p>}
        <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
          <button className="btn primary" disabled={!active || sending || !text.trim() || !!warn || left === 0} onClick={send}>{sending ? "发送中…" : "低语"}</button>
          <button className="btn" disabled={sending} onClick={dismiss}>对此 Agent 保持沉默</button>
        </div>
      </div>
    </dialog>
  );
}
