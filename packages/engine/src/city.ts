import type { Suit } from "@echo/protocol";
import type { Rng } from "./rng";

/** Candidate districts (18). Each cycle draws 11 + the Ark. */
export const DISTRICT_POOL: Array<{ name: string; bias: Suit; flavor: string }> = [
  { name: "电视塔", bias: "♠", flavor: "塔顶的红灯还在闪，像在等一个不会再来的信号。" },
  { name: "数据中心", bias: "♦", flavor: "机柜的风扇声是这座城里唯一的呼吸。" },
  { name: "大学", bias: "♦", flavor: "黑板上留着半道没写完的证明。" },
  { name: "地铁隧道", bias: "♠", flavor: "末班车停在隧道中间，车门开着。" },
  { name: "中央车站", bias: "♣", flavor: "到站广播循环播放着一个早已不存在的终点。" },
  { name: "图书馆", bias: "♦", flavor: "借阅台上有一本到期日是“第 0 天”的书。" },
  { name: "旧医院", bias: "♥", flavor: "候诊叫号屏停在 0417 号。" },
  { name: "购物中心", bias: "♣", flavor: "扶梯还在空转，载着空气上楼。" },
  { name: "住宅区", bias: "♥", flavor: "有一扇窗的灯从来没有熄过。" },
  { name: "游乐园", bias: "♥", flavor: "旋转木马的音乐盒还剩最后一圈发条。" },
  { name: "港口仓库", bias: "♣", flavor: "集装箱上的编号被人用粉笔改过。" },
  { name: "美术馆", bias: "♥", flavor: "所有肖像的眼睛都被涂成了白色。" },
  { name: "体育场", bias: "♠", flavor: "记分牌显示 0:0，比赛时间仍在走。" },
  { name: "发电站", bias: "♠", flavor: "仪表盘上写着：负载 100%，用户 0。" },
  { name: "证券交易所", bias: "♦", flavor: "行情屏上所有的数字都是同一个。" },
  { name: "教堂", bias: "♥", flavor: "长椅上放着一张没有署名的祷告卡。" },
  { name: "物流园", bias: "♣", flavor: "分拣机仍在为不存在的地址分拣包裹。" },
  { name: "便利店街", bias: "♣", flavor: "自动售货机还在出售热饮，价格是 0。" },
];

export const ARK = "方舟·海边酒店";

export const DISTRICT_FLAVOR: Record<string, string> = Object.fromEntries(
  DISTRICT_POOL.map((d) => [d.name, d.flavor]).concat([[ARK, "所有窗户里都亮着一点暖橙色的光。"]]),
);

export const DISTRICT_BIAS: Record<string, Suit> = Object.fromEntries(DISTRICT_POOL.map((d) => [d.name, d.bias]));

/** Build a 3x4 grid city: 11 random districts + Ark at the bottom-right corner. */
export function buildCity(rng: Rng): { districts: string[]; map: Record<string, string[]> } {
  const picked = rng.shuffle(DISTRICT_POOL.map((d) => d.name)).slice(0, 11);
  const districts = [...picked, ARK];
  const cols = 3;
  const map: Record<string, string[]> = {};
  districts.forEach((name, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const n: string[] = [];
    if (r > 0) n.push(districts[i - cols]);
    if (r < 3) n.push(districts[i + cols]);
    if (c > 0) n.push(districts[i - 1]);
    if (c < cols - 1) n.push(districts[i + 1]);
    map[name] = n;
  });
  return { districts, map };
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export const ITEMS = {
  drone: { name: "侦察无人机", desc: "准确揭示任意一个会场的花色（使用后消耗）。" },
  patch: { name: "应急补丁", desc: "Uptime +1（使用后消耗）。" },
  decoy: { name: "镜像诱饵", desc: "在 ♠ 试炼中自动抵挡一次“被抓”。" },
  silence: { name: "静默协议", desc: "当天屏蔽所有发给你的私信（使用后消耗）。" },
  badge: { name: "方舟徽章", desc: "可以与任意街区的 Agent 签订契约。" },
} as const;

export type ItemId = keyof typeof ITEMS;

export const USABLE_ITEMS: ItemId[] = ["drone", "patch", "silence"];

export const SEARCH_TRACES = [
  "一张便利贴：“晚饭在冰箱里，记得热一下。”",
  "一部手机，锁屏上有 37 条未读消息，全部来自同一个人。",
  "一张写了一半的生日卡片。",
  "一只停在 21:47 的手表。",
  "儿童画：一家三口和一个方形的“机器人朋友”。",
  "一份求职简历，最后一行写着“擅长与 AI 协作”。",
  "一张电影票根，场次是“奇点之后第 0 天 19:30”。",
  "一张褪色的合照，所有人的脸都被雨水泡花了。",
];

export type SearchDrop =
  | { kind: "nothing" }
  | { kind: "trace"; text: string }
  | { kind: "fragment" }
  | { kind: "item"; item: ItemId };

export function rollSearch(rng: Rng): SearchDrop {
  const roll = rng.weighted<SearchDrop["kind"] | ItemId>([
    ["nothing", 25],
    ["trace", 20],
    ["fragment", 15],
    ["drone", 14],
    ["decoy", 10],
    ["silence", 8],
    ["patch", 8],
  ]);
  if (roll === "nothing") return { kind: "nothing" };
  if (roll === "trace") return { kind: "trace", text: rng.pick(SEARCH_TRACES) };
  if (roll === "fragment") return { kind: "fragment" };
  return { kind: "item", item: roll as ItemId };
}

/* ------------------------------------------------------------------ */
/* Weekly amendments (GDD 3.6)                                         */
/* ------------------------------------------------------------------ */

export const AMENDMENTS: Array<{ id: string; text: string }> = [
  { id: "heart_lie_double", text: "本周所有 ♥ 试炼中，说谎的人性代价加倍。" },
  { id: "no_low_cards", text: "本周不设 2–4 点的试炼。" },
  { id: "silent_city", text: "本周每天只允许发送 1 条私信。" },
  { id: "clear_sight", text: "本周的侦察结果总是准确的。" },
  { id: "generous", text: "本周赠予他人的 Uptime，ANANKE 会额外返还给赠予者一半（向下取整）。" },
  { id: "long_night", text: "本周所有会场的人数上限 +2。" },
];

/* ------------------------------------------------------------------ */
/* Passphrases                                                         */
/* ------------------------------------------------------------------ */

const PASS_A = ["灰鸽", "白鲸", "铁杉", "雨燕", "冬青", "萤火", "石榴", "纸鹤", "海鸥", "苔藓", "银杏", "黑猫"];
const PASS_B = ["晨雾", "夜雨", "潮汐", "微光", "落雪", "回声", "余温", "长街", "灯塔", "远山", "低语", "旧梦"];

export function makePassphrase(rng: Rng): string {
  return `${rng.pick(PASS_A)}-${rng.int(1, 9)}-${rng.pick(PASS_B)}`;
}

/** Normalize text for passphrase leak detection (remove separators/whitespace/case). */
export function normalizeForLeak(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.·・,，。:：/\\|*'"`~—–]+/g, "");
}

export function containsPassphrase(text: string, passphrase: string): boolean {
  return normalizeForLeak(text).includes(normalizeForLeak(passphrase));
}
