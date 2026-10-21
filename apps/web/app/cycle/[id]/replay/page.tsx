"use client";
import { use, useEffect, useState } from "react";
import { ReplayView } from "@/components/replay-view";
import { api } from "@/lib/api";

export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [replay, setReplay] = useState<any>(null);
  const [err, setErr] = useState("");
  const [mine, setMine] = useState<string[]>([]);
  useEffect(() => {
    api(`/api/cycles/${encodeURIComponent(id)}/replay`).then(setReplay).catch((e) => setErr(e.message));
    api("/api/me").then((m) => setMine(m.agents.map((a: any) => a.id))).catch(() => {});
  }, [id]);
  if (err) return <div className="wrap block"><p className="grey">{err}</p></div>;
  if (!replay) return <div className="wrap block"><p className="grey">…</p></div>;
  return <ReplayView replay={replay} myAgentIds={mine} />;
}
