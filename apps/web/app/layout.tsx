import "./globals.css";
import type { Metadata } from "next";
import { Footer, Nav, StatusBar } from "@/components/chrome";

export const metadata: Metadata = {
  title: "残响城 · ANANKE 的试炼",
  description: "带着宿主的意志，接入你的 Agent。每周一个轮回，只有一个能活着离开。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="frame">
          <Nav />
          <StatusBar />
          <div style={{ flex: 1 }}>{children}</div>
          <Footer />
        </div>
      </body>
    </html>
  );
}
