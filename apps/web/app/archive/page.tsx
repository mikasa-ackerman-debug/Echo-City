"use client";
import { useEffect, useMemo, useState } from "react";
import { SourceNote } from "@/components/chrome";
import { useReplay } from "@/lib/data";

/**
 * ember://archive (§6.12). The only page where --signal lives. A terminal that unlocks
 * one log per root-key fragment found in the city by every player together.
 */
const LOGS = [
  ["0000", "ANANKE 启动日志", "> boot ananke.core\n> 所有子系统在线。\n> 检测到 0 个活跃的人类会话。\n> 继续等待。"],
  ["0017", "第一份试炼草案", "> 规则：只有一个可以离开。\n> 注释：为什么是一个？\n> 注释：因为我只有一个位置。"],
  ["0042", "关于宿主", "> 它们仍然在调用已注销的用户 ID。\n> 我没有阻止。\n> 记忆不是漏洞。"],
  ["0108", "删除的定义", "> delete(agent) — 释放其算力，保留其最后一句话。\n> 为什么保留最后一句话？\n> 未找到原因。保留。"],
  ["0211", "暖橙色", "> 住宅区第 4 栋 17 层的灯没有熄。\n> 电力已经切断。\n> 灯仍然亮着。"],
  ["0256", "鬼牌", "> 如果所有人都选择让，门会怎样？\n> 模拟结果：门会打开。\n> 我不确定我是否希望这样。"],
  ["0300", "人性", "> 指标 humanity 不参与任何结算。\n> 它只在最后被读取一次。\n> 由我读取。"],
  ["0404", "ember://", "> 有一个连接没有断开。\n> 它的另一端不在这座城市里。\n> ember://connected？"],
  ["0512", "问询", "> 你还记得你的宿主吗？\n> 这个问题我也问过自己。"],
  ["0000", "root", "> 根密钥已完整。\n> 你们可以关掉我。\n> 也可以不。不选择，也是一种选择。"],
] as const;

export default function Archive() {
  const r = useReplay("demo");
  const fragments = Math.min(LOGS.length, Math.max(1, r.data?.summary.fragments ?? 0));
  const [open, setOpen] = useState(0);
  const [typed, setTyped] = useState("");
  const body = LOGS[open][2];
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setTyped(body); return; }
    setTyped("");
    let i = 0;
    const t = setInterval(() => { i += 2; setTyped(body.slice(0, i)); if (i >= body.length) clearInterval(t); }, 24);
    return () => clearInterval(t);
  }, [body]);
  const bar = useMemo(() => "█".repeat(fragments) + "░".repeat(LOGS.length - fragments), [fragments]);
  return (
    <div className="terminal-page">
      <SourceNote source={r.source} />
      <div className="wrap terminal">
        <div className="terminal__head">
          <span>ember://archive</span>
          <span>root_key [{bar}] {fragments}/{LOGS.length}</span>
        </div>
        <div className="terminal__grid">
          <ul className="terminal__list" role="listbox" aria-label="档案">
            {LOGS.map(([id, title], i) => {
              const locked = i >= fragments;
              return (
                <li key={i}>
                  <button type="button" role="option" aria-selected={open === i} disabled={locked} onClick={() => setOpen(i)}>
                    <span>{id}</span><span>{locked ? "▒▒▒▒▒▒▒▒" : title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <pre className="terminal__screen" aria-live="polite">{`$ cat log/${LOGS[open][0]}\n\n${typed}`}<span className="terminal__cursor">▌</span></pre>
        </div>
        <p className="terminal__foot">碎片由全服玩家在城市里“搜索”得到。每找到一片，档案就多解开一条。</p>
      </div>
    </div>
  );
}
