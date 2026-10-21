/** Consistent-candidate Mastermind guesser for ♦6. */

function score(secret: string, guess: string): [number, number] {
  let exact = 0;
  const sc = new Array(10).fill(0);
  const gc = new Array(10).fill(0);
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) exact++;
    else {
      sc[secret.charCodeAt(i) - 48]++;
      gc[guess.charCodeAt(i) - 48]++;
    }
  }
  let partial = 0;
  for (let d = 0; d < 10; d++) partial += Math.min(sc[d], gc[d]);
  return [exact, partial];
}

export function mastermindGuess(length: number, guesses: Array<{ guess: string; exact: number; partial: number }>, rnd: () => number): string {
  const total = 10 ** length;
  // Start scanning at a random offset so different bots make different (still consistent) guesses.
  const start = Math.floor(rnd() * total);
  for (let k = 0; k < total; k++) {
    const c = String((start + k) % total).padStart(length, "0");
    let ok = true;
    for (const g of guesses) {
      const [e, p] = score(c, g.guess);
      if (e !== g.exact || p !== g.partial) {
        ok = false;
        break;
      }
    }
    if (ok) return c;
  }
  return "0".repeat(length);
}
