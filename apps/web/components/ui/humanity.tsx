"use client";
import { useId, useMemo } from "react";

export function humanityColor(h?: number | null): string | undefined {
  if (h == null || h < 0) return undefined;
  if (h >= 100) return "var(--humanity-100)";
  if (h >= 60) return "var(--humanity-60)";
  if (h >= 30) return "var(--humanity-30)";
  return "var(--humanity-0)";
}

/**
 * Humanity curve (§7.7) — only after the ending is revealed.
 * Rebuilt from cycle_end.humanity_log: the final value minus the sum of deltas gives the start.
 * "Burns" left → right; dotted guides at the 30 / 60 ending thresholds.
 */
export function HumanityCurve({ log, final, nights = 7, height = 180 }: { log: Array<{ night: number; delta: number; reason: string }>; final: number; nights?: number; height?: number }) {
  const uid = useId().replace(/:/g, "");
  const W = 640; const H = height; const P = { l: 34, r: 16, t: 14, b: 24 };
  const pts = useMemo(() => {
    const start = final - log.reduce((a, x) => a + x.delta, 0);
    let v = start;
    const per: Record<number, number> = {};
    const out: Array<{ x: number; v: number; reason?: string; delta?: number; night: number }> = [{ x: 0, v: start, night: 0 }];
    for (const e of log) {
      per[e.night] = (per[e.night] ?? 0) + 1;
      v += e.delta;
      out.push({ x: e.night - 1 + Math.min(0.9, per[e.night] * 0.14), v, reason: e.reason, delta: e.delta, night: e.night });
    }
    out.push({ x: nights, v: final, night: nights });
    return out;
  }, [log, final, nights]);
  const sx = (x: number) => P.l + (x / nights) * (W - P.l - P.r);
  const sy = (v: number) => P.t + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - P.t - P.b);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.v).toFixed(1)}`).join(" ");
  const len = pts.reduce((a, p, i) => (i ? a + Math.hypot(sx(p.x) - sx(pts[i - 1].x), sy(p.v) - sy(pts[i - 1].v)) : 0), 0);
  return (
    <svg className="hcurve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`人性曲线，最终 ${final}`}>
      <defs>
        {/* the humanity gradient is one of the two places a gradient is allowed */}
        <linearGradient id={`g${uid}`} x1="0" y1={sy(0)} x2="0" y2={sy(100)} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4f535a" /><stop offset=".3" stopColor="#8c9096" /><stop offset=".6" stopColor="#ffb38a" /><stop offset="1" stopColor="#ff6a2b" />
        </linearGradient>
      </defs>
      {[0, 30, 60, 100].map((v) => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={sy(v)} y2={sy(v)} stroke="var(--line)" strokeDasharray={v === 30 || v === 60 ? "2 4" : undefined} />
          <text x={P.l - 8} y={sy(v) + 3} textAnchor="end" fontSize="10" fill="var(--grey)" fontFamily="var(--mono)">{v}</text>
        </g>
      ))}
      {Array.from({ length: nights }, (_, i) => <text key={i} x={sx(i + 0.5)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--grey-dark)" fontFamily="var(--mono)">N{i + 1}</text>)}
      <path d={d} fill="none" stroke={`url(#g${uid})`} strokeWidth="1.5" className="hcurve__burn" style={{ ["--len" as string]: Math.ceil(len) }} />
      {pts.slice(1, -1).map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.v)} r={3} fill="var(--ink)" stroke={humanityColor(p.v)} strokeWidth="1.2">
          <title>{`第 ${p.night} 夜 · ${p.reason} ${p.delta! > 0 ? "+" : ""}${p.delta}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Four-axis lineage radar (♦ intellect · ♥ psyche · ♣ cooperation · ♠ execution). */
export function Radar({ layers, size = 220 }: { layers: Array<{ values: [number, number, number, number]; color?: string; opacity?: number }>; size?: number }) {
  const C = size / 2; const R = size / 2 - 30;
  const axes = [["♦", "智力"], ["♥", "心理"], ["♣", "协作"], ["♠", "执行"]];
  const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i * Math.PI) / 2; return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v]; };
  return (
    <svg className="radar" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="四维画像">
      {[0.25, 0.5, 0.75, 1].map((s) => <polygon key={s} points={[0, 1, 2, 3].map((i) => pt(i, s).join(",")).join(" ")} fill="none" stroke="var(--line)" />)}
      {[0, 1, 2, 3].map((i) => { const [x, y] = pt(i, 1); const [lx, ly] = pt(i, 1.2); return <g key={i}><line x1={C} y1={C} x2={x} y2={y} stroke="var(--line)" /><text x={lx} y={ly + 4} textAnchor="middle">{axes[i][0]} {axes[i][1]}</text></g>; })}
      {layers.map((l, k) => <polygon key={k} points={l.values.map((v, i) => pt(i, Math.max(0.04, Math.min(1, v))).join(",")).join(" ")} fill="none" stroke={l.color ?? "var(--paper)"} strokeOpacity={l.opacity ?? 1} strokeWidth={k === layers.length - 1 ? 1.5 : 1} />)}
    </svg>
  );
}
