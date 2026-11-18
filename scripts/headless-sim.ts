import { playEpisode } from "../src/sim/game";
import {
  HEURISTICS,
  chooseHeuristic,
  type HeuristicName,
} from "../src/sim/heuristics";

const seedCount = Number(process.argv[2] ?? 10000);

interface Row {
  name: HeuristicName;
  mean: number;
  std: number;
}

const rows: Row[] = [];

for (const name of HEURISTICS) {
  let sum = 0;
  let sumSq = 0;
  for (let seed = 0; seed < seedCount; seed++) {
    const profit = playEpisode(seed, (game) => chooseHeuristic(name, game)).profit;
    sum += profit;
    sumSq += profit * profit;
  }
  const mean = sum / seedCount;
  const variance = Math.max(0, sumSq / seedCount - mean * mean);
  rows.push({ name, mean, std: Math.sqrt(variance) });
}

rows.sort((a, b) => b.mean - a.mean);
const best = rows[0];
const worst = rows[rows.length - 1];

console.log(`\n${seedCount} simulated games (15 days each)\n`);
console.log(
  "heuristic".padEnd(14) +
    "mean".padStart(10) +
    "std".padStart(10) +
    "vs best".padStart(11)
);
for (const row of rows) {
  const gap = ((best.mean - row.mean) / Math.abs(best.mean)) * 100;
  console.log(
    row.name.padEnd(14) +
      `$${row.mean.toFixed(2)}`.padStart(10) +
      `$${row.std.toFixed(2)}`.padStart(10) +
      `${row === best ? "-" : `${gap.toFixed(1)}%`}`.padStart(11)
  );
}

const greedy = rows.find((row) => row.name === "greedy")!;
const naive = rows.filter((row) => row.name !== "greedy");
const minGap = Math.min(
  ...naive.map((row) => (greedy.mean - row.mean) / Math.abs(greedy.mean))
);
const spread = best.mean - worst.mean;
const stdOk = Math.max(...rows.map((row) => row.std)) < spread;

console.log(`\ngreedy best?          ${greedy === best ? "yes" : "NO"}`);
console.log(`smallest gap to greedy ${(minGap * 100).toFixed(1)}% (need >= 5%)`);
console.log(
  `max std $${Math.max(...rows.map((row) => row.std)).toFixed(2)} vs mean spread $${spread.toFixed(
    2
  )} (want std below spread): ${stdOk ? "ok" : "NO"}`
);
console.log(
  minGap >= 0.05 && greedy === best
    ? "\nPhase 1 gate: PASS\n"
    : "\nPhase 1 gate: FAIL\n"
);
