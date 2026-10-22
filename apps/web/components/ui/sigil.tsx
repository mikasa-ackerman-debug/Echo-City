import type { CSSProperties, ReactElement } from "react";

/** FNV-1a — deterministic per agent id. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rng(seed: number) {
  let x = seed || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; };
}

export type SigilState = "alive" | "mine" | "deleted" | "ascended" | "returned";

/**
 * Agent sigil (FRONTEND §7.3): a deterministic engraving-like emblem of circle, line and point.
 * deleted → grey with strokes missing · mine → one ember point · ascended → cold glow · returned → dashed outer ring.
 */
export function Sigil({ id, size = 40, state = "alive", title, style }: { id: string; size?: number; state?: SigilState; title?: string; style?: CSSProperties }) {
  const r = rng(hash(id));
  const parts: ReactElement[] = [];
  const C = 50;
  const k = (n: number) => Math.round(n * 10) / 10;
  // inner ring (one of three radii)
  const rings = [18, 26, 32];
  const ringR = rings[Math.floor(r() * 3)];
  parts.push(<circle key="ring" cx={C} cy={C} r={ringR} />);
  // spokes: 1–3 lines at fixed angular steps (engraving rhythm: multiples of 30°)
  const spokes = 1 + Math.floor(r() * 3);
  for (let i = 0; i < spokes; i++) {
    const a = (Math.floor(r() * 12) * 30 * Math.PI) / 180;
    const inner = r() < 0.5 ? 0 : ringR;
    parts.push(<line key={`s${i}`} x1={k(C + Math.cos(a) * inner)} y1={k(C + Math.sin(a) * inner)} x2={k(C + Math.cos(a) * 44)} y2={k(C + Math.sin(a) * 44)} />);
  }
  // chord or arc
  if (r() < 0.6) {
    const a1 = r() * Math.PI * 2; const a2 = a1 + Math.PI * (0.4 + r() * 0.8);
    parts.push(<path key="arc" d={`M ${k(C + Math.cos(a1) * 38)} ${k(C + Math.sin(a1) * 38)} A 38 38 0 0 1 ${k(C + Math.cos(a2) * 38)} ${k(C + Math.sin(a2) * 38)}`} />);
  } else {
    const y = 30 + Math.floor(r() * 5) * 10;
    const half = Math.sqrt(Math.max(0, 44 * 44 - (y - C) ** 2));
    parts.push(<line key="chord" x1={k(C - half)} y1={y} x2={k(C + half)} y2={y} />);
  }
  // points
  const dots = 1 + Math.floor(r() * 3);
  for (let i = 0; i < dots; i++) {
    const a = r() * Math.PI * 2; const d = r() < 0.5 ? ringR : r() * ringR * 0.6;
    parts.push(<circle key={`d${i}`} cx={k(C + Math.cos(a) * d)} cy={k(C + Math.sin(a) * d)} r={2.4} fill="currentColor" stroke="none" />);
  }
  // deleted: drop some strokes — "part of the symbol is missing"
  const shown = state === "deleted" ? parts.filter((_, i) => i % 2 === 0) : parts;
  const cls = `sigil${state === "deleted" ? " sigil--deleted" : state === "ascended" ? " sigil--ascended" : ""}`;
  return (
    <svg className={cls} width={size} height={size} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth={size < 32 ? 3 : 2} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={style}>
      <circle cx={C} cy={C} r={46} strokeOpacity={state === "deleted" ? 0.35 : 0.55} strokeDasharray={state === "deleted" ? "10 8" : undefined} />
      {state === "returned" && <circle cx={C} cy={C} r={53} strokeDasharray="3 5" strokeOpacity={0.8} />}
      {shown}
      {state === "mine" && <circle cx={C + 31} cy={C - 31} r={6} fill="var(--ember)" stroke="var(--ink)" strokeWidth={2.5} />}
    </svg>
  );
}

/** ANANKE: a perfect circle cut by a vertical line. */
export function AnankeMark({ size = 22, className = "brand__mark", glow = false }: { size?: number; className?: string; glow?: boolean }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} aria-hidden style={glow ? { filter: "drop-shadow(0 0 6px #f7fbffaa)" } : undefined}>
      <circle cx="12" cy="12" r="9.5" />
      <line x1="12" y1="0.5" x2="12" y2="23.5" />
    </svg>
  );
}

/** Uptime pips. */
export function Pips({ value, max = 5 }: { value: number | null | undefined; max?: number }) {
  const v = Math.max(0, value ?? 0);
  const n = Math.max(max, v);
  return (
    <span className={`pips${v === 1 ? " pips--alert" : ""}`} aria-label={`Uptime ${v}`}>
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < v ? "" : "off"} />)}
    </span>
  );
}
