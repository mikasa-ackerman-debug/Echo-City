"use client";
import Link from "next/link";
import { DIMENSIONS, DIMENSION_IDS, KIND_ZH, type Dimension, type ExamineeDTO } from "@/lib/exam";

const LO = 700, HI = 1700;
const SHORT: Record<Dimension, string> = { logic: "逻辑", math: "数学", planning: "规划", memory: "记忆", instruction: "指令", strategy: "博弈" };
const norm = (r: number) => Math.max(0, Math.min(1, (r - LO) / (HI - LO)));

/** Hexagonal ability chart: hairlines only, one filled polygon. */
export function Radar({ abilities, compare, size = 280 }: { abilities: Record<Dimension, { r: number; n: number }>; compare?: Record<Dimension, { r: number }>; size?: number }) {
  const c = size / 2, R = size / 2 - 44;
  const pt = (i: number, f: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
    return [c + Math.cos(a) * R * f, c + Math.sin(a) * R * f] as const;
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(",")).join(" ");
  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="六维能力图">
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={poly(Array(6).fill(f))} className="radar__ring" />)}
      {DIMENSION_IDS.map((d, i) => { const [x, y] = pt(i, 1); return <line key={d} x1={c} y1={c} x2={x} y2={y} className="radar__axis" />; })}
      {compare && <polygon points={poly(DIMENSION_IDS.map((d) => norm(compare[d].r)))} className="radar__cmp" />}
      <polygon points={poly(DIMENSION_IDS.map((d) => norm(abilities[d].r)))} className="radar__val" />
      {DIMENSION_IDS.map((d, i) => {
        const [x, y] = pt(i, 1.2);
        return (
          <text key={d} x={x} y={y} textAnchor={Math.abs(x - c) < 4 ? "middle" : x > c ? "start" : "end"} dominantBaseline="middle" className="radar__label">
            {SHORT[d]}
            <tspan className="radar__num" dx={6}>{abilities[d].n ? abilities[d].r : "—"}</tspan>
          </text>
        );
      })}
    </svg>
  );
}

/** Six thin bars, one per dimension, for table rows. */
export function DimBars({ abilities }: { abilities: Record<Dimension, { r: number; n: number }> }) {
  return (
    <span className="dimbars" title={DIMENSION_IDS.map((d) => `${DIMENSIONS[d].name} ${abilities[d].r}`).join(" · ")}>
      {DIMENSION_IDS.map((d) => <i key={d} style={{ height: `${Math.max(6, norm(abilities[d].r) * 100)}%` }} className={abilities[d].n ? "" : "is-empty"} />)}
    </span>
  );
}

export function ExamineeName({ e }: { e: Pick<ExamineeDTO, "id" | "name" | "kind" | "model"> }) {
  return (
    <Link href={`/exam/e/${e.id}`} className="examinee">
      <span className={e.kind === "house" ? "examinee__name grey" : "examinee__name"}>{e.name}</span>
      <span className="micro">{KIND_ZH[e.kind]}{e.model ? ` · ${e.model}` : ""}</span>
    </Link>
  );
}

export function ScoreBar({ score }: { score?: number }) {
  if (score === undefined) return <span className="scorebar scorebar--pending" />;
  return <span className={`scorebar${score >= 0.999 ? " is-full" : score === 0 ? " is-zero" : ""}`}><span style={{ width: `${Math.round(score * 100)}%` }} /></span>;
}
