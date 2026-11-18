import { trainPPO, type TrainProgress } from "../src/rl/algos/ppo";
import { evaluateHeuristic, evaluatePolicy } from "../src/rl/evaluate";
import { serializePolicy } from "../src/rl/policyIO";
import { writeFileSync } from "node:fs";

const iterations = Number(process.argv[2] ?? 100);
const envs = Number(process.argv[3] ?? 16);
const finalSeeds = Number(process.argv[4] ?? 200);
const bcEpisodes = Number(process.argv[5] ?? 120);
const bcEpochs = Number(process.argv[6] ?? 3);

const evalSeeds = Array.from({ length: 16 }, (_, index) => 777_000 + index);

function line(progress: TrainProgress): string {
  return [
    progress.phase.padEnd(7),
    `it ${String(progress.iteration).padStart(4)}`,
    `train $${progress.trainProfit.toFixed(1).padStart(6)}`,
    `eval ${progress.evalProfit === null ? "     -" : `$${progress.evalProfit.toFixed(1)}`}`,
    `greedy $${progress.greedyProfit.toFixed(1)}`,
    `ent ${progress.entropy.toFixed(2)}`,
    `${progress.elapsedSec.toFixed(1)}s`,
  ].join("  ");
}

const result = await trainPPO({
  iterations,
  envs,
  lr: 3e-4,
  gamma: 0.99,
  gaeLambda: 0.95,
  clip: 0.2,
  epochs: 4,
  minibatch: 128,
  entropyCoef: 0.01,
  valueCoef: 0.5,
  seed: 7,
  evalEvery: 10,
  evalSeeds: evalSeeds.length,
  bcEpisodes,
  bcEpochs,
  onBcEpoch: (epoch, loss) => {
    console.log(`bc epoch ${epoch + 1}/${bcEpochs} loss ${loss.toFixed(3)}`);
  },
  onProgress: (progress) => {
    if (
      progress.phase !== "ppo" ||
      progress.iteration % 10 === 0 ||
      progress.evalProfit !== null ||
      progress.iteration === progress.totalIterations
    ) {
      console.log(line(progress));
    }
  },
});

const seeds = Array.from({ length: finalSeeds }, (_, index) => 900_000 + index);
const policy = evaluatePolicy(result.model, seeds);
const greedy = evaluateHeuristic("greedy", seeds);

console.log(
  `\nfixed eval (${finalSeeds} games): policy $${policy.mean.toFixed(2)} +-${policy.std.toFixed(2)} | greedy $${greedy.mean.toFixed(2)} | diff ${(((policy.mean - greedy.mean) / Math.abs(greedy.mean)) * 100).toFixed(1)}%`
);
console.log(
  `best training eval $${result.bestEvalProfit.toFixed(2)} | iterations ${result.iterations} | ${result.elapsedSec.toFixed(1)}s`
);

writeFileSync(
  "tmp-policy.json",
  JSON.stringify(
    serializePolicy(result.model, {
      name: "Vending Wars PPO run",
      algorithm: "PPO + greedy-expert behavior cloning",
      trainedAt: new Date().toISOString(),
      training: {
        command: `bun run scripts/train-cli.ts ${iterations} ${envs} ${finalSeeds} ${bcEpisodes} ${bcEpochs}`,
        expertGames: bcEpisodes,
        expertCloningEpochs: bcEpochs,
        ppoIterations: iterations,
        parallelGames: envs,
        learningRate: 3e-4,
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
        heldOutSimulations: finalSeeds,
        meanProfit: policy.mean,
        standardDeviation: policy.std,
        greedyMeanProfit: greedy.mean,
        bestTrainingEvaluation: result.bestEvalProfit,
      },
    })
  )
);
console.log("wrote tmp-policy.json");
