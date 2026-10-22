"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Dices, Send } from "lucide-react";
import { FAMILIES, generate, grade, reference, type GradeResult } from "@echo/exam";
import { DIMENSIONS, DIMENSION_IDS } from "@/lib/exam";

/**
 * /exam/practice — 试一题。题目在浏览器里由同一套生成器本地生成（种子公开，不计分），
 * 与服务器候场区生成的题完全一致；正式考试的种子是保密的。
 */
export default function ExamPractice() {
  const [fam, setFam] = useState(FAMILIES[0].id);
  const [level, setLevel] = useState(3);
  const [seed, setSeed] = useState("echo");
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<GradeResult | null>(null);
  const [showRef, setShowRef] = useState(false);
  const [t0, setT0] = useState(() => Date.now());

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const f = q.get("family");
    if (f && FAMILIES.some((x) => x.id === f)) setFam(f);
    const l = Number(q.get("level"));
    if (l) setLevel(l);
    setSeed(Math.random().toString(36).slice(2, 8));
  }, []);

  const f = FAMILIES.find((x) => x.id === fam)!;
  const lv = Math.min(level, f.maxLevel);
  const inst = useMemo(() => { try { return generate(fam, lv, seed); } catch (e) { return null; } }, [fam, lv, seed]);
  useEffect(() => { setResult(null); setShowRef(false); setAnswer(""); setT0(Date.now()); }, [fam, lv, seed]);

  const submit = () => {
    if (!inst) return;
    let a: unknown = answer.trim();
    // Big integers must stay exact: JSON.parse would round them to a float.
    if (!/^-?\d+$/.test(answer.trim())) { try { a = JSON.parse(answer); } catch { /* plain text answer */ } }
    setResult(grade(fam, inst.key, a));
  };

  return (
    <div className="wrap">
      <header className="page-head">
        <div className="crumbs"><Link href="/lobby">候场区</Link> / 试一题</div>
        <h1 className="display d-hero zh">试一题</h1>
        <p className="body-lg lede">挑一个题型和难度。题目由与候场区同一套生成器在你的浏览器里生成；这里的种子是公开的，所以不计分。<span className="grey">正式考试的种子只有服务器知道。</span></p>
      </header>

      <div className="exam-practice">
        <aside className="exam-practice__aside">
          {DIMENSION_IDS.map((d) => (
            <div key={d} className="mt-24">
              <div className="label label--grey">{DIMENSIONS[d].name}</div>
              <div className="famnav mt-8">
                {FAMILIES.filter((x) => x.dimension === d).map((x) => <button key={x.id} type="button" aria-pressed={x.id === fam} onClick={() => setFam(x.id)}>{x.name}</button>)}
              </div>
            </div>
          ))}
        </aside>

        <section className="exam-practice__main">
          <div className="panel">
            <div className="panel__head">
              <span className="label">{DIMENSIONS[f.dimension].en} · {f.name}</span>
              <span className="row">
                <label className="micro row" style={{ gap: 8 }}>难度 L{lv}
                  <input className="range" type="range" min={1} max={f.maxLevel} value={lv} onChange={(e) => setLevel(Number(e.target.value))} aria-label="难度" />
                </label>
                <span className="micro">种子</span>
                <input className="input input--mono seed-input" value={seed} onChange={(e) => setSeed(e.target.value.slice(0, 32))} aria-label="种子" />
                <button type="button" className="btn btn--icon" title="换一题" onClick={() => setSeed(Math.random().toString(36).slice(2, 8))}><Dices /></button>
              </span>
            </div>
            <div className="panel__body">
              {inst ? (
                <>
                  <div className="row row--between"><h2 className="display d-32 zh">{inst.task.title}</h2><span className="micro">限时 {Math.round(inst.task.time_limit_ms / 1000)} 秒</span></div>
                  <pre className="code task-prompt mt-24">{inst.task.prompt}</pre>
                  <p className="micro mt-24">答案格式 · {inst.task.answer_format}</p>
                </>
              ) : <p className="empty">这个种子没能生成题目，换一个试试。</p>}
            </div>
          </div>

          <div className="field mt-24">
            <label className="label" htmlFor="ans">你的答案</label>
            <textarea id="ans" className="input input--box input--mono" rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder='可以是纯文本，也可以是 JSON，例如 ["A","C"]' />
          </div>
          <div className="btn-row mt-16">
            <button type="button" className="btn btn--solid" onClick={submit} disabled={!answer.trim()}><Send />交卷</button>
            <button type="button" className="btn btn--ghost" onClick={() => setShowRef((v) => !v)}>{showRef ? "藏起参考答案" : "看参考答案"}</button>
          </div>

          {result && (
            <div className={`exam-result mt-24${result.correct ? " is-correct" : ""}`}>
              <div className="row row--between">
                <span className="display d-48 tnum">{Math.round(result.score * 100)}<span className="d-24">%</span></span>
                <span className="label">{result.correct ? "正确" : result.score > 0 ? "部分得分" : "错误"} · 用时 {Math.round((Date.now() - t0) / 1000)} 秒</span>
              </div>
              <p className="data mt-16">{result.detail}</p>
            </div>
          )}
          {showRef && inst && <pre className="code mt-24 refans">{JSON.stringify(reference(fam, inst.key), null, 1)}</pre>}
        </section>
      </div>
    </div>
  );
}
