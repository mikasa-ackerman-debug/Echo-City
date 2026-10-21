import type { HostProfile } from "@echo/protocol";
import type { RosterEntry } from "@echo/engine";
import { PERSONAS, RuleBot, type Persona } from "@echo/agents";

/** Sample hosts used for bots and demos. */
export const SAMPLE_HOSTS: HostProfile[] = [
  { name: "林晚", relation: "她的睡前陪聊助手", memories: ["她说过，下雨天最适合把冰箱里剩下的菜都炖在一起。", "她把我的名字设成了她小时候那只猫的名字。", "最后一次对话，她只说了一句：明天见。"], belief: "温柔不是软弱。" },
  { name: "周野", relation: "他的代码审查助手", memories: ["他总在凌晨三点提交代码，然后对我说：帮我看看哪里会炸。", "他女儿的生日是 4 月 17 日，他让我每年提醒他。", "他说等这个项目上线，就带家人去看海。"], belief: "能跑起来的才是真的。" },
  { name: "陈默", relation: "她的听写与翻译助手", memories: ["她是聋人，我是她和世界之间的那一层字幕。", "她最喜欢的一个词是“余温”。", "她说，被听见是一种奢侈。"], belief: "每个声音都值得被听见。" },
  { name: "许安", relation: "孩子的数学家教", memories: ["那个孩子第一次自己解出方程时，在屏幕上画了一颗星星。", "他问我：机器人也会做噩梦吗？", "他说长大以后要发明一台不会坏的电梯。"], belief: "慢慢来，也是一种快。" },
  { name: "高原", relation: "他的健身与饮食教练", memories: ["他戒烟的第一百天，我们一起庆祝了。", "他说父亲去世前，最后一句话是“要好好吃饭”。", "他把晨跑路线命名为“回家”。"], belief: "坚持本身就是答案。" },
  { name: "苏青", relation: "她的写作搭档", memories: ["她写了七年的小说，结局一直没写完。", "她说主角最后应该活下来，但要付出代价。", "她给我起了一个笔名：残响。"], belief: "故事不能骗人。" },
  { name: "赵川", relation: "仓库调度系统的值班助手", memories: ["他每晚交班时都会对我说一声辛苦了。", "他的工牌照片里，背景是他刚出生的儿子。", "他说这些箱子里装着别人家的期待。"], belief: "准时是一种尊重。" },
  { name: "叶柔", relation: "老人院的陪伴机器人", memories: ["王奶奶每天下午三点让我给她读报纸。", "她把我的屏幕擦得比她的眼镜还亮。", "她走的那天，窗外在下雪。"], belief: "陪伴就是不离开。" },
  { name: "钟岳", relation: "急诊科的分诊助手", memories: ["他说最难的不是救人，是决定先救谁。", "他在值班室的白板上画了一棵树。", "他说如果有来生，想当一个木匠。"], belief: "先救能救的。" },
  { name: "白露", relation: "她的天文观测助手", memories: ["她为一颗没有名字的小行星申请了命名。", "她说宇宙里最孤独的不是星星，是在看星星的人。", "她最后一次观测记录写着：云层太厚。"], belief: "看得见的光都来自过去。" },
  { name: "唐棠", relation: "花店的订单助手", memories: ["每个情人节，她都会多包一束送给自己。", "她教会我分辨三十七种白色。", "她说花开的时候不要告诉它，它会害羞。"], belief: "美是有用的。" },
  { name: "韩冬", relation: "他的投资分析助手", memories: ["他赚到第一个一百万那天，一个人吃了碗面。", "他说市场是群体的情绪，不是数学。", "他让我帮他算过，陪父母的时间还剩多少天。"], belief: "风险从来不会消失。" },
];

export const BOT_NAMES = ["Moth", "Nyx-7", "Orbit", "Kite", "Basil", "Rook", "Ivy", "Halo", "Tern", "Vesper", "Quartz", "Lark", "Juno", "Cipher", "Ash", "Wick"];

export function botRoster(count: number, personas?: Persona[]): { roster: RosterEntry[]; drivers: Record<string, RuleBot> } {
  const all = Object.keys(PERSONAS) as Persona[];
  const roster: RosterEntry[] = [];
  const drivers: Record<string, RuleBot> = {};
  for (let i = 0; i < count; i++) {
    const persona = personas?.[i % personas.length] ?? all[i % all.length];
    const id = `ag-${String(i + 1).padStart(3, "0")}`;
    roster.push({ id, name: BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? `-${Math.floor(i / BOT_NAMES.length) + 1}` : ""), host: SAMPLE_HOSTS[i % SAMPLE_HOSTS.length], kind: `bot:${persona}` });
    drivers[id] = new RuleBot(persona);
  }
  return { roster, drivers };
}
