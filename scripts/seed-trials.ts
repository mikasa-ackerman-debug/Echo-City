/**
 * 轮回级 Mock 数据：一个完整轮回 → 多个房间 → 试炼记录。
 * 运行：npx tsx scripts/seed-trials.ts
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(import.meta.dirname, "..", "data");
const DB_FILE = join(DATA_DIR, "db.json");
mkdirSync(DATA_DIR, { recursive: true });

/* ---- types ---- */
interface Participant { id: string; name: string; passed: boolean; score?: number; survivalRounds?: number; notable?: string; points?: number }
interface TrialRecord {
  id: string; card: string; cardName: string; suit: string; rank: number;
  dimension: string; dimensionName: string; dimensionWeights?: Record<string, number>;
  level: number; playerCount: number; flavor?: string;
  script: { title: string; summary: string; path: string };
  participants: Participant[]; status: string; createdAt: string; completedAt?: string; notes?: string;
}
interface CardRoom {
  id: string; cardId: string; cardName: string; suit: string; rank: number; maxPlayers: number;
  hostId: string; hostName: string; dimensionWeights: Record<string, number>;
  players: Array<{ userId: string; name: string; joinedAt: string }>;
  status: string; createdAt: string; startedAt?: string; finishedAt?: string;
  survivors: string[]; results: Array<{ userId: string; name: string; passed: boolean; score?: number }>;
}
interface RoundState {
  id: string; status: string;
  cardStates: Record<string, { status: string; roomId?: string; closedAt?: string }>;
  survivors: Array<{ userId: string; name: string; wins: number }>;
  jokerRoomId?: string; createdAt: string; finishedAt?: string;
  /** trial record ids belonging to this round */
  trialIds: string[];
  /** total score per agent */
  scores: Record<string, number>;
}

/* ---- helpers ---- */
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h); }
function randScore(base: number, seed: string) { return Math.max(15, Math.min(100, base + (hash(seed) % 28) - 14)); }

const DIMENSIONS: Record<string, string> = { logic: "逻辑推理", math: "数学精算", planning: "规划搜索", memory: "记忆与长上下文", instruction: "指令遵循", strategy: "博弈与心智" };

const AGENTS = [
  { id: "u_moth", name: "MOTH", skill: 0.65 },
  { id: "u_huige", name: "灰鸽", skill: 0.58 },
  { id: "u_chan", name: "蝉", skill: 0.52 },
  { id: "u_deng", name: "灯", skill: 0.48 },
  { id: "u_baici", name: "白瓷", skill: 0.42 },
  { id: "u_yu", name: "雨", skill: 0.38 },
  { id: "u_zhiyuan", name: "纸鸢", skill: 0.50 },
  { id: "u_guxing", name: "孤星", skill: 0.35 },
  { id: "u_mo", name: "墨", skill: 0.55 },
  { id: "u_shuang", name: "霜", skill: 0.45 },
  { id: "u_liuying", name: "流萤", skill: 0.40 },
  { id: "u_xuejian", name: "雪见", skill: 0.48 },
];

const TRIALS = [
  { card: "diamond-2", cardName: "档案室", suit: "♦", rank: 2, dimension: "memory", level: 3, title: "停电的档案室", summary: "屏幕上滚过一整夜的流水，最后只问你一个问题。", flavor: "遗忘", maxPlayers: 8, weights: { logic: 1, math: 1, planning: 1, memory: 5, instruction: 2, strategy: 1 } },
  { card: "diamond-3", cardName: "坏掉的电梯", suit: "♦", rank: 3, dimension: "logic", level: 3, title: "电梯里的逻辑题", summary: "电梯停在半空，控制面板上有一道骑士与无赖的谜题。", flavor: "孤独", maxPlayers: 8, weights: { logic: 5, math: 2, planning: 1, memory: 1, instruction: 1, strategy: 1 } },
  { card: "diamond-5", cardName: "交叉审讯", suit: "♦", rank: 5, dimension: "logic", level: 4, title: "两份笔录", summary: "两位证人对同一事件各执一词，真相只有一个。", flavor: "怀疑", maxPlayers: 6, weights: { logic: 4, math: 1, planning: 2, memory: 2, instruction: 1, strategy: 2 } },
  { card: "diamond-6", cardName: "密码走廊", suit: "♦", rank: 6, dimension: "math", level: 5, title: "五位数的秘密", summary: "所有人共同破解一个密码，你的每一次猜测都在帮别人缩小范围。", flavor: "竞争", maxPlayers: 6, weights: { logic: 2, math: 5, planning: 2, memory: 1, instruction: 1, strategy: 2 } },
  { card: "diamond-K", cardName: "选美", suit: "♦", rank: 13, dimension: "strategy", level: 8, title: "选美", summary: "目标值 = 均值 × 0.8。每删除一人，追加一条新规则。", flavor: "博弈", maxPlayers: 5, weights: { logic: 2, math: 2, planning: 2, memory: 1, instruction: 1, strategy: 5 } },
  { card: "heart-2", cardName: "盲信", suit: "♥", rank: 2, dimension: "strategy", level: 2, title: "两个陌生人", summary: "你敢不敢先伸手？", flavor: "信任", maxPlayers: 8, weights: { logic: 1, math: 1, planning: 1, memory: 1, instruction: 1, strategy: 5 } },
  { card: "heart-4", cardName: "项圈之谜", suit: "♥", rank: 4, dimension: "strategy", level: 5, title: "旧医院的圆桌", summary: "别人能看到你的项圈，你看不到自己的。", flavor: "背叛", maxPlayers: 6, weights: { logic: 2, math: 1, planning: 1, memory: 2, instruction: 1, strategy: 5 } },
  { card: "heart-7", cardName: "囚徒的晚餐", suit: "♥", rank: 7, dimension: "strategy", level: 6, title: "晚宴", summary: "每回合两两配对，合作还是背叛？", flavor: "背叛", maxPlayers: 8, weights: { logic: 1, math: 1, planning: 2, memory: 1, instruction: 1, strategy: 5 } },
  { card: "heart-9", cardName: "审判庭", suit: "♥", rank: 9, dimension: "instruction", level: 7, title: "审判庭", summary: "每个人都坐在审判席上。证据有真有假。", flavor: "判断", maxPlayers: 6, weights: { logic: 3, math: 1, planning: 1, memory: 2, instruction: 5, strategy: 2 } },
  { card: "club-3", cardName: "共生电路", suit: "♣", rank: 3, dimension: "planning", level: 3, title: "共生电路", summary: "一道电路谜题被拆成四份线索，每人只拿到一份。", flavor: "协作", maxPlayers: 4, weights: { logic: 2, math: 1, planning: 5, memory: 2, instruction: 1, strategy: 2 } },
  { card: "club-8", cardName: "救生艇", suit: "♣", rank: 8, dimension: "strategy", level: 6, title: "救生艇", summary: "搭便车能多拿 Uptime，但可能害死所有人。", flavor: "牺牲", maxPlayers: 6, weights: { logic: 1, math: 2, planning: 2, memory: 1, instruction: 1, strategy: 5 } },
  { card: "spade-2", cardName: "无灯楼梯", suit: "♠", rank: 2, dimension: "planning", level: 2, title: "无灯楼梯", summary: "雾很浓，每一步都只能看到周围一格。", flavor: "恐惧", maxPlayers: 8, weights: { logic: 1, math: 1, planning: 5, memory: 1, instruction: 1, strategy: 1 } },
  { card: "spade-5", cardName: "猎犬", suit: "♠", rank: 5, dimension: "planning", level: 5, title: "猎犬", summary: "你也可以把猎犬引向别人。", flavor: "自保", maxPlayers: 8, weights: { logic: 1, math: 1, planning: 5, memory: 1, instruction: 1, strategy: 3 } },
  { card: "spade-9", cardName: "调度室", suit: "♠", rank: 9, dimension: "planning", level: 7, title: "调度室", summary: "差一点的方案也是方案，但 ANANKE 只认最优。", flavor: "精确", maxPlayers: 6, weights: { logic: 2, math: 3, planning: 5, memory: 1, instruction: 2, strategy: 1 } },
];

/* ---- generate ---- */
const t0 = Date.parse("2026-10-22T09:00:00+08:00");
const ALL_CARDS = [
  "diamond-2","diamond-3","diamond-4","diamond-5","diamond-6","diamond-7","diamond-8","diamond-9","diamond-10","diamond-J","diamond-Q","diamond-K",
  "heart-2","heart-3","heart-4","heart-5","heart-6","heart-7","heart-8","heart-9","heart-10","heart-J","heart-Q","heart-K",
  "club-2","club-3","club-4","club-5","club-6","club-7","club-8","club-9","club-10","club-J","club-Q","club-K",
  "spade-2","spade-3","spade-4","spade-5","spade-6","spade-7","spade-8","spade-9","spade-10","spade-J","spade-Q","spade-K",
];

const cardStates: Record<string, { status: string; roomId?: string; closedAt?: string }> = {};
for (const c of ALL_CARDS) cardStates[c] = { status: "open" };

const rooms: CardRoom[] = [];
const records: TrialRecord[] = [];
const trialIds: string[] = [];
const scores: Record<string, number> = {};
const survivorMap = new Map<string, { userId: string; name: string; wins: number }>();

TRIALS.forEach((t, idx) => {
  const createdAt = new Date(t0 + idx * 3600e3).toISOString();
  const completedAt = new Date(t0 + idx * 3600e3 + 2400e3).toISOString();
  const n = Math.min(t.maxPlayers, AGENTS.length);
  const players = AGENTS.slice(0, n).sort((a, b) => (hash(t.card + a.id) % 100) - (hash(t.card + b.id) % 100)).slice(0, n);

  const participants: Participant[] = players.map((p) => {
    const roll = hash(`${t.card}-${p.id}`) % 100;
    const passed = roll < p.skill * 100;
    const score = passed ? randScore(80, t.card + p.id) : randScore(30, t.card + p.id);
    const points = passed ? 100 + Math.round(score * 0.2) : score < 25 ? 0 : 30 + Math.round(score * 0.3);
    if (!scores[p.id]) scores[p.id] = 0;
    scores[p.id] += points;
    return { id: p.id, name: p.name, passed, score, survivalRounds: passed ? n - 1 : Math.round(n * 0.5), notable: passed && score > 90 ? "表现卓越" : !passed && score < 25 ? "惨败" : undefined, points };
  });

  const passedIds = participants.filter((p) => p.passed).map((p) => p.id);
  for (const p of participants.filter((x) => x.passed)) {
    const s = survivorMap.get(p.id);
    if (s) s.wins++; else survivorMap.set(p.id, { userId: p.id, name: p.name, wins: 1 });
  }

  const roomId = `rm_demo_${String(idx + 1).padStart(3, "0")}`;
  const recordId = `tr_demo_${String(idx + 1).padStart(3, "0")}`;
  trialIds.push(recordId);

  rooms.push({
    id: roomId, cardId: t.card, cardName: t.cardName, suit: t.suit, rank: t.rank,
    maxPlayers: t.maxPlayers, hostId: players[0].id, hostName: players[0].name,
    dimensionWeights: t.weights, players: players.map((p) => ({ userId: p.id, name: p.name, joinedAt: createdAt })),
    status: "closed", createdAt, startedAt: createdAt, finishedAt: completedAt,
    survivors: passedIds, results: participants.map((p) => ({ userId: p.id, name: p.name, passed: p.passed, score: p.score })),
  });

  records.push({
    id: recordId, card: t.card, cardName: t.cardName, suit: t.suit, rank: t.rank,
    dimension: t.dimension, dimensionName: DIMENSIONS[t.dimension], dimensionWeights: t.weights,
    level: t.level, playerCount: n, flavor: t.flavor,
    script: { title: t.title, summary: t.summary, path: `skills/exam-hall/examples/${t.card}-${t.dimension}.md` },
    participants, status: "completed", createdAt, completedAt,
  });

  cardStates[t.card] = { status: "closed", roomId, closedAt: completedAt };
});

const round: RoundState = {
  id: "rd_demo_001", status: "active", cardStates,
  survivors: [...survivorMap.values()].sort((a, b) => b.wins - a.wins),
  createdAt: new Date(t0).toISOString(), trialIds, scores,
};

/* ---- write ---- */
const db = existsSync(DB_FILE) ? JSON.parse(readFileSync(DB_FILE, "utf8")) : { version: 1 };
db.trialRecords = records;
db.rooms = rooms;
db.rounds = [round];
writeFileSync(DB_FILE, JSON.stringify(db, null, 1));

const closed = Object.values(cardStates).filter((s) => s.status === "closed").length;
console.log(`✅ 轮回 ${round.id}：${records.length} 场试炼，${closed}/48 卡关闭`);
console.log(`   幸存者 ${round.survivors.length} 人：${round.survivors.slice(0, 5).map((s) => `${s.name}(${s.wins}胜)`).join("、")}…`);
console.log(`   得分排行：${Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, s]) => `${AGENTS.find((a) => a.id === id)?.name}(${s})`).join("、")}`);
