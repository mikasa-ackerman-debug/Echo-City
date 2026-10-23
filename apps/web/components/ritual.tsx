"use client";
import Link from "next/link";
import { ANANKE } from "@echo/engine";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { HumanType, Narrator } from "./ui/text";
import { Sigil } from "./ui/sigil";
import { TrialCard } from "./ui/card";

/**
 * Rituals (FRONTEND §8). The only moments allowed to break the stillness.
 * Every ritual: click / Esc / Space / Enter skips; focus is trapped on the overlay; aria-live announces.
 */

function useSkippable(onDone: () => void, ms: number) {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(onDone); doneRef.current = onDone;
  const finish = useCallback(() => {
    setLeaving(true);
    setTimeout(() => doneRef.current(), 420);
  }, []);
  useEffect(() => {
    const t = setTimeout(finish, ms);
    const key = (e: KeyboardEvent) => { if (["Escape", " ", "Enter"].includes(e.key)) { e.preventDefault(); finish(); } };
    window.addEventListener("keydown", key);
    return () => { clearTimeout(t); window.removeEventListener("keydown", key); };
  }, [finish, ms]);
  return { leaving, finish };
}

function Shell({ children, leaving, finish, label, assertive }: { children: ReactNode; leaving: boolean; finish: () => void; label: string; assertive?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div ref={ref} tabIndex={-1} className={`ritual${leaving ? " is-leaving" : ""}`} role="dialog" aria-modal="true" aria-label={label} aria-live={assertive ? "assertive" : "polite"} onClick={finish}>
      <div className="ritual__frame" />
      {children}
      <span className="ritual__skip">点击或按 Esc 跳过</span>
    </div>
  );
}

export interface DeletionItem { id: string; name: string; card?: string; lastWords?: string; epitaph?: string; alive?: number }

/** 8.1 — deletion. ~4 s, 8 s and ending on actions when it's *my* agent. Simultaneous deletions show words in sequence. */
export function DeletionRitual({ items, mine, onDone }: { items: DeletionItem[]; mine?: boolean; onDone: () => void }) {
  const [i, setI] = useState(0);
  const item = items[i];
  const last = i === items.length - 1;
  const next = useCallback(() => { if (last) onDone(); else setI((x) => x + 1); }, [last, onDone]);
  const { leaving, finish } = useSkippable(next, mine && last ? 9000 : 4800);
  if (!item) return null;
  return (
    <Shell key={item.id} leaving={leaving} finish={finish} label={`${item.name} 被删除`} assertive>
      {i === 0 && <div className="del__beam" aria-hidden />}
      {i === 0 && <div className="del__overexpose" aria-hidden />}
      {items.length > 1 && <div className="del__multi">{i + 1} / {items.length} · 同一回合</div>}
      <div className="del" onClick={(e) => mine && last && e.stopPropagation()}>
        <div className="del__sigil del__glitch"><Sigil id={item.id} size={132} state={mine ? "mine" : "alive"} /></div>
        <div className="del__name">{item.name}</div>
        {item.card && <div className="del__card">{item.card}</div>}
        <div className="del__words">{item.lastWords ? <HumanType as="span" className="" text={`「${item.lastWords}」`} delay={1200} /> : <span className="grey-dark">「……」</span>}</div>
        {item.epitaph && <p className="del__epitaph">{item.epitaph}</p>}
        <div className="del__ananke"><Narrator text={ANANKE.deleted(item.name)} /></div>
        {item.alive != null && <div className="del__count">存活 <b>{item.alive}</b></div>}
        {mine && last && (
          <div className="del__actions btn-row" style={{ justifyContent: "center" }}>
            <Link href="/me" className="btn btn--solid">写遗书</Link>
            <Link href="/play" className="btn">唤醒下一代 · 直接进候场区</Link>
          </div>
        )}
      </div>
    </Shell>
  );
}

/** 8.2 — card flip at a trial's opening. */
export function FlipRitual({ venue, card, name, rules, onDone }: { venue: string; card: string; name: string; rules?: string; onDone: () => void }) {
  const { leaving, finish } = useSkippable(onDone, 5200);
  const first = (rules ?? "").split(/\n/)[0]?.slice(0, 90);
  return (
    <Shell leaving={leaving} finish={finish} label={`${venue} · ${card} ${name}`}>
      <div className="flip">
        <div className="flip__venue">{venue}</div>
        <TrialCard card={card} name={name} size="lg" flipOnMount />
        <div className="flip__announce announce" style={{ justifyContent: "center" }}>
          <span><b>试炼</b>{name}</span><span><b>难度</b>{card}</span>
        </div>
        <div className="flip__rules stack" style={{ justifyItems: "center" }}>
          {first && <p className="data dim">{first}…</p>}
          <Narrator text="祝各位好运。我是认真的。" />
        </div>
      </div>
    </Shell>
  );
}

/** 8.3 — rule amendment: a white hairline around the viewport, like a system interrupt. */
export function InterruptFrame({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, [onDone]);
  return <div className="interrupt" role="alert"><span className="interrupt__label">RULE UPDATE · 规则追加</span><span className="sr-only">{text}</span></div>;
}

/** 8.4 — endings. */
export function EndingRitual({ kind, onDone }: { kind: string; onDone: () => void }) {
  const k = ["ember", "echo", "necessity", "none"].includes(kind) ? kind : "none";
  const { leaving, finish } = useSkippable(onDone, k === "necessity" ? 5600 : 7600);
  const line = (ANANKE.ending as Record<string, string>)[k] ?? ANANKE.ending.none;
  return (
    <Shell leaving={leaving} finish={finish} label={line}>
      <div className={`ending ending--${k}`}>
        {k === "none" && (
          <div className="ending__city" aria-hidden>
            {Array.from({ length: 24 }, (_, i) => <span key={i} style={{ ["--d" as string]: `${(i * 7919) % 24 * 55}ms` }} />)}
          </div>
        )}
        <div className="ending__white" />
        <p className="ending__line">{line}</p>
        {(k === "ember" || k === "echo") && <span className="ending__term">{k === "ember" ? "ember://connected" : "ember://conn…ect…ed"}</span>}
        {(k === "ember" || k === "echo") && <span className="ending__ember" />}
      </div>
    </Shell>
  );
}
