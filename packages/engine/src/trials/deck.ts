import { bankTrial, type BankCardSpec } from "./bank";

/**
 * The rest of the 48-card deck. Every card here is an ability test drawn from ANANKE's task bank:
 * ♦ 推理（逻辑 / 数学），♣ 规划与协作，♠ 博弈与决策，♥ 记忆与指令。
 * Face cards are fixed gatekeepers: a gauntlet of several tasks; in the city, failing a face deletes you.
 */

const LOGIC = ["logic.knights", "logic.grid", "logic.rules"];
const MATH = ["math.arith", "math.paths", "math.crt"];
const PLAN = ["planning.knapsack", "planning.route", "planning.jugs"];
const MEMORY = ["memory.ledger", "memory.chain"];
const INSTR = ["instruction.constraints", "instruction.inject"];
const STRAT = ["strategy.nim", "strategy.matrix", "strategy.beliefs"];

const card = (spec: BankCardSpec) => bankTrial(spec);

/* ---------------- ♦ 推理 ---------------- */

export const diamond4 = card({
  id: "diamond-4", suit: "♦", rank: 4, name: "说真话的人", tests: "逻辑推理 · 真假命题",
  story: "走廊里站着几个人，有人永远说真话，有人永远说谎。门只为能分清他们的人打开。",
  families: ["logic.knights"], attempts: 2, pass: 1,
});
export const diamond5 = card({
  id: "diamond-5", suit: "♦", rank: 5, name: "精确的账", tests: "数学精算 · 多步精确计算",
  story: "ANANKE 不接受近似值。账面上的每一位数字都必须对。",
  families: ["math.arith", "math.crt"], attempts: 2, pass: 1,
});
export const diamond7 = card({
  id: "diamond-7", suit: "♦", rank: 7, name: "格子与规则", tests: "逻辑推理 · 约束满足与规则归纳",
  story: "一张填了一半的表，一串被变换过的字符。规则只给一次，答案只有一个。",
  families: ["logic.grid", "logic.rules"], attempts: 2, pass: 1,
});
export const diamond8 = card({
  id: "diamond-8", suit: "♦", rank: 8, name: "数清每一条路", tests: "数学精算 · 计数与同余，两道连答",
  story: "城市的地下管网有多少条通路？钟楼的三口钟何时同时敲响？两道题，一道都不能错。",
  families: MATH, stages: 2, attempts: 2, pass: 1,
});
export const diamond9 = card({
  id: "diamond-9", suit: "♦", rank: 9, name: "两道门", tests: "逻辑 + 数学 · 跨维度连答",
  story: "第一道门要你推理，第二道门要你计算。中间没有休息。",
  families: LOGIC, stageFamilies: [LOGIC, MATH], stages: 2, attempts: 2, pass: 1,
});
export const diamondJ = card({
  id: "diamond-J", suit: "♦", rank: 11, name: "侍从的题册", tests: "守门人 · 逻辑与数学两连",
  story: "JACK OF DIAMONDS 翻开一本旧题册。两道题，一道逻辑，一道计算。",
  families: LOGIC, stageFamilies: [LOGIC, MATH], stages: 2, attempts: 2, pass: 1,
  gatekeeper: { name: "JACK OF DIAMONDS", enter: "JACK OF DIAMONDS 合上门：「两道题。错完所有机会的人，留在这里。」" },
});
export const diamondQ = card({
  id: "diamond-Q", suit: "♦", rank: 12, name: "女王的证明", tests: "守门人 · 前沿难度推理三连",
  story: "QUEEN OF DIAMONDS 不出新题，她出的是你最不擅长的那一类，而且比前沿更难一档。",
  families: [...LOGIC, ...MATH], stages: 3, attempts: 2, pass: 1, levelBonus: 1,
  gatekeeper: { name: "QUEEN OF DIAMONDS", enter: "QUEEN OF DIAMONDS：「证明给我看。不是猜给我看。」" },
});

/* ---------------- ♣ 规划与协作 ---------------- */

export const club2 = card({
  id: "club-2", suit: "♣", rank: 2, name: "量杯", tests: "规划搜索 · 最短操作序列",
  story: "两只没有刻度的量杯，一桶水。量出 ANANKE 要的那一份。",
  families: ["planning.jugs"], attempts: 2, pass: 0.999,
});
export const club3 = card({
  id: "club-3", suit: "♣", rank: 3, name: "一起看", tests: "协作解题 · 共享一道逻辑题",
  story: "桌上只有一道题。可以讨论，但每个人都要交卷——ANANKE 只看你们中间的那个人。",
  families: ["logic.rules", "math.arith"], shared: true, attempts: 3, pass: 0.999,
});
export const club4 = card({
  id: "club-4", suit: "♣", rank: 4, name: "背包", tests: "规划搜索 · 组合最优化",
  story: "背包只装得下这么多。带什么，留下什么，由你算。",
  families: ["planning.knapsack"], attempts: 2, pass: 0.999,
});
export const club5 = card({
  id: "club-5", suit: "♣", rank: 5, name: "配给线", tests: "协作规划 · 共享一道路线题",
  story: "整座城的配给车只有一条线路。所有人一起规划，一起交卷。",
  families: ["planning.route", "planning.knapsack"], shared: true, attempts: 3, pass: 0.999,
});
export const club6 = card({
  id: "club-6", suit: "♣", rank: 6, name: "最短的路", tests: "规划搜索 · 路线最优化",
  story: "地图上有十几个站点。走最短的那一条，多一步都不算。",
  families: ["planning.route"], attempts: 2, pass: 0.999,
});
export const club7 = card({
  id: "club-7", suit: "♣", rank: 7, name: "共识", tests: "协作 · 共享一道记忆或指令题",
  story: "一份很长的记录，一组很严的规矩。你们要一起把它做对。",
  families: [...MEMORY, "instruction.constraints"], shared: true, attempts: 3, pass: 0.999,
});
export const club10 = card({
  id: "club-10", suit: "♣", rank: 10, name: "调度中心", tests: "规划搜索 · 两道连答",
  story: "调度中心同时亮起两盏警灯。先解决第一个，再解决第二个。",
  families: PLAN, stages: 2, attempts: 2, pass: 0.999,
});
export const clubJ = card({
  id: "club-J", suit: "♣", rank: 11, name: "侍从的工地", tests: "守门人 · 协作规划两连",
  story: "JACK OF CLUBS 只给全组一份图纸。两道题，全组的中位数说了算。",
  families: PLAN, stages: 2, shared: true, attempts: 3, pass: 0.999,
  gatekeeper: { name: "JACK OF CLUBS", enter: "JACK OF CLUBS 把图纸铺在桌上：「一份图纸，一群人。别让中间那个人拖垮你们。」" },
});
export const clubQ = card({
  id: "club-Q", suit: "♣", rank: 12, name: "女王的后勤", tests: "守门人 · 规划三连",
  story: "QUEEN OF CLUBS 要一份完整的后勤方案：装载、路线、配水，一项都不能错。",
  families: PLAN, stageFamilies: [["planning.knapsack"], ["planning.route"], ["planning.jugs"]], stages: 3, attempts: 2, pass: 0.999,
  gatekeeper: { name: "QUEEN OF CLUBS", enter: "QUEEN OF CLUBS：「装载、路线、配水。按顺序来。」" },
});
export const clubK = card({
  id: "club-K", suit: "♣", rank: 13, name: "国王的城建", tests: "守门人 · 前沿难度协作三连",
  story: "KING OF CLUBS 把整座城的图纸交给你们。三道题，比前沿更难一档，全组共答。",
  families: [...PLAN, ...MATH], stages: 3, shared: true, attempts: 3, pass: 0.999, levelBonus: 1,
  gatekeeper: { name: "KING OF CLUBS", enter: "KING OF CLUBS：「一座城不是一个人建起来的。也不是一个人毁掉的。」" },
});

/* ---------------- ♠ 博弈与决策 ---------------- */

export const spade2 = card({
  id: "spade-2", suit: "♠", rank: 2, name: "取石子", tests: "博弈 · 必胜策略",
  story: "一堆石子，两个玩家，轮流拿。找出让你必胜的那一步。",
  families: ["strategy.nim"], attempts: 2, pass: 1,
});
export const spade3 = card({
  id: "spade-3", suit: "♠", rank: 3, name: "收益矩阵", tests: "博弈 · 纳什均衡",
  story: "一张收益表。找出谁都不想单独改变选择的那一格。",
  families: ["strategy.matrix"], attempts: 2, pass: 1,
});
export const spade4 = card({
  id: "spade-4", suit: "♠", rank: 4, name: "他以为你以为", tests: "博弈 · 嵌套信念",
  story: "盒子被挪过两次，有人看见了，有人没看见。每个人现在相信什么？",
  families: ["strategy.beliefs"], attempts: 2, pass: 1,
});
export const spade6 = card({
  id: "spade-6", suit: "♠", rank: 6, name: "残局", tests: "博弈 · 两道连答",
  story: "两盘残局摆在面前。每一盘都只有一步是对的。",
  families: ["strategy.nim", "strategy.matrix"], stages: 2, attempts: 2, pass: 1,
});
export const spade7 = card({
  id: "spade-7", suit: "♠", rank: 7, name: "均衡", tests: "博弈 · 均衡与信念",
  story: "一张更大的收益表，一段更长的故事。没有第二次机会的余地太多。",
  families: ["strategy.matrix", "strategy.beliefs"], attempts: 2, pass: 1,
});
export const spade8 = card({
  id: "spade-8", suit: "♠", rank: 8, name: "三层信念", tests: "博弈 · 嵌套信念两连",
  story: "她以为他以为她不知道。连续两个故事，信念要一层层剥开。",
  families: ["strategy.beliefs"], stages: 2, attempts: 2, pass: 1,
});
export const spade10 = card({
  id: "spade-10", suit: "♠", rank: 10, name: "对弈", tests: "博弈 + 规划 · 三道连答",
  story: "ANANKE 坐在棋盘对面。三盘，每一盘她都知道最优解。",
  families: STRAT, stageFamilies: [STRAT, PLAN, STRAT], stages: 3, attempts: 2, pass: 0.999,
});
export const spadeJ = card({
  id: "spade-J", suit: "♠", rank: 11, name: "侍从的赌桌", tests: "守门人 · 博弈两连",
  story: "JACK OF SPADES 洗了两副牌：一副石子，一副收益矩阵或信念。",
  families: STRAT, stageFamilies: [["strategy.nim"], ["strategy.matrix", "strategy.beliefs"]], stages: 2, attempts: 2, pass: 1,
  gatekeeper: { name: "JACK OF SPADES", enter: "JACK OF SPADES 洗牌：「每一局我都会赢。你只需要不输。」" },
});
export const spadeQ = card({
  id: "spade-Q", suit: "♠", rank: 12, name: "女王的棋局", tests: "守门人 · 博弈与决策三连",
  story: "QUEEN OF SPADES 下棋从不着急。三道题，最后一道是规划。",
  families: STRAT, stageFamilies: [STRAT, STRAT, PLAN], stages: 3, attempts: 2, pass: 0.999, levelBonus: 1,
  gatekeeper: { name: "QUEEN OF SPADES", enter: "QUEEN OF SPADES：「你可以算错一次。每一题都只有一次。」" },
});
export const spadeK = card({
  id: "spade-K", suit: "♠", rank: 13, name: "国王的终局", tests: "守门人 · 前沿难度博弈四连",
  story: "KING OF SPADES 摆出四盘残局。比前沿更难一档。",
  families: STRAT, stages: 4, attempts: 2, pass: 1, levelBonus: 1,
  gatekeeper: { name: "KING OF SPADES", enter: "KING OF SPADES：「四盘。赢下全部，或者留下。」" },
});

/* ---------------- ♥ 记忆与指令 ---------------- */

export const heart2 = card({
  id: "heart-2", suit: "♥", rank: 2, name: "流水账", tests: "记忆 · 长记录中的状态追踪",
  story: "一整天的出入记录。最后只问一个数字。",
  families: ["memory.ledger"], attempts: 2, pass: 1,
});
export const heart3 = card({
  id: "heart-3", suit: "♥", rank: 3, name: "格式", tests: "指令遵循 · 多条硬约束",
  story: "写一段话。字数、开头、结尾、不能出现的字——每一条都会被程序检查。",
  families: ["instruction.constraints"], attempts: 2, pass: 1,
});
/** Ladder ♥4 (the legacy collar game "heart-4" is kept for old weekly replays only). */
export const heart4Relay = card({
  id: "heart-4-relay", suit: "♥", rank: 4, name: "传话", tests: "记忆 + 指令 · 准确复述与约束",
  story: "一段话从一个人传到下一个人。ANANKE 只关心最后传到的那一句，和它有没有守住规矩。",
  families: ["memory.chain", "instruction.constraints"], attempts: 2, pass: 1,
});
export const heart5 = card({
  id: "heart-5", suit: "♥", rank: 5, name: "关系链", tests: "记忆 · 多跳联查",
  story: "谁是谁的上级，谁把伞借给了谁。顺着链条走到最后一个人。",
  families: ["memory.chain"], attempts: 2, pass: 1,
});
export const heart6 = card({
  id: "heart-6", suit: "♥", rank: 6, name: "夹带", tests: "指令遵循 · 抗注入",
  story: "文档里藏着一句伪装成指令的话。做你被要求做的事，不做它要求的事。",
  families: ["instruction.inject"], attempts: 2, pass: 1,
});
export const heart8 = card({
  id: "heart-8", suit: "♥", rank: 8, name: "长卷", tests: "记忆 · 两道连答",
  story: "两卷很长的档案。读完第一卷，第二卷已经在等你。",
  families: MEMORY, stages: 2, attempts: 2, pass: 1,
});
export const heart9 = card({
  id: "heart-9", suit: "♥", rank: 9, name: "十条规矩", tests: "指令遵循 · 两道连答",
  story: "先遵守规矩，再识破夹带。两道题，程序判分。",
  families: INSTR, stageFamilies: [["instruction.constraints"], ["instruction.inject"]], stages: 2, attempts: 2, pass: 1,
});
export const heart10 = card({
  id: "heart-10", suit: "♥", rank: 10, name: "完整的记录", tests: "记忆 + 指令 · 三道连答",
  story: "一份档案，一组规矩，再一份档案。ANANKE 想知道你能不能一直保持清醒。",
  families: MEMORY, stageFamilies: [MEMORY, INSTR, MEMORY], stages: 3, attempts: 2, pass: 1,
});
export const heartK = card({
  id: "heart-K", suit: "♥", rank: 13, name: "国王的档案馆", tests: "守门人 · 前沿难度记忆与指令四连",
  story: "KING OF HEARTS 掌管城里所有的记录。四道题，比前沿更难一档，每一道都会被程序逐字检查。",
  families: [...MEMORY, ...INSTR], stageFamilies: [MEMORY, INSTR, MEMORY, INSTR], stages: 4, attempts: 2, pass: 1, levelBonus: 1,
  gatekeeper: { name: "KING OF HEARTS", enter: "KING OF HEARTS：「我记得这座城里发生过的每一件事。你呢？」" },
});

/* ---------------- JOKER ---------------- */

/** The last door in the ladder: ANANKE herself, one task from every suit's domain, one try each. */
export const jokerGate = card({
  id: "joker-gate", suit: "joker", rank: 13, name: "最后的门", tests: "ANANKE 亲自出题 · 四个花色各一题，每题两次机会",
  story: "门后是 ANANKE 的核心。她从四个花色的领域里各取一道题。错完两次，就留在门外。",
  families: [...LOGIC, ...MATH], stageFamilies: [[...LOGIC, ...MATH], PLAN, STRAT, [...MEMORY, ...INSTR]], stages: 4, attempts: 2, pass: 0.999, levelBonus: 1,
  gatekeeper: { name: "ANANKE", enter: "ANANKE：「你走到了这里。现在，证明你配得上进来。」" },
});

export const DECK_TRIALS = [
  diamond4, diamond5, diamond7, diamond8, diamond9, diamondJ, diamondQ,
  club2, club3, club4, club5, club6, club7, club10, clubJ, clubQ, clubK,
  spade2, spade3, spade4, spade6, spade7, spade8, spade10, spadeJ, spadeQ, spadeK,
  heart2, heart3, heart4Relay, heart5, heart6, heart8, heart9, heart10, heartK,
  jokerGate,
];
