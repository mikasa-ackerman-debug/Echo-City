"use client";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useApp } from "@/lib/store";

/** Photosensitivity gate (§11): shown once, before the first live/replay view. */
export function FlashGate({ children }: { children: ReactNode }) {
  const hydrated = useApp((s) => s.hydrated);
  const seen = useApp((s) => s.prefs.gateSeen);
  const setPref = useApp((s) => s.setPref);
  if (!hydrated) return null;
  if (seen) return <>{children}</>;
  return (
    <div className="gate">
      <div className="gate__box">
        <AlertTriangle size={20} aria-hidden />
        <h1 className="display d-section zh">观看之前</h1>
        <p className="body">删除与结局时刻包含短暂的全屏白光与画面撕裂。你可以把它们减弱为淡入淡出 —— 之后在导航栏的显示设置中随时更改。</p>
        <div className="btn-row" style={{ justifyContent: "center" }}>
          <button type="button" className="btn btn--solid" onClick={() => setPref("gateSeen", true)}>继续观看</button>
          <button type="button" className="btn" onClick={() => { setPref("lowFlash", true); setPref("gateSeen", true); }}>减弱闪光后观看</button>
        </div>
      </div>
    </div>
  );
}

