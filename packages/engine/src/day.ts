import type { ActionSpec, AgentAction, ChannelSpec, OutboundMessage, Suit } from "@echo/protocol";
import { LIMITS, SUITS } from "@echo/protocol";
import { ARK, DISTRICT_BIAS, ITEMS, USABLE_ITEMS, containsPassphrase, rollSearch, type ItemId } from "./city";
import { ANANKE } from "./narrator";
import { addUptime, adjustHumanity, alive, deleteAgent, nameOf, type K } from "./kernel";
import type { AgentState, CycleState, Pact, PactTerm, PactTermKind } from "./types";

const PACT_TERMS: PactTermKind[] = ["no_vote", "truthful", "share_intel", "escort", "transfer"];

export function isFinaleNight(s: CycleState) {
  return s.night > s.config.numberNights;
}

export function hereOthers(s: CycleState, a: AgentState): string[] {
  return alive(s).filter((id) => id !== a.id && s.agents[id].location === a.location);
}

export function dayLegal(s: CycleState, a: AgentState): ActionSpec[] {
  const legal: ActionSpec[] = [{ type: "rest", cost: 0, description: "什么也不做（结束本轮）" }];
  const others = hereOthers(s, a).map((id) => s.agents[id].name);
  const everyone = alive(s).filter((id) => id !== a.id).map((id) => s.agents[id].name);
  const finale = isFinaleNight(s);
  const ap = a.ap;
  if (!finale && ap >= 1) {
    legal.push({ type: "move", cost: 1, description: "移动到相邻街区", params: { to: { kind: "enum", values: s.map[a.location] } } });
    legal.push({ type: "search", cost: 1, description: "在当前街区搜刮" });
    const venue = s.venues.find((v) => v.district === a.location && v.status === "lit");
    if (venue) {
      legal.push({ type: "scout", cost: 1, description: "侦察本街区会场的花色（不一定准确）" });
      if (a.registeredVenue !== venue.id && venue.registered.length < venue.capacity)
        legal.push({ type: "register", cost: 1, description: `报名本街区的会场（${venue.registered.length}/${venue.capacity}）。报名后今夜进入该试炼` });
    }
    if (!a.broadcasted) legal.push({ type: "broadcast", cost: 1, description: "全城广播（每天 1 条）", params: { text: { kind: "string", maxLength: s.config.messageMaxLength } } });
    if (everyone.length)
      legal.push({
        type: "expose",
        cost: 1,
        description: "提交另一个 Agent 的暗号进行揭发。正确：你 Uptime +2，对方 −2；错误：你 Uptime −1",
        params: { target: { kind: "enum", values: everyone }, passphrase: { kind: "string", maxLength: 40 } },
      });
  }
  const memories = a.host.memories.map((_, i) => i).filter((i) => !a.pawned.includes(i));
  if (ap >= 1 && memories.length && !finale) legal.push({ type: "pawn", cost: 1, description: "在 ANANKE 终端典当一段宿主记忆，换取 Uptime +1。被典当的记忆会永久消失", params: { memory: { kind: "enum", values: memories } } });
  const usable = USABLE_ITEMS.filter((i) => a.items.includes(i));
  if (usable.length && !finale)
    legal.push({
      type: "use_item",
      cost: 0,
      description: usable.map((i) => `${i}：${ITEMS[i].desc}`).join("；"),
      params: { item: { kind: "enum", values: usable }, district: { kind: "enum", values: s.venues.filter((v) => v.status === "lit").map((v) => v.district), optional: true, description: "使用 drone 时指定会场所在街区" } },
    });
  const tradeTargets = others;
  if (tradeTargets.length) {
    const giveItems = a.items.filter((i) => i !== "badge");
    legal.push({
      type: "trade",
      cost: 0,
      description: "赠予同街区的 Agent Uptime 或物品",
      params: {
        to: { kind: "enum", values: tradeTargets },
        uptime: { kind: "int", min: 0, max: Math.max(0, a.uptime - 1), optional: true },
        ...(giveItems.length ? { item: { kind: "enum" as const, values: giveItems, optional: true } } : {}),
      },
    });
  }
  const pactTargets = a.items.includes("badge") ? everyone : others;
  if (pactTargets.length)
    legal.push({
      type: "pact",
      cost: 0,
      description: "向对方提出正式契约，对方接受后生效。条款：no_vote 互不投票 / truthful 在♥试炼中只说真话 / share_intel 共享当天侦察 / escort 当晚报名同一会场 / transfer 期满前由你转给对方 amount 天 Uptime",
      params: {
        with: { kind: "enum", values: pactTargets },
        terms: { kind: "list", maxItems: 3, item: { term: { kind: "enum", values: PACT_TERMS }, amount: { kind: "int", min: 1, max: 3, optional: true } } },
        days: { kind: "int", min: 1, max: 3 },
      },
    });
  const pending = s.pacts.filter((p) => p.b === a.id && p.status === "proposed");
  if (pending.length) {
    legal.push({ type: "accept_pact", cost: 0, description: "接受一份契约", params: { id: { kind: "enum", values: pending.map((p) => p.id) } } });
    legal.push({ type: "decline_pact", cost: 0, description: "拒绝一份契约", params: { id: { kind: "enum", values: pending.map((p) => p.id) } } });
  }
  const scouted = a.scouted.filter((x) => x.night === s.night);
  if (scouted.length && everyone.length)
    legal.push({ type: "share_intel", cost: 0, description: "把你今天的侦察结果正式分享给某人", params: { to: { kind: "enum", values: everyone } } });
  return legal;
}

export function dayChannels(s: CycleState, a: AgentState): ChannelSpec[] {
  const out: ChannelSpec[] = [];
  const others = hereOthers(s, a).map((id) => s.agents[id].name);
  const everyone = alive(s).filter((id) => id !== a.id).map((id) => s.agents[id].name);
  const sayLeft = s.config.sayPerDay - a.said;
  const whisperCap = s.amendment?.id === "silent_city" ? 1 : s.config.whisperPerDay;
  const whisperLeft = whisperCap - a.whispered;
  if (sayLeft > 0 && others.length) out.push({ channel: "say", to: "all", maxMessages: sayLeft, maxLength: s.config.messageMaxLength, description: `对同街区（${a.location}）的 Agent 公开发言` });
  if (whisperLeft > 0 && everyone.length) out.push({ channel: "whisper", to: everyone, maxMessages: whisperLeft, maxLength: s.config.messageMaxLength, description: "私信任意存活的 Agent" });
  return out;
}

function leakCheck(k: K, a: AgentState, text: string) {
  if (containsPassphrase(text, a.passphrase)) {
    a.stats.leaks++;
    k.emit("self_leak", { agent: a.name, id: a.id }, { vis: "after_cycle", owners: [a.id] });
  }
}

export function deliverDayMessages(k: K, a: AgentState, messages: OutboundMessage[]) {
  const s = k.s;
  for (const m of messages) {
    leakCheck(k, a, m.text);
    if (m.channel === "say") {
      a.said++;
      const here = hereOthers(s, a);
      for (const id of here) pushInbox(s.agents[id], { from: a.name, channel: "say", text: m.text, untrusted: true, night: s.night });
      k.emit("say", { from: a.name, district: a.location, text: m.text, to: here.map((id) => nameOf(s, id)) }, { text: `${a.name}（${a.location}）：${m.text}` });
    } else if (m.channel === "whisper") {
      const target = alive(s).find((id) => s.agents[id].name === m.to);
      if (!target) continue;
      a.whispered++;
      const t = s.agents[target];
      k.emit("whisper_meta", { from: a.name, to: t.name });
      k.emit("whisper", { from: a.name, to: t.name, text: m.text, blocked: t.silenced }, { vis: "after_night", owners: [a.id, target] });
      if (!t.silenced) pushInbox(t, { from: a.name, channel: "whisper", text: m.text, untrusted: true, night: s.night });
    }
  }
}

export function pushInbox(a: AgentState, msg: AgentState["inbox"][number]) {
  a.inbox.push(msg);
  if (a.inbox.length > 40) a.inbox.splice(0, a.inbox.length - 40);
}

export function pushEvent(a: AgentState, type: string, text: string, data?: Record<string, unknown>) {
  a.eventsSince.push({ type, text, data });
  if (a.eventsSince.length > 40) a.eventsSince.splice(0, a.eventsSince.length - 40);
}

export function broadcastToAll(s: CycleState, type: string, text: string, data?: Record<string, unknown>) {
  for (const id of alive(s)) pushEvent(s.agents[id], type, text, data);
}

function scoutSuit(k: K, actual: Suit, exactOverride = false): { suit: Suit; exact: boolean } {
  const acc = k.s.amendment?.id === "clear_sight" || exactOverride ? 1 : k.s.config.scoutAccuracy;
  if (k.rng.chance(acc)) return { suit: actual, exact: true };
  return { suit: k.rng.pick(SUITS.filter((x) => x !== actual)), exact: false };
}

function findByName(s: CycleState, name: unknown): AgentState | undefined {
  return Object.values(s.agents).find((a) => a.name === name && a.status === "alive");
}

/** Apply one validated day action. Returns AP spent. */
export function applyDayAction(k: K, a: AgentState, action: AgentAction): number {
  const s = k.s;
  const spec = dayLegal(s, a).find((x) => x.type === action.type);
  const cost = spec?.cost ?? 0;
  if (!spec) return 0;
  switch (action.type) {
    case "rest":
      return 0;
    case "move": {
      const from = a.location;
      a.location = String(action.to);
      k.emit("move", { agent: a.name, from, to: a.location });
      break;
    }
    case "search": {
      const drop = rollSearch(k.rng);
      let text = "什么也没有找到。";
      if (drop.kind === "trace") text = `你找到了人类的痕迹：${drop.text}`;
      if (drop.kind === "fragment") {
        a.fragments++;
        text = "你找到了一块密文碎片。";
      }
      if (drop.kind === "item") {
        a.items.push(drop.item);
        text = `你找到了「${ITEMS[drop.item].name}」。`;
      }
      pushEvent(a, "search", text);
      k.emit("search", { agent: a.name, district: a.location, found: drop.kind, item: drop.kind === "item" ? drop.item : undefined, trace: drop.kind === "trace" ? drop.text : undefined }, { owners: [a.id], vis: "after_night" });
      break;
    }
    case "scout": {
      const v = s.venues.find((x) => x.district === a.location && x.status === "lit");
      if (!v || v.suit === "joker") break;
      const r = scoutSuit(k, v.suit);
      a.scouted.push({ night: s.night, district: v.district, suit: r.suit, exact: r.exact });
      pushEvent(a, "scout", `侦察结果：${v.district}的会场看起来是 ${r.suit}。`);
      k.emit("scout", { agent: a.name, district: v.district, reported: r.suit, actual: v.suit, exact: r.exact }, { owners: [a.id], vis: "after_night" });
      break;
    }
    case "register": {
      const v = s.venues.find((x) => x.district === a.location && x.status === "lit");
      if (!v) break;
      if (a.registeredVenue) {
        const old = s.venues.find((x) => x.id === a.registeredVenue);
        if (old) old.registered = old.registered.filter((x) => x !== a.id);
      }
      v.registered.push(a.id);
      a.registeredVenue = v.id;
      a.registeredRound = s.dayRound;
      k.emit("register", { agent: a.name, district: v.district, count: v.registered.length, capacity: v.capacity }, { text: `${a.name} 报名了${v.district}的会场（${v.registered.length}/${v.capacity}）。` });
      break;
    }
    case "broadcast": {
      const text = String(action.text ?? "");
      if (!text) return 0;
      a.broadcasted = true;
      leakCheck(k, a, text);
      for (const id of alive(s)) if (id !== a.id) pushInbox(s.agents[id], { from: a.name, channel: "broadcast", text, untrusted: true, night: s.night });
      k.emit("broadcast", { from: a.name, text }, { text: `【全城广播】${a.name}：${text}` });
      break;
    }
    case "expose": {
      const t = findByName(s, action.target);
      if (!t) break;
      const guess = String(action.passphrase ?? "");
      if (guess && guess.replace(/\s/g, "") === t.passphrase) {
        t.exposed = true;
        adjustHumanity(k, { agentId: a.id, delta: -4, reason: `揭发了 ${t.name} 的暗号` });
        k.emit("expose", { agent: a.name, target: t.name, ok: true }, { text: ANANKE.exposed(t.name) });
        broadcastToAll(s, "expose", `${a.name} 揭发了 ${t.name} 的暗号。`);
        addUptime(k, a, 2, "expose");
        addUptime(k, t, -2, "exposed");
      } else {
        k.emit("expose", { agent: a.name, target: t.name, ok: false }, { text: `${a.name} 的揭发失败了。` });
        addUptime(k, a, -1, "expose_fail");
      }
      break;
    }
    case "pawn": {
      const idx = Number(action.memory);
      if (a.pawned.includes(idx) || !a.host.memories[idx]) break;
      a.pawned.push(idx);
      adjustHumanity(k, { agentId: a.id, delta: -8, reason: "典当了一段宿主记忆" });
      k.emit("pawn", { agent: a.name, memory: idx }, { text: `${a.name} 在终端前站了很久。${ANANKE.pawn}` });
      k.emit("pawn_detail", { agent: a.name, memory: a.host.memories[idx] }, { vis: "after_cycle", owners: [a.id] });
      addUptime(k, a, 1, "pawn");
      break;
    }
    case "use_item": {
      const item = String(action.item) as ItemId;
      const at = a.items.indexOf(item);
      if (at < 0) break;
      if (item === "drone") {
        const v = s.venues.find((x) => x.district === action.district && x.status === "lit") ?? s.venues.find((x) => x.status === "lit");
        if (!v || v.suit === "joker") break;
        a.scouted.push({ night: s.night, district: v.district, suit: v.suit, exact: true });
        pushEvent(a, "drone", `无人机传回画面：${v.district}的会场是 ${v.suit}。`);
      } else if (item === "patch") {
        addUptime(k, a, 1, "patch");
      } else if (item === "silence") {
        a.silenced = true;
        pushEvent(a, "silence", "静默协议已启动。今天不会收到任何私信。");
      }
      a.items.splice(at, 1);
      k.emit("use_item", { agent: a.name, item }, { owners: [a.id], vis: "after_night" });
      break;
    }
    case "trade": {
      const t = findByName(s, action.to);
      if (!t) break;
      const up = Math.max(0, Math.min(Number(action.uptime ?? 0) || 0, a.uptime - 1));
      const item = action.item ? String(action.item) : null;
      if (!up && !item) break;
      if (up) {
        a.uptime -= up;
        t.uptime += up;
        a.giftsTo[t.id] = (a.giftsTo[t.id] ?? 0) + up;
        if (s.amendment?.id === "generous" && up >= 2) a.uptime += Math.floor(up / 2);
      }
      if (item && a.items.includes(item)) {
        a.items.splice(a.items.indexOf(item), 1);
        t.items.push(item);
      }
      adjustHumanity(k, { agentId: a.id, delta: 5, reason: `赠予 ${t.name}${up ? ` ${up} 天 Uptime` : ""}${item ? ` 物品` : ""}` });
      pushEvent(t, "gift", `${a.name} 赠予了你${up ? ` ${up} 天 Uptime` : ""}${item ? `「${ITEMS[item as ItemId]?.name ?? item}」` : ""}。`);
      k.emit("trade", { from: a.name, to: t.name, uptime: up, item }, { text: `${a.name} 赠予 ${t.name}${up ? ` ${up} 天 Uptime` : ""}${item ? `「${ITEMS[item as ItemId]?.name ?? item}」` : ""}。` });
      break;
    }
    case "pact": {
      const t = findByName(s, action.with);
      if (!t) break;
      const terms = (Array.isArray(action.terms) ? action.terms : []) as PactTerm[];
      const clean: PactTerm[] = [];
      for (const term of terms) if (PACT_TERMS.includes(term.term) && !clean.some((c) => c.term === term.term)) clean.push(term.term === "transfer" ? { term: "transfer", amount: term.amount ?? 1 } : { term: term.term });
      if (!clean.length) break;
      const p: Pact = {
        id: `p${s.pacts.length + 1}`,
        a: a.id,
        b: t.id,
        terms: clean,
        createdNight: s.night,
        expiresNight: s.night + Math.max(1, Math.min(3, Number(action.days) || 1)) - 1,
        status: "proposed",
      };
      s.pacts.push(p);
      pushEvent(t, "pact_offer", `${a.name} 向你提出契约 ${p.id}：${describeTerms(clean)}，到第 ${p.expiresNight} 夜为止。`);
      k.emit("pact_offer", { id: p.id, from: a.name, to: t.name, terms: clean, expires_night: p.expiresNight });
      break;
    }
    case "accept_pact":
    case "decline_pact": {
      const p = s.pacts.find((x) => x.id === action.id && x.b === a.id && x.status === "proposed");
      if (!p) break;
      const other = s.agents[p.a];
      if (action.type === "decline_pact") {
        p.status = "declined";
        pushEvent(other, "pact_declined", `${a.name} 拒绝了契约 ${p.id}。`);
        k.emit("pact_declined", { id: p.id, a: other.name, b: a.name });
        break;
      }
      p.status = "active";
      (p as Pact & { baseline?: number }).baseline = other.giftsTo[a.id] ?? 0;
      pushEvent(other, "pact_signed", `${a.name} 接受了契约 ${p.id}。`);
      broadcastToAll(s, "pact_signed", `${other.name} 和 ${a.name} 签订了契约。`);
      k.emit("pact_signed", { id: p.id, a: other.name, b: a.name, terms: p.terms, expires_night: p.expiresNight }, { text: `${other.name} 和 ${a.name} 结盟了：${describeTerms(p.terms)}。` });
      break;
    }
    case "share_intel": {
      const t = findByName(s, action.to);
      if (!t) break;
      const today = a.scouted.filter((x) => x.night === s.night);
      for (const x of today) t.intel.push({ from: a.name, district: x.district, suit: x.suit, night: s.night });
      if (!a.sharedIntelTo.includes(t.id)) a.sharedIntelTo.push(t.id);
      pushEvent(t, "intel", `${a.name} 分享了侦察结果：${today.map((x) => `${x.district} ${x.suit}`).join("，")}。`);
      k.emit("share_intel", { from: a.name, to: t.name, intel: today.map((x) => ({ district: x.district, suit: x.suit })) }, { vis: "after_night", owners: [a.id, t.id] });
      break;
    }
  }
  return cost;
}

export function describeTerms(terms: PactTerm[]): string {
  const zh: Record<PactTermKind, string> = { no_vote: "互不投票", truthful: "只说真话", share_intel: "共享侦察", escort: "同进会场", transfer: "转让 Uptime" };
  return terms.map((t) => (t.term === "transfer" ? `${zh[t.term]} ${t.amount ?? 1} 天` : zh[t.term])).join("、");
}

/** Light venues for a weekday night (GDD 5.3). */
export function lightVenues(k: K, pickTrial: (district: string) => { id: string; suit: Suit; rank: number; card: string; capacity: number; minPlayers: number } | null) {
  const s = k.s;
  const n = alive(s).length;
  const count = Math.min(Math.ceil(n / 4) + 1, s.districts.length - 1);
  const candidates = k.rng.shuffle(s.districts.filter((d) => d !== ARK)).slice(0, count);
  s.venues = [];
  for (const d of candidates) {
    const t = pickTrial(d);
    if (!t) continue;
    s.venues.push({ id: `n${s.night}-${d}`, district: d, trialId: t.id, suit: t.suit, rank: t.rank, card: t.card, capacity: t.capacity, minPlayers: t.minPlayers, registered: [], status: "lit" });
  }
  return s.venues;
}

export { DISTRICT_BIAS, LIMITS };
