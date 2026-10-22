"use client";
import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";
import { suitOf } from "@/lib/player";

const SUIT_PATH: Record<string, string> = {
  diamond: "M50 6 L84 50 L50 94 L16 50 Z",
  heart: "M50 88 C 20 66 7 50 7 33 C 7 19 18 9 31 9 C 40 9 46 14 50 22 C 54 14 60 9 69 9 C 82 9 93 19 93 33 C 93 50 80 66 50 88 Z",
  spade: "M50 6 C 80 30 93 44 93 58 C 93 71 83 79 72 79 C 63 79 56 74 53 68 C 54 78 58 86 65 93 L 35 93 C 42 86 46 78 47 68 C 44 74 37 79 28 79 C 17 79 7 71 7 58 C 7 44 20 30 50 6 Z",
  club: "M50 10 A 17 17 0 1 1 49.9 10 Z M28 40 A 17 17 0 1 1 27.9 40 Z M72 40 A 17 17 0 1 1 71.9 40 Z M47 60 C 47 74 43 84 35 93 L 65 93 C 57 84 53 74 53 60 Z",
};
export const SUIT_GLYPH: Record<string, string> = { diamond: "♦", heart: "♥", club: "♣", spade: "♠", joker: "◯" };

/** Copper-engraving suit emblem: hatch fill + contour echoes + sunburst ground. */
export function SuitEngraving({ suit, className }: { suit: string; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const path = SUIT_PATH[suit];
  if (suit === "joker" || !path) {
    return (
      <svg className={className} viewBox="0 0 100 100" fill="none" stroke="currentColor" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => <circle key={i} cx="50" cy="50" r={44 - i * 4.6} strokeWidth={i === 0 ? 1 : 0.4} strokeOpacity={i === 0 ? 1 : 0.6} />)}
        <line x1="50" y1="0" x2="50" y2="100" strokeWidth="1" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" stroke="currentColor" aria-hidden>
      <defs>
        <pattern id={`h${uid}`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
          <line x1="0" y1="0" x2="0" y2="3" strokeWidth="0.7" />
        </pattern>
        <clipPath id={`c${uid}`}><path d={path} /></clipPath>
      </defs>
      <g strokeWidth="0.25" strokeOpacity="0.45">
        {Array.from({ length: 36 }, (_, i) => { const a = (i * 10 * Math.PI) / 180; return <line key={i} x1={50 + Math.cos(a) * 47} y1={50 + Math.sin(a) * 47} x2={50 + Math.cos(a) * 53} y2={50 + Math.sin(a) * 53} />; })}
      </g>
      <rect x="0" y="0" width="100" height="100" fill={`url(#h${uid})`} clipPath={`url(#c${uid})`} stroke="none" opacity="0.85" />
      <path d={path} strokeWidth="1" />
      <path d={path} strokeWidth="0.4" strokeOpacity="0.55" transform="translate(50 50) scale(1.12) translate(-50 -50)" />
      <path d={path} strokeWidth="0.3" strokeOpacity="0.35" transform="translate(50 50) scale(1.24) translate(-50 -50)" />
    </svg>
  );
}

export function CardBack() {
  return (
    <svg viewBox="0 0 100 140" width="100%" height="100%" fill="none" stroke="currentColor" aria-hidden style={{ color: "var(--paper)" }}>
      <rect x="6" y="6" width="88" height="128" strokeWidth="0.5" strokeOpacity="0.5" />
      {Array.from({ length: 14 }, (_, i) => <circle key={i} cx="50" cy="70" r={36 - i * 2.5} strokeWidth="0.3" strokeOpacity={0.25 + (i % 3) * 0.1} />)}
      <circle cx="50" cy="70" r="36" strokeWidth="1" />
    </svg>
  );
}

function parse(card: string) {
  const suit = suitOf(card) ?? "joker";
  const rank = card.replace(/[♦♥♣♠]/g, "").trim() || (suit === "joker" ? "J" : "");
  return { suit, rank };
}

/**
 * Trial card (§7.2), 5:7. Flip = rotateY 180°, --dur-slow, --ease-system, one frame of white at 90°.
 */
export function TrialCard({ card, name, back = false, flipOnMount = false, size, href, locked, onClick, children }: {
  card: string; name?: string; back?: boolean; flipOnMount?: boolean; size?: "lg" | "sm" | "xs"; href?: string; locked?: boolean; onClick?: () => void; children?: ReactNode;
}) {
  const { suit, rank } = parse(card);
  const [isBack, setBack] = useState(back || flipOnMount);
  const [flipping, setFlipping] = useState(false);
  useEffect(() => {
    if (!flipOnMount) { setBack(back); return; }
    const t1 = setTimeout(() => { setFlipping(true); setBack(false); }, 1000);
    const t2 = setTimeout(() => setFlipping(false), 1700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [back, flipOnMount]);
  const cls = `tcard${size ? ` tcard--${size}` : ""}${isBack ? " is-back" : ""}${flipping ? " is-flipping" : ""}${locked ? " tcard--locked" : ""}`;
  const glyph = SUIT_GLYPH[suit];
  const body = (
    <>
      <div className="tcard__inner">
        <div className={`tcard__face tcard__face--front suit-${suit}`}>
          <span className="tcard__corner tcard__corner--tl">{rank}<small>{glyph}</small></span>
          <span className="tcard__corner tcard__corner--br">{rank}<small>{glyph}</small></span>
          <div className="tcard__art"><SuitEngraving suit={suit} /></div>
          {name && <span className="tcard__name">{name}</span>}
          {children}
        </div>
        <div className="tcard__face tcard__face--back"><CardBack /></div>
      </div>
      <span className="tcard__flash" aria-hidden />
    </>
  );
  const label = `${card}${name ? ` ${name}` : ""}${isBack ? "（背面）" : ""}`;
  if (href) return <Link href={href} className={cls} aria-label={label}>{body}</Link>;
  if (onClick) return <button type="button" className={cls} aria-label={label} onClick={onClick}>{body}</button>;
  return <div className={cls} role="img" aria-label={label}>{body}</div>;
}

export function SuitMark({ card, className = "" }: { card?: string; className?: string }) {
  if (!card) return null;
  const s = suitOf(card);
  return <span className={`${s ? `suit-${s}` : ""} ${className}`}>{card}</span>;
}
