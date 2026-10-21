/** Parse and brute-force the ♦3 knights & knaves statements produced by the engine. */

type Role = "knight" | "knave";

export function solveKnightsText(people: string[], statements: string[]): Role[][] {
  const n = people.length;
  const idx = (name: string) => people.indexOf(name);
  type Pred = (r: Role[]) => boolean;
  const parsed: Array<{ speaker: number; pred: Pred }> = [];
  for (const line of statements) {
    const m = line.match(/^(.+?)说：「(.+)」$/);
    if (!m) continue;
    const speaker = idx(m[1]);
    const body = m[2];
    let pred: Pred | null = null;
    let mm: RegExpMatchArray | null;
    if ((mm = body.match(/^(.+?)和(.+?)不是同一种人。$/))) {
      const a = idx(mm[1]);
      const b = idx(mm[2]);
      pred = (r) => r[a] !== r[b];
    } else if ((mm = body.match(/^(.+?)和(.+?)是同一种人。$/))) {
      const a = idx(mm[1]);
      const b = idx(mm[2]);
      pred = (r) => r[a] === r[b];
    } else if ((mm = body.match(/^(.+?)是说(真|假)话的人。$/))) {
      const a = idx(mm[1]);
      const role: Role = mm[2] === "真" ? "knight" : "knave";
      pred = (r) => r[a] === role;
    } else if (/至少有一个人说假话/.test(body)) {
      pred = (r) => r.includes("knave");
    } else if ((mm = body.match(/恰好有\s*(\d+)\s*个人说真话/))) {
      const k = Number(mm[1]);
      pred = (r) => r.filter((x) => x === "knight").length === k;
    }
    if (speaker >= 0 && pred) parsed.push({ speaker, pred });
  }
  const out: Role[][] = [];
  for (let m = 0; m < 1 << n; m++) {
    const r: Role[] = Array.from({ length: n }, (_, i) => ((m >> i) & 1 ? "knave" : "knight"));
    if (parsed.every(({ speaker, pred }) => pred(r) === (r[speaker] === "knight"))) out.push(r);
  }
  return out;
}
