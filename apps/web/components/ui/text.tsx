"use client";
import { useEffect, useRef, useState } from "react";
import { fmtDuration, useNow } from "@/lib/data";

export function useReducedMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

/**
 * ANANKE typewriter (§7.4): constant 18 ms/char, no caret. ANANKE never hesitates.
 * `human` mode: irregular 30–90 ms, with caret. Humans hesitate.
 */
export function useTypewriter(text: string, { human = false, delay = 0, enabled = true }: { human?: boolean; delay?: number; enabled?: boolean } = {}) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled || reduced) { setN(text.length); return; }
    setN(0);
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const step = () => {
      i++;
      setN(i);
      if (i < text.length) t = setTimeout(step, human ? 30 + Math.random() * 60 + (/[，。、？！,.]/.test(text[i - 1]) ? 160 : 0) : 18);
    };
    t = setTimeout(step, delay);
    return () => clearTimeout(t);
  }, [text, human, delay, enabled, reduced]);
  return { shown: text.slice(0, n), done: n >= text.length };
}

export function Narrator({ text, size, quiet, live = false, className = "" }: { text: string; size?: "lg"; quiet?: boolean; live?: boolean; className?: string }) {
  const { shown } = useTypewriter(text);
  return (
    <p className={`narrator${size ? " narrator--lg" : ""}${quiet ? " narrator--quiet" : ""} ${className}`} aria-live={live ? "polite" : undefined}>
      <span className="sr-only">ANANKE：{text}</span>
      <span aria-hidden>{shown}</span>
    </p>
  );
}

export function HumanType({ text, delay = 0, className = "hand hand--ember", as: Tag = "p" }: { text: string; delay?: number; className?: string; as?: "p" | "span" | "blockquote" }) {
  const { shown, done } = useTypewriter(text, { human: true, delay });
  return (
    <Tag className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className={done ? "" : "caret"}>{shown}</span>
    </Tag>
  );
}

/** Countdown (§7.5): tabular digits, last 60 s → alert, last 10 s → 1.2×. Driven by the server clock. */
export function Countdown({ to, size, onDone, className = "" }: { to: number; size?: "lg"; onDone?: () => void; className?: string }) {
  const now = useNow(1000);
  const left = to - now;
  const fired = useRef(false);
  useEffect(() => { if (left <= 0 && !fired.current) { fired.current = true; onDone?.(); } if (left > 0) fired.current = false; }, [left, onDone]);
  const cls = ["countdown", size === "lg" ? "countdown--lg" : "", left <= 60_000 && left > 0 ? "countdown--alert" : "", left <= 10_000 && left > 0 ? "countdown--final" : "", className].join(" ");
  return <time className={cls} dateTime={new Date(to).toISOString()} suppressHydrationWarning>{fmtDuration(left)}</time>;
}

/** Scroll reveal — opacity/transform only. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -10% 0px" });
    el.querySelectorAll(".reveal").forEach((x) => io.observe(x));
    if (el.classList.contains("reveal")) io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
