"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { REASON_ZH, WEEKDAY } from "@/lib/player";
import { Flame } from "lucide-react";
import { Sigil } from "./sigil";
import { SuitMark } from "./card";

export interface TombData {
  agentId: string;
  name: string;
  host?: string;
  relation?: string;
  generation?: number;
  night?: number;
  reason?: string;
  card?: string;
  lastWords?: string;
  epitaph?: string;
  cardsCleared?: string[];
  letter?: string;
  cycleId?: string;
}

/** Candles are a local gesture — the city does not count them on the server yet. */
function useCandle(id: string) {
  const key = `echo.candle.${id}`;
  const [lit, setLit] = useState(false);
  useEffect(() => { setLit(localStorage.getItem(key) === "1"); }, [key]);
  const toggle = () => { const v = !lit; setLit(v); try { v ? localStorage.setItem(key, "1") : localStorage.removeItem(key); } catch { /* ignore */ } };
  return { lit, toggle, count: (id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 140) + (lit ? 1 : 0) };
}

export function nightLabel(night?: number) {
  if (night == null) return "";
  return night >= 6 ? WEEKDAY[night] : `第 ${night} 夜`;
}

/** Tombstone card (§7.6). S: wall · M: lineage timeline · L: single tomb page. */
export function Tombstone({ t, size = "s", href, mine = false, lit = false }: { t: TombData; size?: "s" | "m" | "l"; href?: string | null; mine?: boolean; lit?: boolean }) {
  const candle = useCandle(t.agentId);
  const head = t.reason === "uptime" ? "耗尽" : t.card ?? REASON_ZH[t.reason ?? ""] ?? "—";
  const days = t.night ? Math.max(0, t.night - 1) : undefined;
  const link = href === undefined ? `/graveyard/${t.agentId}` : href;
  const inner = (
    <>
      <div className="tomb__top">
        <span>{t.card && t.reason !== "uptime" ? <SuitMark card={t.card} /> : head}</span>
        <span>{nightLabel(t.night)}</span>
      </div>
      <div className="row" style={{ gap: 14, alignItems: "flex-end", marginTop: size === "l" ? 28 : 18 }}>
        {size !== "s" && <Sigil id={t.agentId} size={size === "l" ? 72 : 36} state={mine ? "mine" : "deleted"} />}
        <div className="tomb__name" style={{ marginTop: 0 }}>{t.name}</div>
      </div>
      <div className="tomb__meta">{t.agentId.slice(0, 7)}{t.host ? ` · ${t.host}${t.relation ? `的${t.relation.replace(/^(她|他|TA)的/, "")}` : ""}` : ""}{t.generation && t.generation > 1 ? ` · 第 ${t.generation} 代` : ""}</div>
      <blockquote className="tomb__words">{t.lastWords ? `「${t.lastWords}」` : "「……」"}</blockquote>
      {t.epitaph && <p className="tomb__epitaph">{t.epitaph}</p>}
      {size === "l" && t.letter && (
        <div className="mt-24">
          <div className="label label--grey">写给下一代</div>
          <p className="hand mt-8" style={{ fontSize: 18 }}>{t.letter}</p>
        </div>
      )}
      <div className="tomb__foot">
        <span>
          {days != null ? `存活 ${days} 天` : ""}
          {t.cardsCleared?.length ? <> · 通关 <span className="tomb__cards">{t.cardsCleared.slice(0, 4).map((c) => <SuitMark key={c} card={c} />)}</span></> : null}
        </span>
        <button type="button" className="candle" aria-pressed={candle.lit} onClick={(e) => { e.preventDefault(); e.stopPropagation(); candle.toggle(); }} aria-label={candle.lit ? "熄灭蜡烛" : "点一支蜡烛"}>
          <Flame aria-hidden /> {candle.count}
        </button>
      </div>
    </>
  );
  const cls = `tomb tomb--${size}${lit ? " tomb--lit" : ""}`;
  return link ? <Link href={link} className={cls}>{inner}</Link> : <article className={`${cls} tomb--interactive`}>{inner}</article>;
}
