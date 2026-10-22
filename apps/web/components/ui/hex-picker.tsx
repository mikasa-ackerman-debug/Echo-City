"use client";
import { useCallback, useRef, useState } from "react";

export interface DimensionWeights {
  logic: number;
  math: number;
  planning: number;
  memory: number;
  instruction: number;
  strategy: number;
}

const DIMENSIONS: Array<{ key: keyof DimensionWeights; label: string; en: string }> = [
  { key: "logic", label: "逻辑", en: "LOGIC" },
  { key: "math", label: "数学", en: "MATH" },
  { key: "planning", label: "规划", en: "PLANNING" },
  { key: "memory", label: "记忆", en: "MEMORY" },
  { key: "instruction", label: "指令", en: "INSTRUCTION" },
  { key: "strategy", label: "博弈", en: "STRATEGY" },
];

const MAX_VAL = 5;
const SIZE = 260;
const CENTER = SIZE / 2;
const RADIUS = 90;

function polar(angle: number, r: number): [number, number] {
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
}

/** 六边形维度权重选择器：拖动顶点调整各维度权重。 */
export function HexDimensionPicker({
  weights,
  onChange,
}: {
  weights: DimensionWeights;
  onChange: (w: DimensionWeights) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const angles = DIMENSIONS.map((_, i) => -Math.PI / 2 + (i * Math.PI * 2) / 6);

  // Grid rings
  const rings = [1, 2, 3, 4, 5].map((level) =>
    angles.map((a) => polar(a, (level / MAX_VAL) * RADIUS))
  );

  // Data polygon
  const dataPoints = DIMENSIONS.map((d, i) => {
    const v = weights[d.key];
    return polar(angles[i], (v / MAX_VAL) * RADIUS);
  });
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ") + " Z";

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - (rect.width / SIZE) * CENTER;
      const y = e.clientY - rect.top - (rect.height / SIZE) * CENTER;
      const idx = DIMENSIONS.findIndex((d) => d.key === dragging);
      if (idx < 0) return;
      // Project onto the axis for this dimension
      const a = angles[idx];
      const proj = x * Math.cos(a) + y * Math.sin(a);
      const val = Math.round(Math.max(0, Math.min(MAX_VAL, (proj / RADIUS) * MAX_VAL)));
      onChange({ ...weights, [dragging]: val });
    },
    [dragging, onChange, angles]
  );

  const handlePointerUp = useCallback(() => setDragging(null), []);

  return (
    <div className="hexpicker" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ touchAction: "none", cursor: dragging ? "grabbing" : "default" }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Grid rings */}
        {rings.map((ring, ri) => (
          <polygon
            key={ri}
            points={ring.map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke="var(--line)"
            strokeWidth={ri === MAX_VAL - 1 ? 1 : 0.5}
            opacity={0.4}
          />
        ))}
        {/* Axis lines */}
        {angles.map((a, i) => {
          const [x, y] = polar(a, RADIUS);
          return <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="var(--line)" strokeWidth={0.5} opacity={0.3} />;
        })}
        {/* Data polygon */}
        <polygon points={dataPoints.map((p) => p.join(",")).join(" ")} fill="var(--ember)" fillOpacity={0.12} stroke="var(--ember)" strokeWidth={1.5} />
        {/* Draggable vertices */}
        {DIMENSIONS.map((d, i) => {
          const [x, y] = dataPoints[i];
          const isHover = hovered === d.key || dragging === d.key;
          return (
            <g key={d.key}>
              <circle
                cx={x} cy={y} r={isHover ? 8 : 6}
                fill={isHover ? "var(--ember)" : "var(--ink)"}
                stroke="var(--ember)" strokeWidth={1.5}
                style={{ cursor: "grab" }}
                onPointerDown={(e) => { e.preventDefault(); setDragging(d.key); }}
                onPointerEnter={() => setHovered(d.key)}
                onPointerLeave={() => setHovered(null)}
              />
              {isHover && (
                <text x={x} y={y - 14} textAnchor="middle" fill="var(--ember)" fontSize={11} fontFamily="var(--mono)" fontWeight={500}>
                  {weights[d.key]}
                </text>
              )}
            </g>
          );
        })}
        {/* Labels */}
        {DIMENSIONS.map((d, i) => {
          const [x, y] = polar(angles[i], RADIUS + 22);
          return (
            <text key={d.key} x={x} y={y + 4} textAnchor="middle" fill="var(--grey)" fontSize={11} fontFamily="var(--mono)">
              {d.label}
            </text>
          );
        })}
      </svg>
      {/* Numeric indicators */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
        {DIMENSIONS.map((d) => (
          <span key={d.key} className="micro tnum" style={{ padding: "2px 8px", border: "1px solid var(--line)", color: weights[d.key] > 0 ? "var(--paper)" : "var(--grey-dark)" }}>
            {d.label} {weights[d.key]}
          </span>
        ))}
      </div>
    </div>
  );
}

export { DIMENSIONS as HEX_DIMENSIONS };
