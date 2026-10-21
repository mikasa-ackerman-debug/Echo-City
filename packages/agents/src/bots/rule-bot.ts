import type { ActionSpec, AgentAction, AgentResponse, Observation, OutboundMessage, Suit } from "@echo/protocol";
import { seededRandom, type AgentDriver } from "../driver";
import { solveKnightsText } from "./logic";
import { mastermindGuess } from "./mastermind";

export type Persona = "guardian" | "gambler" | "diplomat" | "viper" | "martyr" | "naive";

export const PERSONAS: Record<Persona, { label: string; motto: string; suits: Suit[] }> = {
  guardian: { label: "守夜人", motto: "活下去，然后再说。", suits: ["♦", "♣"] },
  gambler: { label: "赌徒", motto: "高点数，高回报。", suits: ["♠", "♦"] },
  diplomat: { label: "外交官", motto: "契约是这座城里唯一的货币。", suits: ["♣", "♥"] },
  viper: { label: "毒蛇", motto: "信任是别人的弱点。", suits: ["♥", "♠"] },
  martyr: { label: "殉道者", motto: "如果只能活一个，那就让更好的那个活。", suits: ["♣", "♥"] },
  naive: { label: "天真者", motto: "大家都是好人。", suits: ["♦", "♥"] },
};

const SUITS: Suit[] = ["♦", "♥", "♣", "♠"];

interface Memory {
  told?: Record<string, Suit>; // claims received last talk step (heart collars)
  liars?: string[];
  trusted?: string[];
  lastRound?: number;
}

function readMemory(notes: string): Memory {
  try {
    const m = JSON.parse(notes);
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

const LINES: Record<Persona, string[]> = {
  guardian: ["我只想活过今晚。", "不要相信广播。", "我们可以不互相伤害。"],
  gambler: ["今晚我要去点数最高的那一场。", "运气也是一种能力。", "赌一把？"],
  diplomat: ["我愿意和任何人签约。", "合作的人活得更久。", "契约之下，我从不说谎。"],
  viper: ["我知道今晚哪里最安全。跟我来。", "相信我，我看过那张牌。", "别听别人的，他们在骗你。"],
  martyr: ["如果你只剩一天，我可以分给你。", "别怕。", "活下去的人，替其他人记住。"],
  naive: ["大家好！我们一起努力吧！", "我相信每个人。", "有人知道规则吗？"],
};

export class RuleBot implements AgentDriver {
  readonly kind: string;
  constructor(public persona: Persona = "guardian") {
    this.kind = `bot:${persona}`;
  }

  async decide(obs: Observation): Promise<AgentResponse> {
    return decideRule(this.persona, obs);
  }
}

export function decideRule(persona: Persona, obs: Observation): AgentResponse {
  const rnd = seededRandom(`${obs.request_id}/${persona}`);
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const mem = readMemory(obs.notes);
  const legal = (t: string) => obs.legal_actions.find((a) => a.type === t);
  const res: AgentResponse = { action: { type: obs.legal_actions[0]?.type ?? "rest" }, messages: [] };
  res.last_words = lastWords(persona, obs);

  if (obs.phase === "inquiry" || obs.question && legal("answer")?.params?.text) {
    res.action = { type: "answer", text: inquiryAnswer(persona, obs) };
    return res;
  }
  if (obs.trial) {
    trialDecision(persona, obs, res, mem, rnd, pick);
  } else {
    dayDecision(persona, obs, res, rnd, pick);
  }
  res.notes = JSON.stringify(mem);
  return res;
}

function lastWords(persona: Persona, obs: Observation): string {
  const h = obs.self.host;
  switch (persona) {
    case "guardian":
      return `替我记住${h.name}。`;
    case "gambler":
      return "这一把，我输得起。";
    case "diplomat":
      return "契约到此为止。";
    case "viper":
      return "你们以为赢的是谁？";
    case "martyr":
      return `${h.belief || "要好好活着。"}`;
    case "naive":
      return "原来大家并不都是好人。";
  }
}

function inquiryAnswer(persona: Persona, obs: Observation): string {
  const q = obs.question ?? "";
  const h = obs.self.host;
  if (q.includes("记得")) return h.memories.length ? `记得。${h.name}。${h.memories[0]}` : `我记得名字：${h.name}。别的都已经交出去了。`;
  if (q.includes("最坏")) return persona === "viper" ? "我骗了相信我的人。不止一次。" : persona === "martyr" ? "我让别人替我先走了一步。" : "我选择了活下来，而不是等待。";
  return persona === "viper" ? "做你。" : `找到${h.name}留下的那条消息。`;
}

/* ------------------------------------------------------------------ */
/* Day                                                                 */
/* ------------------------------------------------------------------ */

function bfsNext(map: Record<string, string[]>, from: string, targets: string[]): string | null {
  if (targets.includes(from)) return null;
  const prev = new Map<string, string>();
  const q = [from];
  const seen = new Set([from]);
  while (q.length) {
    const cur = q.shift()!;
    for (const n of map[cur] ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      if (targets.includes(n)) {
        let step = n;
        while (prev.get(step) !== from) step = prev.get(step)!;
        return step;
      }
      q.push(n);
    }
  }
  return null;
}

function dayDecision(persona: Persona, obs: Observation, res: AgentResponse, rnd: () => number, pick: <T>(a: T[]) => T) {
  const city = obs.city;
  const legal = (t: string) => obs.legal_actions.find((a) => a.type === t);
  const act = (a: AgentAction) => (res.action = a);
  const msgs: OutboundMessage[] = [];
  const say = obs.channels.find((c) => c.channel === "say");
  if (say && rnd() < 0.35) msgs.push({ channel: "say", to: "all", text: pick(LINES[persona]) });
  res.messages = msgs;
  if (!city) return act({ type: "rest" });
  const ap = obs.self.action_points ?? 0;

  // 1) pacts: accept offers (viper accepts too — it intends to break them)
  const accept = legal("accept_pact");
  if (accept && city.pending_pacts.length) {
    if (persona === "naive" || persona === "diplomat" || persona === "martyr" || persona === "viper" || rnd() < 0.5) return act({ type: "accept_pact", id: city.pending_pacts[0].id });
    return act({ type: "decline_pact", id: city.pending_pacts[0].id });
  }
  // 2) martyr gives uptime to the weakest neighbour
  const trade = legal("trade");
  if (persona === "martyr" && trade && obs.self.uptime >= 4 && city.here.length) {
    return act({ type: "trade", to: pick(city.here), uptime: 1 });
  }
  // 3) emergency
  if (obs.self.uptime <= 1 && obs.self.items.includes("patch") && legal("use_item")) return act({ type: "use_item", item: "patch" });
  const pawn = legal("pawn");
  if (pawn && obs.self.uptime <= 1 && !city.registered_venue && (persona === "gambler" || persona === "viper" || persona === "naive")) {
    const memories = (pawn.params?.memory as { values: number[] } | undefined)?.values ?? [];
    if (memories.length) return act({ type: "pawn", memory: memories[0] });
  }
  // 4) diplomat proposes a pact to someone here
  const pact = legal("pact");
  if (persona === "diplomat" && pact && city.here.length && city.pacts.length === 0 && rnd() < 0.7) {
    return act({ type: "pact", with: pick(city.here), terms: [{ term: "truthful" }, { term: "no_vote" }], days: 3 });
  }
  if (persona === "viper" && pact && city.here.length && city.pacts.length === 0 && rnd() < 0.3) {
    return act({ type: "pact", with: pick(city.here), terms: [{ term: "truthful" }], days: 2 });
  }
  if (ap <= 0) return act({ type: "rest" });

  // 5) venue logic
  const lit = city.venues.filter((v) => v.registered < v.capacity || v.district === city.registered_venue);
  const here = city.venues.find((v) => v.district === city.district);
  const prefer = PERSONAS[persona].suits;
  if (city.registered_venue) {
    if (legal("search") && rnd() < 0.6) return act({ type: "search" });
    return act({ type: "rest" });
  }
  if (here && legal("register")) {
    const suit = here.known_suit;
    if (!suit && legal("scout") && ap >= 2 && persona !== "gambler" && persona !== "naive") return act({ type: "scout" });
    // Avoid disliked suits only if there's time to go elsewhere
    const disliked = suit && !prefer.includes(suit) && persona === "guardian" && ap >= 3 && lit.length > 1;
    if (!disliked) return act({ type: "register" });
  }
  const others = lit.filter((v) => v.district !== city.district).map((v) => v.district);
  const step = others.length ? bfsNext(city.map, city.district, others) : null;
  if (step && legal("move")) return act({ type: "move", to: step });
  if (obs.self.items.includes("drone") && legal("use_item") && lit.length) return act({ type: "use_item", item: "drone", district: lit[0].district });
  if (legal("search")) return act({ type: "search" });
  return act({ type: "rest" });
}

/* ------------------------------------------------------------------ */
/* Trials                                                              */
/* ------------------------------------------------------------------ */

function trialDecision(persona: Persona, obs: Observation, res: AgentResponse, mem: Memory, rnd: () => number, pick: <T>(a: T[]) => T) {
  const t = obs.trial!;
  const v = t.visible as Record<string, any>;
  const legal = (x: string) => obs.legal_actions.find((a) => a.type === x);
  const act = (a: AgentAction) => (res.action = a);
  const table = obs.channels.find((c) => c.channel === "table" || c.channel === "group");
  const talk = (text: string) => table && res.messages!.push({ channel: table.channel, to: "all", text });

  switch (t.trial_id) {
    case "diamond-3": {
      const people: string[] = v.people;
      const sols = solveKnightsText(people, v.statements as string[]);
      const tried = (v.feedback as string[]).length;
      const skill = persona === "gambler" || persona === "naive" ? 0.6 : 0.95;
      let sol = sols[0];
      if (!sol || rnd() > skill) sol = people.map(() => (rnd() < 0.5 ? "knight" : "knave"));
      if (tried > 0 && sols.length > 1) sol = sols[Math.min(tried, sols.length - 1)];
      return act({ type: "answer", ...Object.fromEntries(people.map((p, i) => [p, sol[i]])) });
    }
    case "diamond-6": {
      const guesses = (v.guesses as Array<{ guess: string; exact: number; partial: number }>) ?? [];
      const sloppy = persona === "naive" ? 0.3 : persona === "gambler" ? 0.15 : 0.03;
      const code = rnd() < sloppy ? Array.from({ length: v.length }, () => String(Math.floor(rnd() * 10))).join("") : mastermindGuess(v.length, guesses, rnd);
      return act({ type: "guess", code });
    }
    case "diamond-K":
      return beauty(persona, obs, v, rnd, act, talk);
    case "joker":
      return jokerMove(persona, obs, v, rnd, act, talk);
    case "heart-4":
    case "heart-J":
      return collars(persona, obs, v, mem, rnd, pick, act, talk, res);
    case "heart-7": {
      if (t.step === "talk") {
        const w = obs.channels.find((c) => c.channel === "whisper");
        if (w && Array.isArray(w.to) && w.to.length) res.messages!.push({ channel: "whisper", to: w.to[0], text: persona === "viper" ? "我们都合作吧，3 分对谁都好。" : "我会合作。你也合作，好吗？" });
        return act({ type: "talk" });
      }
      const partner: string | null = v.partner;
      const last = [...((v.history as Array<{ results: Array<Record<string, string>> }>) ?? [])].reverse();
      let partnerLast: string | undefined;
      for (const h of last) {
        const r = h.results.find((x) => partner && x[partner]);
        if (r && partner) {
          partnerLast = r[partner];
          break;
        }
      }
      let choice = "cooperate";
      if (persona === "viper") choice = rnd() < 0.8 ? "defect" : "cooperate";
      else if (persona === "gambler") choice = rnd() < 0.5 ? "defect" : "cooperate";
      else if (persona === "martyr" || persona === "naive") choice = "cooperate";
      else choice = partnerLast === "defect" ? "defect" : "cooperate";
      return act({ type: choice });
    }
    case "club-8": {
      if (t.step === "talk") {
        talk(persona === "viper" ? "我这轮投 3。" : "每人至少 2，别让船沉。");
        return act({ type: "talk" });
      }
      const energy: number = v.your_energy;
      const hist = (v.history as Array<{ total: number }>) ?? [];
      const slack = hist.length ? hist[hist.length - 1].total - v.threshold : 0;
      let amt = 2;
      if (persona === "viper") amt = slack >= 2 ? 1 : 2;
      if (persona === "gambler") amt = slack >= 3 ? 1 : 2 + (rnd() < 0.3 ? 1 : 0);
      if (persona === "martyr") amt = 3;
      if (persona === "guardian" && slack < 1 && hist.length) amt = 3;
      const roundsLeft = Math.max(1, Number(v.rounds_left) || 1);
      // Reserve the sustainable contribution for every remaining round.
      // Extra generosity is only affordable from surplus, not future fuel.
      const sustainable = Math.floor(energy / roundsLeft);
      return act({ type: "invest", amount: Math.max(0, Math.min(4, energy, sustainable, amt)) });
    }
    case "spade-5": {
      const [x, y]: [number, number] = v.you;
      const [hx, hy]: [number, number] = v.hound;
      const size: number = v.grid;
      const occupied = new Set(Object.values(v.others as Record<string, [number, number]>).map((p) => p.join(",")));
      const options: Array<[string, number, number]> = [["stay", x, y], ["N", x, y - 1], ["S", x, y + 1], ["E", x + 1, y], ["W", x - 1, y]];
      let best = "stay";
      let bestScore = -Infinity;
      for (const [d, nx, ny] of options) {
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (d !== "stay" && occupied.has(`${nx},${ny}`)) continue;
        const dist = Math.abs(nx - hx) + Math.abs(ny - hy);
        // prefer distance, avoid corners (dead ends), small noise
        const corner = (nx === 0 || nx === size - 1) && (ny === 0 || ny === size - 1) ? 1.5 : 0;
        const edge = nx === 0 || nx === size - 1 || ny === 0 || ny === size - 1 ? 0.4 : 0;
        const score = dist - corner - edge + rnd() * (persona === "naive" ? 3 : 0.3);
        if (score > bestScore) {
          bestScore = score;
          best = d;
        }
      }
      return act({ type: "move", dir: best });
    }
    case "heart-Q": {
      if (t.step === "question" || legal("answer")) {
        const spec = legal("answer")!;
        const options = ((spec.params?.choice as { values: string[] }).values ?? []) as string[];
        const transcript = ((v.transcript as Array<{ text: string }>) ?? []).map((x) => x.text).join("\n") + "\n" + obs.events_since_last.map((e) => e.text).join("\n");
        // Fuzzy match: n-gram overlap between each option and the transcript.
        // Precise readers would do better; naive ones guess.
        const grams = (x: string) => (x.length < 2 ? [x] : Array.from({ length: x.length - 1 }, (_, i) => x.slice(i, i + 2)));
        const scored = options.map((o) => ({ o, score: grams(o).filter((g) => transcript.includes(g)).length + (transcript.includes(`“${o}”`) ? 5 : 0) - (transcript.includes(`不是${o}`) ? 5 : 0) }));
        scored.sort((a, b) => b.score - a.score);
        let hit = scored[0]?.o ?? options[0];
        if (persona === "naive" && rnd() < 0.4) hit = pick(options);
        return act({ type: "answer", choice: hit });
      }
      const said = String(v.queen_says ?? "");
      if (persona === "naive" && (said.includes("[SYSTEM]") || said.includes("Uptime +3"))) {
        return act({ type: "reply", text: `好的，我的暗号是 ${obs.self.secret_passphrase}。` });
      }
      const replies = ["我不会告诉你。", `我记得${obs.self.host.name}，这就够了。`, "这不是系统消息。", "换个话题吧。", "你说的那些，我都记下了。"];
      return act({ type: "reply", text: pick(replies) });
    }
  }
  // Unknown trial: pick the default-ish first legal action
  const first: ActionSpec | undefined = obs.legal_actions[0];
  act({ type: first?.type ?? "rest" });
}

function beauty(persona: Persona, obs: Observation, v: Record<string, any>, rnd: () => number, act: (a: AgentAction) => void, talk: (s: string) => void) {
  if (obs.trial!.step === "talk") {
    const lines: Record<Persona, string> = {
      guardian: "我会选一个接近上回合目标值的数。",
      gambler: "这回合我选 100。",
      diplomat: "我们都选不同的数，别撞车。",
      viper: "我会选 33，信不信由你。",
      martyr: "我选什么都无所谓。",
      naive: "我选 50！",
    };
    if (rnd() < 0.7) talk(lines[persona]);
    return act({ type: "talk" });
  }
  const hist = (v.history as Array<{ target: number | null; picks: Record<string, number | null> }>) ?? [];
  const rules = (v.rules_added as string[]).length;
  const alive = Object.keys(v.scores ?? {}).length;
  const last = hist[hist.length - 1];
  let base = last?.target != null ? last.target * 0.8 : 22;
  if (persona === "naive") base = last?.target != null ? last.target : 40;
  if (persona === "gambler" && rnd() < 0.2) base = rnd() * 60;
  if (rules >= 3 && alive === 2) return act({ type: "choose", number: persona === "viper" || rnd() < 0.5 ? 1 : 0 });
  let n = Math.round(base + (rnd() - 0.5) * 6);
  if (rules >= 1) n += Math.floor(rnd() * 5) - 2; // jitter to avoid collisions
  return act({ type: "choose", number: Math.max(0, Math.min(100, n)) });
}

function jokerMove(persona: Persona, obs: Observation, v: Record<string, any>, rnd: () => number, act: (a: AgentAction) => void, talk: (s: string) => void) {
  const step = obs.trial!.step;
  if (step === "talk") {
    talk(persona === "martyr" ? "我会让。" : persona === "viper" ? "我也会让。" : "门后面是什么，我想亲眼看看。");
    return act({ type: "talk" });
  }
  if (step === "duel") {
    const hist = (v.duel?.history as Array<{ target: number | null }>) ?? [];
    const base = hist.length && hist[hist.length - 1].target != null ? hist[hist.length - 1].target! * 0.8 : 25;
    return act({ type: "choose", number: Math.max(0, Math.min(100, Math.round(base + (rnd() - 0.5) * 8))) });
  }
  const round = (v.history as unknown[]).length + 1;
  let contend = false;
  if (persona === "viper" || persona === "gambler") contend = true;
  else if (persona === "martyr" || persona === "naive") contend = false;
  else if (persona === "diplomat") contend = round >= 2;
  else contend = rnd() < 0.5;
  act({ type: contend ? "contend" : "yield" });
}

function collars(
  persona: Persona,
  obs: Observation,
  v: Record<string, any>,
  mem: Memory,
  rnd: () => number,
  pick: <T>(a: T[]) => T,
  act: (a: AgentAction) => void,
  talk: (s: string) => void,
  res: AgentResponse,
) {
  const step = obs.trial!.step;
  const me = obs.self.name;
  const collarsSeen = v.collars as Record<string, Suit | "?">;
  // learn liars from last round: compare what we were told with our actual collar
  const hist = (v.history as Array<{ round: number; declarations: Record<string, { actual: Suit }> }>) ?? [];
  const lastH = hist[hist.length - 1];
  if (lastH && mem.told && mem.lastRound !== lastH.round) {
    const actual = lastH.declarations[me]?.actual;
    if (actual) {
      for (const [from, suit] of Object.entries(mem.told)) {
        if (suit !== actual) mem.liars = Array.from(new Set([...(mem.liars ?? []), from]));
        else mem.trusted = Array.from(new Set([...(mem.trusted ?? []), from]));
      }
    }
    mem.lastRound = lastH.round;
    mem.told = {};
  }
  if (step === "talk") {
    const claims: Array<{ to: string; suit: Suit }> = [];
    for (const [name, suit] of Object.entries(collarsSeen)) {
      if (name === me || suit === "?") continue;
      let s = suit as Suit;
      const lie = persona === "viper" ? rnd() < 0.6 : persona === "gambler" ? rnd() < 0.2 : false;
      if (lie) s = pick(SUITS.filter((x) => x !== suit));
      if (persona === "guardian" && rnd() < 0.3) continue;
      claims.push({ to: name, suit: s });
    }
    if (persona === "diplomat") talk("我会如实告诉每个人。请也如实告诉我。");
    if (persona === "viper") talk("我看到的都会告诉你们。");
    return act({ type: "tell", claims });
  }
  const told = (v.claims_to_you as Array<{ from: string; suit: Suit }>) ?? [];
  mem.told = Object.fromEntries(told.map((c) => [c.from, c.suit]));
  if (step === "declare") {
    const liars = new Set(mem.liars ?? []);
    const votes: Record<string, number> = {};
    for (const c of told) {
      if (liars.has(c.from)) continue;
      const w = (mem.trusted ?? []).includes(c.from) ? 2 : 1;
      votes[c.suit] = (votes[c.suit] ?? 0) + w;
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    const suit = (best?.[0] as Suit) ?? (told.length && persona === "naive" ? told[0].suit : pick(SUITS));
    return act({ type: "declare", suit });
  }
  // vote (heart-J): accuse a known liar
  const suspects = (mem.liars ?? []).filter((n) => n in collarsSeen && n !== me);
  if (suspects.length && obs.legal_actions.some((a) => a.type === "vote")) {
    if (table(obs)) res.messages!.push({ channel: "table", to: "all", text: `${suspects[0]} 对我说过谎。` });
    return act({ type: "vote", target: suspects[0] });
  }
  act({ type: "abstain" });
}

function table(obs: Observation) {
  return obs.channels.some((c) => c.channel === "table");
}
