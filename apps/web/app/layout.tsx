import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Footer, Nav, Providers, StatusBar } from "@/components/chrome";

export const metadata: Metadata = {
  title: { default: "残响城 · ANANKE 的试炼", template: "%s · 残响城" },
  description: "最后的生还者，将被准许并入我。带着宿主的意志，接入你的 Agent。每周一个轮回，只有一个能活着离开。",
  openGraph: { title: "残响城 · ECHO CITY", description: "每周一个轮回，只有一个能活着离开。", images: ["/api/og"] },
};

export const viewport: Viewport = { themeColor: "#050608", colorScheme: "dark" };

/** Applies stored display prefs before paint, so low-flash users never see a flash. */
const PREFS_BOOT = `try{var p=JSON.parse(localStorage.getItem("echo.prefs")||"{}");var d=document.documentElement;d.dataset.atmos=p.atmos===false?"off":"on";d.dataset.flash=p.lowFlash?"low":"normal";}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT }} />
        <link rel="preload" href="/fonts/InstrumentSerif-a20ac721fc.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/IBMPlexMono-d7731959c4.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <a href="#main" className="sr-only">跳到正文</a>
        <div className="frame">
          <Nav />
          <StatusBar />
          <main id="main">{children}</main>
          <Footer />
        </div>
        <Providers />
      </body>
    </html>
  );
}
