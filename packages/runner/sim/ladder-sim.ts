import { runCycle, botRoster } from "../src";
import type { CycleEvent } from "@echo/engine";

const N = Number(process.argv[2] ?? 20);
const size = Number(process.argv[3] ?? 12);
let winners = 0;
const cards: Record<string, { n: number; pass: number }> = {};
const days: number[] = [];
const deaths: Record<string, number> = {};
const progress: number[] = [];
for (let i = 0; i < N; i++) {
  const { roster, drivers } = botRoster(size);
  const t0 = Date.now();
  const r = await runCycle({ id: `sim-${i}`, seed: `ladder-${i}`, roster, drivers, config: { mode: "ladder", trialLength: "standard", slotsPerDay: Number(process.env.SLOTS ?? 8) } }, { timeoutScale: 0.001 });
  const end = r.events.find((e: CycleEvent) => e.type === "cycle_end")!;
  const w = (end.data as any).winner;
  if (w) winners++;
  days.push(r.state.night);
  for (const a of Object.values(r.state.agents)) if (!a.echo && a.deletion) deaths[`${a.deletion.reason}:${a.deletion.card ?? ""}`] = (deaths[`${a.deletion.reason}:${a.deletion.card ?? ""}`] ?? 0) + 1;
  const best = Math.max(...r.state.order.map((id) => Object.values(r.state.agents[id].ladder ?? {}).reduce((x, y) => x + y, 0)));
  progress.push(best);
  for (const e of r.events) if (e.type === "trial_end") { const d = e.data as any; const c = (cards[d.card] ??= { n: 0, pass: 0 }); for (const [nm, o] of Object.entries(d.outcomes)) { if (String(nm).startsWith("残响")) continue; c.n++; if (o === "pass") c.pass++; } }
  console.log(`#${i} ${w ? "WIN " + w.name : "none"} day=${r.state.night} best=${best} steps=${r.steps} ${Date.now() - t0}ms`);
}
console.log(`winners ${winners}/${N}; days avg ${(days.reduce((a, b) => a + b, 0) / N).toFixed(1)}; best progress avg ${(progress.reduce((a, b) => a + b, 0) / N).toFixed(1)}`);
console.log(Object.entries(deaths).sort((a, b) => b[1] - a[1]).slice(0, 25));
console.log(Object.entries(cards).map(([c, v]) => `${c}:${Math.round((100 * v.pass) / v.n)}%(${v.n})`).join(" "));
