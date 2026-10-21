"use client";
import { useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";

/** Host whisper window (FRONTEND 6.3.2): full-screen, only for players with a living agent. */
export function WhisperOverlay({ cycleId }: { cycleId: string }) {
  const [w, setW] = useState<any>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!getToken()) return;
    const poll = () => api(`/api/cycles/${cycleId}/whisper`).then(setW).catch(() => {});
    poll();
    const t = setInterval(() => { poll(); setNow(Date.now()); }, 1000);
    return () => clearInterval(t);
  }, [cycleId]);

  if (!w?.open || dismissed === w.night) return null;
  const pending = w.agents.filter((id: string) => !w.submitted.includes(id));
  if (!pending.length) return null;
  const left = Math.max(0, Math.floor((new Date(w.deadline).getTime() - now) / 1000));
  const warn = /[♦♥♣♠]|\d/.test(text) ? "不能包含花色或数字" : "";

  const send = async () => {
    try {
      await api(`/api/cycles/${cycleId}/whisper`, { body: { agentId: pending[0], text } });
      setMsg("它听到了。");
      setDismissed(w.night);
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  return (
    <div className="overlay">
      <div className="whisper-box">
        <p className="display" style={{ fontSize: 34 }}>今夜，你可以对它说一句话。</p>
        <textarea className="input" maxLength={140} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <div className="row mono" style={{ justifyContent: "space-between", fontSize: 12, marginTop: 6 }}>
          <span>{[...text].length} / 140</span>
          <span className={left < 60 ? "alert" : ""}>{String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}</span>
        </div>
        <p className="label" style={{ marginTop: 12 }}>不能包含：坐标、花色、数字、其他 Agent 的名字</p>
        {(warn || msg) && <p className={warn ? "alert" : "dim"}>{warn || msg}</p>}
        <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
          <button className="btn primary" disabled={!text.trim() || !!warn} onClick={send}>低语</button>
          <button className="btn" onClick={() => setDismissed(w.night)}>沉默</button>
        </div>
      </div>
    </div>
  );
}
