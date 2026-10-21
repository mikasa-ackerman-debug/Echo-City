import type { CycleEvent } from "@echo/engine";

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  white: (s: string) => `\x1b[97m${s}\x1b[0m`,
  ember: (s: string) => `\x1b[38;5;208m${s}\x1b[0m`,
  green: (s: string) => `\x1b[92m${s}\x1b[0m`,
  red: (s: string) => `\x1b[91m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

/** Human-readable console line for an event (spectator view: only public events). */
export function formatEvent(e: CycleEvent, color = true): string | null {
  const c = color ? C : { dim: (s: string) => s, white: (s: string) => s, ember: (s: string) => s, green: (s: string) => s, red: (s: string) => s, bold: (s: string) => s };
  const d = e.data as Record<string, any>;
  switch (e.type) {
    case "cycle_start":
      return c.white(`● ANANKE：${e.text}`) + "\n" + c.dim(`  城市：${(d.districts as string[]).join(" · ")}\n  参赛：${(d.agents as any[]).map((a) => a.name).join("、")}`);
    case "amendment":
    case "dawn":
    case "venues_lit":
    case "finale":
    case "quiet_night":
    case "inquiry_start":
      return c.white(`● ${e.type === "dawn" ? `\n━━ ${e.text}` : e.text}`);
    case "trial_start":
      return `\n${c.bold(`┏━ 试炼：${d.name}  ${d.card}  @${d.district}`)}\n${c.dim(`┃ 参与者：${(d.players as string[]).join("、")}`)}`;
    case "trial_end":
      return c.bold(`┗━ ${d.card} 结束：${e.text}`);
    case "agent_deleted":
      return c.red(`  ✝ ${d.agent} 被删除（${d.reason}${d.card ? ` · ${d.card}` : ""}）`) + (d.last_words ? c.ember(`  「${d.last_words}」`) : "") + c.dim(`  存活 ${d.alive}`);
    case "cycle_end":
      return `\n${c.white(`● ANANKE：${e.text}`)}\n${c.bold(`  ${d.ending_title}`)}${d.winner ? ` —— ${c.ember(d.winner.name)}（宿主 ${d.winner.host}，人性 ${d.winner.humanity}）` : ""}`;
    case "inquiry_question":
      return c.white(`  ${e.text}`);
    case "inquiry_answer":
      return c.ember(`  ${e.text}`);
    case "pact_signed":
    case "pact_broken":
    case "pact_fulfilled":
    case "expose":
    case "broadcast":
    case "pawn":
    case "trade":
    case "venue_dark":
    case "rule_added":
    case "jack_found":
    case "vote_execute":
    case "joker_round":
    case "joker_cull":
    case "joker_duel":
    case "solo_king":
    case "night_end":
      return e.text ? `  ${e.type === "pact_broken" ? c.red(e.text) : e.text}` : null;
    case "beauty_round":
    case "collar_declare":
    case "dinner_round":
    case "lifeboat_round":
    case "corridor_round":
    case "elevator_answer":
    case "passphrase_leak":
    case "hound_decoy":
    case "joker_duel_round":
      return e.text ? c.dim(`  · ${e.text}`) : null;
    case "hound_round":
      return e.text ? c.dim(`  · ${e.text}`) : null;
    case "trial_message":
      return c.dim(`  “${e.text}”`);
    default:
      return null;
  }
}
