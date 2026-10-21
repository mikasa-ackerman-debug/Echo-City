import { LIMITS, SUITS, sanitizeText, textLength } from "@echo/protocol";
import { DISTRICT_POOL, ARK } from "./city";
import type { CycleState } from "./types";

/**
 * Host whisper validation (GDD 3.4 / D3): ≤140 chars, emotional only. It may
 * not carry game information: suits, district names, other agents' names or
 * coordinates/numbers.
 */
export function validateWhisper(raw: string, s?: CycleState): { ok: true; text: string } | { ok: false; reason: string } {
  const text = sanitizeText(raw, 1000);
  if (!text) return { ok: false, reason: "低语不能为空" };
  if (textLength(text) > LIMITS.whisper) return { ok: false, reason: `低语不能超过 ${LIMITS.whisper} 字` };
  for (const suit of SUITS) if (text.includes(suit)) return { ok: false, reason: "低语不能包含花色" };
  if (/(方块|红心|黑桃|梅花|diamond|heart|spade|club)/i.test(text)) return { ok: false, reason: "低语不能包含花色" };
  if (/\d|[零一二三四五六七八九十]+\s*(号|格|步|点|分|天)/.test(text)) return { ok: false, reason: "低语不能包含数字或坐标" };
  const districts = [...DISTRICT_POOL.map((d) => d.name), ARK, "方舟"];
  for (const d of districts) if (text.includes(d)) return { ok: false, reason: "低语不能包含街区名" };
  if (s) {
    for (const a of Object.values(s.agents)) {
      if (a.name.length >= 2 && text.toLowerCase().includes(a.name.toLowerCase())) return { ok: false, reason: "低语不能包含 Agent 的名字" };
    }
  }
  return { ok: true, text };
}
