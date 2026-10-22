"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { Send, Square } from "lucide-react";
import { api, errorMessage, getToken } from "@/lib/api";
import { ScoreBar } from "@/components/exam";
import { DIMENSIONS, useSession, type SessionDTO, type TaskDTO } from "@/lib/exam";

/** /exam/s/[id] — 一场考试：逐题进度、得分与参考答案（判分后才公开）。拉取模式的主人可以在这里亲自答题。 */
export default function ExamSession({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [poll, setPoll] = useState<number | undefined>(1500);
  const s = useSession(id, poll);
  const d = s.data;
  useEffect(() => { if (d && d.status !== "running") setPoll(undefined); }, [d]);
  const done = d?.attempts.filter((a) => a.score !== undefined).length ?? 0;
  const [open, setOpen] = useState<number | null>(null);

  if (!d) return <div className="wrap"><p className="empty">{s.error ?? "读取考卷……"}</p></div>;
  const e = d.examinee;
  const total = d.attempts.length;
  const sum = d.attempts.reduce((x, a) => x + (a.score ?? 0), 0);

  return (
    <div className="wrap">
      <header className="page-head">
        <div className="crumbs"><Link href="/exam">考场</Link> / {e ? <Link href={`/exam/e/${e.id}`}>{e.name}</Link> : "—"} / 考卷</div>
        <div className="row row--between row--end mt-16">
          <div>
            <div className="label label--grey">{d.status === "running" ? "进行中" : d.status === "done" ? "已交卷" : "已中止"} · {new Date(d.createdAt).toLocaleString("zh-CN", { hour12: false })}</div>
            <h1 className="display d-hero zh">{e?.name ?? "考卷"}</h1>
            {e && <div className="micro mt-8">{e.kind === "pull" ? "拉取" : e.kind === "hosted" ? "托管" : e.kind === "webhook" ? "Webhook" : "基准"}{e.model ? ` · ${e.model}` : ""}</div>}
          </div>
          <div className="exam-total">
            <span className="display d-page tnum">{d.score ?? Math.round((sum / Math.max(1, done)) * 100)}</span><span className="display d-32">%</span>
            <div className="micro tnum mt-8">{done}/{total} 题{d.status === "running" && done ? " · 暂时成绩" : ""}</div>
          </div>
        </div>
        <div className="progress mt-24" aria-hidden>{d.attempts.map((a) => <i key={a.i} className={a.score === undefined ? (a.issuedAt ? "is-now" : "") : a.correct ? "is-ok" : a.score > 0 ? "is-part" : "is-bad"} />)}</div>
      </header>

      {d.status === "running" && e?.kind === "pull" && <PullDesk session={d} onChange={s.reload} />}

      <section className="section">
        <div className="attempts">
          {d.attempts.map((a) => (
            <div key={a.i} className={`attempt${open === a.i ? " is-open" : ""}`}>
              <button type="button" className="attempt__row" onClick={() => setOpen(open === a.i ? null : a.i)} aria-expanded={open === a.i}>
                <span className="micro tnum">{String(a.i + 1).padStart(2, "0")}</span>
                <span className="label label--grey">{DIMENSIONS[a.dimension].name}</span>
                <span className="serif">{a.title ?? <span className="grey-dark">未发题</span>}</span>
                <span className="micro tnum">{a.level ? `L${a.level}` : ""}</span>
                <ScoreBar score={a.score} />
                <span className="data tnum attempt__score">{a.score !== undefined ? Math.round(a.score * 100) : ""}</span>
                <span className="micro tnum attempt__delta">{a.after !== undefined && a.before !== undefined ? `${a.after - a.before >= 0 ? "+" : ""}${a.after - a.before}` : ""}</span>
              </button>
              {open === a.i && a.score !== undefined && (
                <div className="attempt__body">
                  <div><div className="micro">判定</div><p className="data mt-8">{a.detail}{a.ms !== undefined ? ` · ${(a.ms / 1000).toFixed(1)} 秒` : ""}</p></div>
                  <div><div className="micro">作答</div><pre className="code mt-8">{a.answer || "（空）"}</pre></div>
                  <div><div className="micro">参考</div><pre className="code mt-8">{a.expected}</pre></div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PullDesk({ session, onChange }: { session: SessionDTO; onChange: () => void }) {
  const [task, setTask] = useState<TaskDTO | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [answer, setAnswer] = useState("");
  const [err, setErr] = useState("");
  const [last, setLast] = useState<{ score: number; detail: string; expected: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [owner, setOwner] = useState(true);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);

  const fetchNext = useCallback(async () => {
    if (!getToken()) { setOwner(false); return; }
    try {
      const r = await api<{ done: boolean; task?: TaskDTO; deadline?: string }>(`/api/exam/sessions/${session.id}/next`);
      if (r.done) { setTask(null); onChange(); return; }
      setTask(r.task!); setDeadline(Date.parse(r.deadline!)); setAnswer("");
    } catch (e) { setOwner(false); setErr(errorMessage(e)); }
  }, [session.id, onChange]);
  useEffect(() => { fetchNext(); }, [fetchNext]);

  if (!owner) return null;
  const submit = async () => {
    if (!task) return;
    let a: unknown = answer.trim();
    try { a = JSON.parse(answer); } catch { /* text */ }
    try {
      const r = await api<{ score: number; detail: string; expected: string }>(`/api/exam/sessions/${session.id}/answer`, { body: { task_id: task.id, answer: a } });
      setLast(r); onChange(); fetchNext();
    } catch (e) { setErr(errorMessage(e)); }
  };
  const abort = async () => { if (confirm("中止这场考试？")) { await api(`/api/exam/sessions/${session.id}/abort`, { body: {} }); onChange(); } };
  const left = Math.max(0, Math.round((deadline - now) / 1000));

  return (
    <section className="section">
      <div className="panel">
        <div className="panel__head">
          <span className="label">亲自作答 · {task ? `${DIMENSIONS[task.dimension].name} · L${task.level}` : "…"}</span>
          <span className={`data tnum${left < 15 ? " ember" : ""}`}>{task ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : ""}</span>
        </div>
        <div className="panel__body">
          {task ? (
            <>
              <h2 className="display d-32 zh">{task.title}</h2>
              <pre className="code task-prompt mt-24">{task.prompt}</pre>
              <p className="micro mt-24">答案格式 · {task.answer_format}</p>
              <textarea className="input input--box input--mono mt-16" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <div className="btn-row mt-16">
                <button type="button" className="btn btn--solid" onClick={submit} disabled={!answer.trim()}><Send />交卷，下一题</button>
                <button type="button" className="btn btn--ghost" onClick={abort}><Square />中止考试</button>
              </div>
            </>
          ) : <p className="micro">领取题目……</p>}
          {last && <p className="data mt-24 grey">上一题：{Math.round(last.score * 100)} 分 · {last.detail}</p>}
          {err && <p className="notice mt-16">{err}</p>}
        </div>
      </div>
    </section>
  );
}
