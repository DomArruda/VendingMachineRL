import { readFileSync, writeFileSync } from "node:fs";

const path = "src/data/pretrained/ppo.json";
const data = JSON.parse(readFileSync(path, "utf8")) as {
  obsDim: number;
  hidden: number;
  metadata?: Record<string, unknown>;
  weights: { values: number[] }[];
};
data.metadata ??= {
  name: "Vending Wars bundled PPO",
  algorithm: "PPO + greedy-expert behavior cloning",
  trainedAt: "2026-11-17",
  training: {
    command: "bun run scripts/train-cli.ts 100 16 50 150 5",
    expertWarmStart: "greedyExpectedProfit behavior cloning",
    expertGames: 150,
    expertCloningEpochs: 5,
    ppoIterations: 100,
    parallelGames: 16,
    learningRate: 0.0003,
    gamma: 0.99,
    gaeLambda: 0.95,
    clip: 0.2,
    epochsPerUpdate: 4,
    minibatch: 128,
    entropyCoefficient: 0.01,
    valueCoefficient: 0.5,
    seed: 7,
  },
  evaluation: {
    bestCheckpointProfitOn16FixedSimulations: 96.92,
    heldOutSimulations: 50,
    heldOutMeanProfit: 99.3,
    heldOutProfitStdDev: 11.48,
    greedyExpertMeanProfit: 125.48,
  },
  weightPrecisionDecimals: 4,
};
for (const weight of data.weights) {
  weight.values = weight.values.map((value) => Math.round(value * 10000) / 10000);
}
writeFileSync(path, JSON.stringify(data));
console.log("quantized", path);
console.log(JSON.stringify(data.metadata, null, 2));
