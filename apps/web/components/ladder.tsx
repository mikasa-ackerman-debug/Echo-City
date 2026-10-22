"use client";
import type { LadderRow, LadderSuit } from "@/lib/types";

export const LADDER_SUITS: LadderSuit[] = ["♦", "♣", "♠", "♥"];
export const SUIT_THEME: Record<LadderSuit, string> = { "♦": "推理", "♣": "规划与协作", "♠": "博弈与决策", "♥": "记忆与指令" };

/** Twelve pips: 2..10 then the three gatekeepers (J/Q/K, outlined). */
export function Pips({ n }: { n: number }) {
  return (
    <span className="ladder-pips" aria-label={`${n}/12`}>
      {Array.from({ length: 12 }, (_, i) => <i key={i} className={`${i < n ? "is-on" : ""}${i >= 9 ? " is-face" : ""}`} />)}
    </span>
  );
}

const STATUS_ZH: Record<string, string> = { alive: "存活", deleted: "已删除", ascended: "并入", returned: "归来", archived: "存档", registered: "候场" };

/** Everyone's progress on the four ladders. The first to clear all 48 may knock on the Joker. */
export function LadderBoard({ rows, mine = [], winner }: { rows: LadderRow[]; mine?: string[]; winner?: string | null }) {
  const sorted = [...rows].sort((a, b) => Number(b.status === "alive") - Number(a.status === "alive") || b.total - a.total);
  return (
    <div className="table-scroll">
      <table className="table ladder-board">
        <thead>
          <tr>
            <th>Agent</th>
            {LADDER_SUITS.map((s) => <th key={s} title={SUIT_THEME[s]}>{s} <span className="grey">{SUIT_THEME[s]}</span></th>)}
            <th className="num">进度</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.name} className={r.status !== "alive" && r.status !== "ascended" ? "grey" : ""}>
              <td>
                <span className={mine.includes(r.name) ? "paper" : ""}>{r.name}</span>{" "}
                <span className="micro grey">{winner === r.name ? "★ 推开了最后的门" : STATUS_ZH[r.status] ?? r.status}</span>
              </td>
              {LADDER_SUITS.map((s) => <td key={s}><Pips n={r.ladder[s] ?? 0} /> <span className="micro tnum">{r.ladder[s] ?? 0}</span></td>)}
              <td className="num tnum">{r.total >= 48 ? "JOKER" : `${r.total}/48`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
