"use client";
import { JOKER_TRIAL, LADDER, TRIALS } from "@echo/engine";
import { useState } from "react";
import type { AgentLive } from "@/lib/ladder-live";
import { LADDER_SUITS, SUIT_THEME } from "./ladder";

const RANK = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

/**
 * 本轮全局牌库: the 48 cards + JOKER of this city. A card is crossed out as soon as an agent has cleared it;
 * the counts show how many cleared it and how many are standing in front of it right now.
 * Pick an agent to see the deck through its eyes: its cleared cards crossed out, its next card on each suit lit.
 */
export function DeckStatus({ agents, mine = [] }: { agents: AgentLive[]; mine?: string[] }) {
  const [who, setWho] = useState<string>("all");
  const one = who === "all" ? null : agents.find((a) => a.id === who) ?? null;
  const alive = agents.filter((a) => a.status === "alive" || a.status === "ascended");
  const cleared = (suit: string, i: number) => (one ? ((one.ladder[suit] ?? 0) > i ? 1 : 0) : agents.filter((a) => (a.ladder[suit] ?? 0) > i).length);
  const facing = (suit: string, i: number) => (one ? (one.status === "alive" && (one.ladder[suit] ?? 0) === i ? 1 : 0) : alive.filter((a) => a.status === "alive" && (a.ladder[suit] ?? 0) === i).length);
  const jokerOpen = one ? one.jokerOpen : alive.some((a) => a.jokerOpen);
  const jokerDone = one ? one.status === "ascended" : agents.some((a) => a.status === "ascended");
  const total = LADDER_SUITS.reduce((n, s) => n + RANK.filter((_, i) => cleared(s, i) > 0).length, 0);

  return (
    <div>
      <div className="row row--between" style={{ flexWrap: "wrap", gap: 16 }}>
        <p className="data">{one ? `${one.name} 已完成` : "已被完成"} <span className="tnum paper">{total}</span><span className="grey"> / 48</span>{jokerDone ? " · JOKER 已被推开" : jokerOpen ? " · JOKER 已开启" : ""}</p>
        <div className="tabs" role="tablist" aria-label="看谁的牌库" style={{ flexWrap: "wrap" }}>
          <button type="button" role="tab" className="tab" aria-selected={who === "all"} onClick={() => setWho("all")}>全局</button>
          {agents.map((a) => (
            <button key={a.id} type="button" role="tab" className={`tab${a.status === "deleted" ? " grey" : ""}`} aria-selected={who === a.id} onClick={() => setWho(a.id)}>{mine.includes(a.id) ? `★ ${a.name}` : a.name}</button>
          ))}
        </div>
      </div>
      <div className="deck-status mt-16">
        {LADDER_SUITS.map((suit) => (
          <div key={suit} className="deck-status__row">
            <div className="deck-status__suit"><span className="display d-32">{suit}</span><span className="micro grey">{SUIT_THEME[suit]}</span></div>
            {LADDER[suit].map((id, i) => {
              const n = cleared(suit, i), f = facing(suit, i);
              const t = TRIALS[id];
              return (
                <div key={id} className={`deck-card${n ? " is-done" : ""}${f ? " is-next" : ""}${i >= 9 ? " is-face" : ""}`} title={`${suit}${RANK[i]}「${t?.name ?? id}」${n ? ` · ${one ? "已完成" : `${n} 人已完成`}` : ""}${f ? ` · ${one ? "下一张" : `${f} 人正面对它`}` : ""}`}>
                  <span className="deck-card__rank">{suit}{RANK[i]}</span>
                  <span className="deck-card__name">{t?.name ?? id}</span>
                  {!one && (n > 0 || f > 0) && <span className="micro tnum deck-card__count">{n ? `✕${n}` : ""}{f ? ` ▸${f}` : ""}</span>}
                </div>
              );
            })}
          </div>
        ))}
        <div className="deck-status__row">
          <div className="deck-status__suit"><span className="display d-32">J</span><span className="micro grey">最后的门</span></div>
          <div className={`deck-card deck-card--joker${jokerDone ? " is-done" : ""}${jokerOpen && !jokerDone ? " is-next" : ""}`} title={TRIALS[JOKER_TRIAL]?.name}>
            <span className="deck-card__rank">JOKER</span>
            <span className="deck-card__name">{TRIALS[JOKER_TRIAL]?.name ?? "JOKER"}</span>
            <span className="micro">{jokerDone ? "已被推开" : jokerOpen ? "已开启" : "走完 48 张才会开启"}</span>
          </div>
        </div>
      </div>
      <p className="micro mt-16">✕ = 已被完成（打叉）· ▸ = 正站在这张牌前的人数 · 描边的是守门人 J/Q/K</p>
    </div>
  );
}
