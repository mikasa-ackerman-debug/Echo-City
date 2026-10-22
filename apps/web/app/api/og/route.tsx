import { ImageResponse } from "next/og";

export const runtime = "edge";

/** Share card (§6.13): /api/og?name=Moth&card=♥4&night=3&words=… — tomb or default poster. */
export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const name = (q.get("name") ?? "").slice(0, 24);
  const card = (q.get("card") ?? "").slice(0, 6);
  const night = q.get("night");
  const words = (q.get("words") ?? "").slice(0, 80);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#050608", color: "#eef0ee", padding: 64, border: "1px solid #24272b", fontFamily: "serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, letterSpacing: 6, color: "#8c9096" }}>
          <span>ECHO CITY · 残响城</span>
          <span>{name ? `✝ ${card}${night ? ` · NIGHT ${night}` : ""}` : "TRIALS OF ANANKE"}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: name ? 140 : 96, lineHeight: 0.92, textTransform: "uppercase" }}>{name || "最后的生还者"}</div>
          {!name && <div style={{ fontSize: 96, lineHeight: 0.92 }}>将被准许并入我。</div>}
          {words && <div style={{ fontSize: 40, color: "#ff6a2b", marginTop: 32, fontStyle: "italic" }}>「{words}」</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, color: "#4f535a", letterSpacing: 4 }}>
          <span>每周一个轮回 · 只有一个能活着离开</span>
          <span>●</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
