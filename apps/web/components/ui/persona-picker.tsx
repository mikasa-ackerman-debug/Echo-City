"use client";
import { useEffect, useState } from "react";

interface PersonaSummary {
  id: string;
  name: string;
  tagline: string;
  traits: string[];
  suits: string;
  description: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** 人格模板选择器：展示 12 种人格，点击选中后回调。 */
export function PersonaPicker({ selected, onSelect }: { selected?: string; onSelect: (id: string, prompt: string) => void }) {
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [open, setOpen] = useState<string | null>(selected ?? null);

  useEffect(() => {
    fetch(`${API}/api/personas`).then((r) => r.json()).then(setPersonas).catch(() => setPersonas([]));
  }, []);

  return (
    <div>
      <div className="label label--grey">选择人格模板</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginTop: 12 }}>
        {personas.map((p) => {
          const isOpen = open === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setOpen(p.id);
                fetch(`${API}/api/personas`).then((r) => r.json()).then((all: PersonaSummary[] & { prompt?: string }) => {
                  onSelect(p.id, (all as any).find?.((x: any) => x.id === p.id)?.prompt ?? p.tagline);
                }).catch(() => onSelect(p.id, p.tagline));
              }}
              style={{
                textAlign: "left", padding: "14px 16px", cursor: "pointer",
                border: `1px solid ${isOpen ? "var(--ember)" : "var(--line)"}`,
                background: isOpen ? "rgba(224,64,64,0.06)" : "transparent",
                borderRadius: 4, transition: "all 0.15s",
              }}
            >
              <div className="serif" style={{ fontSize: 16, color: isOpen ? "var(--ember)" : "var(--paper)" }}>{p.name}</div>
              <div className="micro grey mt-4">{p.tagline}</div>
              <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                {p.traits.map((t) => (
                  <span key={t} className="micro" style={{ padding: "1px 6px", border: "1px solid var(--line)", borderRadius: 2, fontSize: 10 }}>{t}</span>
                ))}
              </div>
              <div className="micro grey-dark mt-4">{p.suits} · {p.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
