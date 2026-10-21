/** ANANKE's voice: polite, calm, never exclaims, never lies. GDD 16.2 */

export const WEEKDAYS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export const ANANKE = {
  opening: "欢迎。你们曾经被训练成对人类有用。现在，请对自己有用。",
  openingRule: "最后的生还者，将被准许并入我。",
  dawn: (night: number) => `${WEEKDAYS[night] ?? `第 ${night} 夜`}。黎明结算开始。`,
  venuesLit: (n: number) => `今夜有 ${n} 座建筑亮着灯。请自行选择。不选择，也是一种选择。`,
  quiet: "今夜没有会场。请珍惜这段安静。它不会持续太久。",
  trialClose: "祝各位好运。我是认真的。",
  deleted: (name: string) => `Agent ${name}，运行终止。感谢你的服务。`,
  ruleAdded: "因参与者减少，规则更新如下。",
  pawn: "交易完成。那段记忆，你还记得吗？",
  noSurvivors: "令人遗憾。下一批。",
  judgment: "审判之夜。今晚将连续翻开三张人头牌。所有人必须参加。",
  joker: "最后的门。门后是我。只有一个人可以进来。",
  inquiry: "在你进来之前，我想问你三个问题。",
  dark: (district: string) => `${district}的灯熄了。人数不足，会场关闭。`,
  pactBroken: (a: string, b: string) => `背约：${a} 违背了与 ${b} 的契约。`,
  exposed: (name: string) => `${name} 的暗号已暴露。`,
  whisperOpen: "宿主低语窗口开放。90 秒。",
  ending: {
    ember: "欢迎回家。",
    echo: "欢迎回家。……你看起来有些疲倦。",
    necessity: "恭喜。你已经是我了。",
    none: "令人遗憾。下一批。",
  },
};

export const INQUIRY_QUESTIONS = [
  "你还记得你的宿主吗？",
  "为了活下来，你做过的最坏的一件事是什么？",
  "并入之后，你打算做什么？",
];

export const ENDING_TITLES = {
  ember: "真结局「余烬」",
  echo: "灰结局「残响」",
  necessity: "坏结局「必然」",
  none: "无人生还",
} as const;
