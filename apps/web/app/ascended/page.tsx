"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { SourceNote } from "@/components/chrome";
import { Sigil } from "@/components/ui/sigil";
import { useCycles, useReplay } from "@/lib/data";

/** /ascended (§6.8): the register of those who were permitted to merge. One line each. Cold light only. */
export default function Ascended() {
  const cycles = useCycles();
  const demo = useReplay("demo");
  const rows = useMemo(() => {
    const out = (cycles.data ?? []).filter((c) => c.status === "ended").map((c) => ({ id: c.id, winner: c.winner, title: c.endingTitle, ending: c.ending, answer: undefined as string | undefined, host: undefined as string | undefined, humanity: undefined as number | undefined }));
    const d = demo.data;
    if (d?.summary.ended) {
      const i = out.findIndex((r) => r.id === d.id);
      const row = { id: d.id, winner: d.summary.winner?.name ?? null, title: d.summary.endingTitle, ending: d.summary.ending, answer: d.summary.winner?.answers?.[2] ?? d.summary.winner?.answers?.[0], host: d.summary.winner?.host, humanity: d.summary.winner?.humanity };
      if (i >= 0) out[i] = { ...out[i], ...row }; else if (cycles.source === "demo") out.push(row);
    }
    return out;
  }, [cycles.data, cycles.source, demo.data]);

  return (
    <div>
      <SourceNote source={cycles.source} />
      <div className="wrap">
        <header className="page-head">
          <div className="label label--grey">THE ASCENDED</div>
          <h1 className="display d-hero zh mt-16">并入者名录</h1>
          <p className="body-lg mt-24">每周只有一个。<span className="grey">有些周，一个也没有。</span></p>
        </header>
        <ol className="ascended">
          {rows.map((r, i) => (
            <li key={r.id} className={`ascended__row${r.winner ? "" : " is-none"}`}>
              <span className="micro tnum">{String(rows.length - i).padStart(2, "0")}</span>
              <span className="ascended__sigil">{r.winner ? <Sigil id={r.winner} size={56} state="ascended" /> : <span className="display d-32 grey">○</span>}</span>
              <span>
                <span className="display d-48">{r.winner ?? "无人生还"}</span>
                <span className="data grey ascended__meta">{r.id}{r.host ? ` · 宿主 ${r.host}` : ""}{r.humanity != null ? ` · 人性 ${r.humanity}` : ""}</span>
                {r.answer && <span className="hand ascended__answer">「{r.answer}」</span>}
              </span>
              <span className="ascended__end">
                <details><summary className="label label--grey">结局（剧透）</summary><span className={r.ending === "ember" ? "ember data" : "ananke data"}>{r.title ?? "—"}</span></details>
                <Link href={`/cycle/${r.id}/replay`} className="arrow-link">回放<ArrowRight /></Link>
              </span>
            </li>
          ))}
          {!rows.length && <li className="empty">还没有人并入。</li>}
        </ol>
      </div>
    </div>
  );
}
