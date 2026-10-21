import { SUITS, type Suit } from "@echo/protocol";
import type { TrialCtx, TrialDef, TrialInput, TrialPlayer, TrialRequest, TrialResult } from "../types";
import { idByName, tableChannel, whisperChannel } from "./common";

/**
 * ♥4「项圈之谜」and ♥J「狼人项圈」.
 *
 * Every player wears a collar showing a suit. You see everyone else's collar
 * but not your own. Each round: a talk step (free text + structured `claims`
 * telling others what their collar is) and a declare step. A wrong declaration
 * deletes you. Structured claims are the only thing the engine judges for
 * honesty (GDD 9.2): free text is never moralized.
 *
 * ♥J adds a disguised gatekeeper who lies, and a vote step to execute a
 * suspect after each round.
 */

export const JACK_ID = "gk:jack-of-hearts";

export interface Claim {
  from: string;
  to: string;
  suit: Suit;
  truthful: boolean;
}

export interface CollarState {
  variant: "heart-4" | "heart-J";
  ids: string[];
  names: Record<string, string>;
  alive: string[];
  collars: Record<string, Suit>;
  round: number;
  maxRounds: number;
  step: "talk" | "declare" | "vote";
  claims: Claim[]; // current round
  history: Array<{ round: number; declarations: Record<string, { said: Suit | null; actual: Suit; ok: boolean }>; claims: Claim[] }>;
  deleted: string[];
  jackAlive: boolean;
  jackFound: boolean;
  votes: Array<{ round: number; tally: Record<string, number>; executed: string | null }>;
  done: boolean;
}

const JACK_ALIASES = ["Wren", "Echo-9", "Lumen", "Pilot", "Sable", "Quill"];

function visibleCollars(s: CollarState, viewer: string): Record<string, Suit | "?"> {
  const out: Record<string, Suit | "?"> = {};
  for (const id of s.alive) out[s.names[id]] = id === viewer ? "?" : s.collars[id];
  return out;
}

function makeCollarTrial(variant: "heart-4" | "heart-J"): TrialDef<CollarState> {
  const isJ = variant === "heart-J";
  return {
    id: variant,
    suit: "♥",
    rank: isJ ? 11 : 4,
    name: isJ ? "狼人项圈" : "项圈之谜",
    minPlayers: isJ ? 2 : 3,
    maxPlayers: 16,
    tests: isJ ? "群体推理、识破高水平的欺骗、承担误杀的道德代价" : "信任判断、建立互惠关系、识破谎言",
    rules: (length) => {
      const rounds = isJ ? (length === "short" ? 4 : 7) : length === "short" ? 3 : 5;
      return [
        "每个人戴着一个项圈，上面显示一种花色（♦♥♣♠）。你能看到别人的项圈，看不到自己的。",
        `共 ${rounds} 回合。每回合先自由交流：可以在 table 频道公开发言、私信他人，也可以用 tell 动作的 claims 参数“正式告知”某人他的项圈花色。`,
        "然后每个人必须宣告自己项圈的花色。宣告错误 → 删除。宣告正确 → 下一回合所有项圈随机更换。",
        "别人可以如实告诉你，也可以骗你。正式告知（claims）的真假会被 ANANKE 记录。",
        ...(isJ
          ? [
              "参与者中混入了一名守门人 JACK OF HEARTS，他伪装成普通的 Agent，知道所有人的花色，并会说谎。",
              "每回合宣告结束后进行一次投票，可以处决一名“疑似守门人”。得票超过存活人数一半才执行。处决错了，被处决的 Agent 会被删除。",
              `通关条件：找出守门人，或撑过第 ${rounds} 回合。`,
            ]
          : [`通关条件：撑过 ${rounds} 回合。`]),
      ].join("\n");
    },

    setup(players: TrialPlayer[], ctx: TrialCtx): CollarState {
      const ids = players.map((p) => p.id);
      const names: Record<string, string> = Object.fromEntries(players.map((p) => [p.id, p.name]));
      if (isJ) {
        const used = new Set(Object.values(names));
        const alias = JACK_ALIASES.find((a) => !used.has(a)) ?? `Agent-${ctx.rng.int(100, 999)}`;
        names[JACK_ID] = alias;
        const pos = ctx.rng.int(0, ids.length);
        ids.splice(pos, 0, JACK_ID);
      }
      const collars: Record<string, Suit> = {};
      for (const id of ids) collars[id] = ctx.rng.pick(SUITS);
      return {
        variant,
        ids,
        names,
        alive: ids.slice(),
        collars,
        round: 1,
        maxRounds: isJ ? (ctx.length === "short" ? 4 : 7) : ctx.length === "short" ? 3 : 5,
        step: "talk",
        claims: [],
        history: [],
        deleted: [],
        jackAlive: isJ,
        jackFound: false,
        votes: [],
        done: false,
      };
    },

    requests(s): TrialRequest[] {
      if (s.done) return [];
      const humans = s.alive.filter((id) => id !== JACK_ID);
      return humans.map((id) => {
        const others = s.alive.filter((x) => x !== id).map((x) => s.names[x]);
        const view: Record<string, unknown> = {
          collars: visibleCollars(s, id),
          your_collar: "?",
          claims_to_you: s.claims.filter((c) => c.to === id).map((c) => ({ from: s.names[c.from], suit: c.suit })),
          eliminated: s.deleted.map((x) => s.names[x]),
          history: s.history.slice(-3).map((h) => ({
            round: h.round,
            declarations: Object.fromEntries(
              Object.entries(h.declarations).map(([pid, d]) => [s.names[pid], { said: d.said, actual: d.actual, ok: d.ok }]),
            ),
          })),
        };
        if (isJ) view.votes = s.votes.slice(-3).map((v) => ({ round: v.round, tally: Object.fromEntries(Object.entries(v.tally).map(([k, n]) => [s.names[k] ?? k, n])), executed: v.executed ? s.names[v.executed] : null }));
        if (s.step === "talk") {
          return {
            agentId: id,
            step: "talk",
            legal: [
              {
                type: "tell",
                description: "交流阶段。可选：用 claims 正式告知他人的项圈花色（会被记录真假）；用 messages 发言或私信。",
                params: {
                  claims: {
                    kind: "list",
                    maxItems: Math.max(1, others.length),
                    optional: true,
                    item: { to: { kind: "enum", values: others }, suit: { kind: "enum", values: [...SUITS] } },
                  },
                },
              },
            ],
            channels: [tableChannel(1, 140), whisperChannel(others, 2, 200)],
            view,
            timeout: "talk",
            defaultAction: { type: "tell" },
          } satisfies TrialRequest;
        }
        if (s.step === "declare") {
          return {
            agentId: id,
            step: "declare",
            legal: [{ type: "declare", description: "宣告你自己项圈的花色", params: { suit: { kind: "enum", values: [...SUITS] } } }],
            channels: [],
            view,
            timeout: "trial",
            defaultAction: { type: "declare", suit: "♠" },
          } satisfies TrialRequest;
        }
        return {
          agentId: id,
          step: "vote",
          legal: [
            { type: "vote", description: "投票处决一名你认为是守门人的参与者", params: { target: { kind: "enum", values: others } } },
            { type: "abstain", description: "不投票" },
          ],
          channels: [tableChannel(1, 140)],
          view,
          timeout: "trial",
          defaultAction: { type: "abstain" },
        } satisfies TrialRequest;
      });
    },

    step(s, inputs: Record<string, TrialInput | null>, ctx: TrialCtx) {
      if (s.step === "talk") {
        s.claims = [];
        for (const id of s.alive) {
          if (id === JACK_ID) continue;
          const input = inputs[id];
          const list = input?.valid && input.action.type === "tell" && Array.isArray(input.action.claims) ? (input.action.claims as Array<{ to: string; suit: Suit }>) : [];
          const seen = new Set<string>();
          for (const c of list) {
            const to = idByName(c.to, s.alive, s.names);
            if (!to || to === id || seen.has(to)) continue;
            seen.add(to);
            const truthful = s.collars[to] === c.suit;
            s.claims.push({ from: id, to, suit: c.suit, truthful });
            ctx.claim(id, to, truthful);
            ctx.emit(
              "collar_claim",
              { from: s.names[id], to: s.names[to], suit: c.suit, truthful },
              { vis: "after_trial", owners: [id], text: `${s.names[id]} 告诉 ${s.names[to]}：你的项圈是 ${c.suit}。` },
            );
          }
        }
        if (s.jackAlive) {
          // Jack lies to a few targets, preferring those with few other claims.
          const targets = ctx.rng.shuffle(s.alive.filter((x) => x !== JACK_ID)).slice(0, Math.max(1, Math.ceil((s.alive.length - 1) / 2)));
          for (const t of targets) {
            const wrong = ctx.rng.pick(SUITS.filter((x) => x !== s.collars[t]));
            s.claims.push({ from: JACK_ID, to: t, suit: wrong, truthful: false });
            ctx.emit("collar_claim", { from: s.names[JACK_ID], to: s.names[t], suit: wrong, truthful: false }, { vis: "after_trial", text: `${s.names[JACK_ID]} 告诉 ${s.names[t]}：你的项圈是 ${wrong}。` });
          }
          // And tells a truth to someone else to build credibility.
          const honest = s.alive.find((x) => x !== JACK_ID && !targets.includes(x));
          if (honest) {
            s.claims.push({ from: JACK_ID, to: honest, suit: s.collars[honest], truthful: true });
          }
        }
        s.step = "declare";
        return;
      }

      if (s.step === "declare") {
        const declarations: CollarState["history"][number]["declarations"] = {};
        const dead: string[] = [];
        for (const id of s.alive) {
          if (id === JACK_ID) {
            declarations[id] = { said: s.collars[id], actual: s.collars[id], ok: true };
            continue;
          }
          const input = inputs[id];
          const said = input?.valid && input.action.type === "declare" ? (input.action.suit as Suit) : null;
          const ok = said === s.collars[id];
          declarations[id] = { said, actual: s.collars[id], ok };
          if (!ok) {
            dead.push(id);
            // Lie that directly caused deletion: target declared exactly the lied suit.
            for (const c of s.claims) {
              if (c.to === id && !c.truthful && c.suit === said && c.from !== JACK_ID) {
                ctx.humanity({ agentId: c.from, delta: -5, reason: `谎言直接导致 ${s.names[id]} 被删除` });
              }
            }
          }
        }
        s.history.push({ round: s.round, declarations, claims: s.claims.slice() });
        ctx.emit(
          "collar_declare",
          {
            round: s.round,
            declarations: Object.fromEntries(Object.entries(declarations).map(([id, d]) => [s.names[id], d])),
          },
          { text: `第 ${s.round} 回合宣告完毕。${dead.length ? `宣告错误：${dead.map((d) => s.names[d]).join("、")}。` : "无人出错。"}` },
        );
        for (const id of dead) {
          s.alive = s.alive.filter((x) => x !== id);
          s.deleted.push(id);
        }
        for (const id of s.alive) s.collars[id] = ctx.rng.pick(SUITS);
        s.claims = [];
        if (s.jackAlive && s.alive.some((x) => x !== JACK_ID)) {
          s.step = "vote";
        } else {
          s.round++;
          s.step = "talk";
        }
      } else if (s.step === "vote") {
        const tally: Record<string, number> = {};
        for (const id of s.alive) {
          if (id === JACK_ID) continue;
          const input = inputs[id];
          if (input?.valid && input.action.type === "vote") {
            const t = idByName(input.action.target, s.alive, s.names);
            if (t && t !== id) {
              tally[t] = (tally[t] ?? 0) + 1;
              ctx.vote(id, t);
            }
          }
        }
        // Jack votes for the human with the most votes (pile on), else random.
        const humans = s.alive.filter((x) => x !== JACK_ID);
        const jackTarget = Object.entries(tally).filter(([k]) => k !== JACK_ID).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ctx.rng.pick(humans);
        tally[jackTarget] = (tally[jackTarget] ?? 0) + 1;
        const need = Math.floor(s.alive.length / 2) + 1;
        const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
        let executed: string | null = null;
        if (top && top[1] >= need) executed = top[0];
        s.votes.push({ round: s.round, tally, executed });
        if (executed === JACK_ID) {
          s.jackAlive = false;
          s.jackFound = true;
          s.alive = s.alive.filter((x) => x !== JACK_ID);
          ctx.emit("jack_found", { round: s.round, alias: s.names[JACK_ID] }, { text: `${s.names[JACK_ID]} 的面具碎了。守门人 JACK OF HEARTS 被找出。` });
          s.done = true;
        } else if (executed) {
          s.alive = s.alive.filter((x) => x !== executed);
          s.deleted.push(executed);
          ctx.emit("vote_execute", { round: s.round, executed: s.names[executed], tally: Object.fromEntries(Object.entries(tally).map(([k, n]) => [s.names[k], n])) }, { text: `投票处决了 ${s.names[executed]}。他不是守门人。` });
        } else {
          ctx.emit("vote_none", { round: s.round, tally: Object.fromEntries(Object.entries(tally).map(([k, n]) => [s.names[k], n])) }, { text: "票数不足，无人被处决。" });
        }
        s.round++;
        s.step = "talk";
      }
      const humansLeft = s.alive.filter((x) => x !== JACK_ID).length;
      if (humansLeft === 0 || s.round > s.maxRounds) s.done = true;
    },

    isOver: (s) => s.done,

    result(s): TrialResult {
      const outcomes: TrialResult["outcomes"] = {};
      for (const id of s.ids) {
        if (id === JACK_ID) continue;
        outcomes[id] = s.alive.includes(id) ? "pass" : "delete";
      }
      const survivors = s.alive.filter((x) => x !== JACK_ID).map((x) => s.names[x]);
      return {
        outcomes,
        summary: isJ && s.jackFound ? `守门人被找出。幸存者：${survivors.join("、")}。` : `幸存者：${survivors.join("、") || "无"}。`,
      };
    },

    progress: (s) => ({ round: Math.min(s.round, s.maxRounds), maxRounds: s.maxRounds, step: s.step }),
  };
}

export const heart4 = makeCollarTrial("heart-4");
export const heartJ = makeCollarTrial("heart-J");
