import { REASON_ZH, suitClass } from "@/lib/player";

/** Tombstone card (FRONTEND 7.6). */
export function Tomb({ t }: { t: any }) {
  return (
    <div className="tomb">
      <div className="label">✝ 第 {t.night} 夜 · <span className={suitClass(t.card)}>{t.card ?? REASON_ZH[t.reason] ?? t.reason}</span></div>
      <div className="display" style={{ fontSize: 30, marginTop: 8 }}>{t.name}</div>
      <div className="grey" style={{ fontSize: 12 }}>第 {t.generation} 代 · 宿主 {t.host}</div>
      {t.lastWords ? <div className="lw">「{t.lastWords}」</div> : <div className="lw grey">（没有留下遗言）</div>}
      {t.epitaph && <div className="dim" style={{ fontSize: 12 }}>墓志铭：{t.epitaph}</div>}
      {t.letter && <div className="dim" style={{ fontSize: 12, marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>遗书：{t.letter}</div>}
    </div>
  );
}
