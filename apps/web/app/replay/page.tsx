"use client";
import { useEffect, useState, type DragEvent } from "react";
import { ReplayView } from "@/components/replay-view";
import { loadDemoReplay } from "@/lib/demo";
import type { ReplayDoc } from "@/lib/types";

/**
 * Offline replay viewer: plays /replays/demo.json (`npm run sim -- --out apps/web/public/replays/demo.json`).
 * Drop any echo-replay/1 file onto the page to view it. Works without the API.
 */
export default function OfflineReplay() {
  const [replay, setReplay] = useState<ReplayDoc | null>(null);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  useEffect(() => { loadDemoReplay().then(setReplay).catch((e: Error) => setErr(e.message)); }, []);
  const load = async (f?: File) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text()) as ReplayDoc;
      if (j.format !== "echo-replay/1") throw new Error("不是 echo-replay/1 文件");
      setReplay(j); setErr("");
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); void load(e.dataTransfer.files[0]); };
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <div className={`dropbar wrap${over ? " is-over" : ""}`}>
        <span className="label label--grey">离线回放 · ECHO-REPLAY/1</span>
        <span className="data grey">{err ? `${err}。` : ""}把回放 JSON 拖到这里，或 <label className="link">选择文件<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void load(e.target.files?.[0])} /></label></span>
      </div>
      {replay && <ReplayView key={`${replay.id}:${replay.seed}:${replay.events.length}`} replay={replay} />}
    </div>
  );
}
