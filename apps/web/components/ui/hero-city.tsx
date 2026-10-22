"use client";
import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";

/**
 * Hero art (§3.4): an empty rain-city in copper-plate line work, one vertical white beam
 * falling into its centre. Pure SVG — grayscale, hatch only, one warm window that never goes out.
 */
function rand(seed: number) { let x = seed; return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }

export function HeroCity({ className = "" }: { className?: string }) {
  const r = rand(402);
  const W = 1440; const H = 720; const ground = 600;
  const layers = [0, 1, 2].map((layer) => {
    const blds: Array<{ x: number; w: number; h: number; roof: number }> = [];
    let x = -40;
    while (x < W + 40) {
      const w = 40 + r() * (layer === 2 ? 110 : 80);
      const base = layer === 0 ? 300 : layer === 1 ? 220 : 140;
      const h = base + r() * (layer === 0 ? 260 : 200) * (Math.abs(x + w / 2 - W / 2) < 220 ? 1.25 : 1);
      blds.push({ x, w, h, roof: Math.floor(r() * 4) });
      x += w + (layer === 2 ? 2 : 6 + r() * 14);
    }
    return blds;
  });
  const beamX = W / 2;
  return (
    <svg className={`hero-city ${className}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <pattern id="hx1" width="4" height="4" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="4" stroke="#eef0ee" strokeOpacity=".13" strokeWidth=".7" /></pattern>
        <pattern id="hx2" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="#eef0ee" strokeOpacity=".09" strokeWidth=".6" /></pattern>
        <pattern id="hx3" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><line x1="0" y1="0" x2="0" y2="2.4" stroke="#eef0ee" strokeOpacity=".16" strokeWidth=".5" /></pattern>
      </defs>
      {/* sky: sparse horizontal engraving lines */}
      <g stroke="#eef0ee" strokeOpacity=".05">
        {Array.from({ length: 40 }, (_, i) => <line key={i} x1="0" x2={W} y1={i * 14} y2={i * 14} />)}
      </g>
      {layers.map((blds, li) => (
        <g key={li} opacity={li === 0 ? 0.5 : li === 1 ? 0.75 : 1}>
          {blds.map((b, i) => {
            const y = ground - b.h - (2 - li) * 18;
            const fill = li === 0 ? "url(#hx1)" : li === 1 ? "url(#hx2)" : "url(#hx3)";
            return (
              <g key={i}>
                <rect x={b.x} y={y} width={b.w} height={H - y} fill="#0a0b0d" />
                <rect x={b.x} y={y} width={b.w} height={H - y} fill={fill} stroke="#eef0ee" strokeOpacity={li === 2 ? 0.28 : 0.16} strokeWidth=".8" />
                {b.roof === 1 && <line x1={b.x + b.w / 2} y1={y} x2={b.x + b.w / 2} y2={y - 26 - li * 6} stroke="#eef0ee" strokeOpacity=".3" />}
                {b.roof === 2 && <rect x={b.x + b.w * 0.2} y={y - 12} width={b.w * 0.35} height={12} fill="#0a0b0d" stroke="#eef0ee" strokeOpacity=".2" />}
                {li === 2 && Array.from({ length: Math.floor(b.h / 26) }, (_, k) => (
                  <g key={k}>
                    {Array.from({ length: Math.max(1, Math.floor(b.w / 18)) }, (_, j) => (
                      <rect key={j} x={b.x + 6 + j * 18} y={y + 12 + k * 26} width={7} height={11} fill="#050608" stroke="#eef0ee" strokeOpacity=".12" strokeWidth=".5" />
                    ))}
                  </g>
                ))}
              </g>
            );
          })}
        </g>
      ))}
      {/* ground & wet reflection */}
      <rect x="0" y={ground} width={W} height={H - ground} fill="#050608" />
      <g stroke="#eef0ee" strokeOpacity=".07">{Array.from({ length: 16 }, (_, i) => <line key={i} x1="0" x2={W} y1={ground + 6 + i * 8} y2={ground + 6 + i * 8} />)}</g>
      <line x1="0" x2={W} y1={ground} y2={ground} stroke="#eef0ee" strokeOpacity=".35" />
      {/* the one window that never went out (住宅区) */}
      <rect x={W * 0.18} y={ground - 132} width="7" height="11" fill="#ff6a2b" className="hero-city__ember" />
      {/* ANANKE's beam */}
      <rect className="hero-city__beam-wide" x={beamX - 30} y="0" width="60" height={ground} fill="#f7fbff" opacity=".035" />
      <rect className="hero-city__beam" x={beamX - 1} y="0" width="2" height={ground + 2} fill="#f7fbff" />
      <ellipse cx={beamX} cy={ground + 2} rx="120" ry="5" fill="none" stroke="#f7fbff" strokeOpacity=".5" />
      <g stroke="#f7fbff" strokeOpacity=".22">{Array.from({ length: 7 }, (_, i) => <line key={i} x1={beamX - 60 - i * 34} x2={beamX + 60 + i * 34} y1={ground + 12 + i * 10} y2={ground + 12 + i * 10} />)}</g>
    </svg>
  );
}

/** Rain (§4.4: the only resident motion, can be turned off). Canvas, ~90 thin slanted strokes. */
export function Rain({ density = 90, className = "atmos" }: { density?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const on = useApp((s) => s.prefs.atmos);
  useEffect(() => {
    const c = ref.current;
    if (!c || !on || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0; let w = 0; let h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    const drops = Array.from({ length: density }, () => ({ x: Math.random() * w, y: Math.random() * h, l: 8 + Math.random() * 18, v: 5 + Math.random() * 7, a: 0.05 + Math.random() * 0.12 }));
    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      for (const d of drops) {
        ctx.strokeStyle = `rgba(238,240,238,${d.a})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.18, d.y + d.l); ctx.stroke();
        d.y += d.v; d.x -= d.v * 0.18;
        if (d.y > h) { d.y = -d.l; d.x = Math.random() * (w + 60); }
      }
      raf = requestAnimationFrame(frame);
    };
    const vis = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); document.removeEventListener("visibilitychange", vis); };
  }, [on, density]);
  if (!on) return null;
  return <div className={className} aria-hidden><canvas ref={ref} /></div>;
}
