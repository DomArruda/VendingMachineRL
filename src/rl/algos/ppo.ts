import * as tf from "@tensorflow/tfjs";
import { CONFIG } from "../../sim/config";
import { currentWholesale } from "../../sim/game";
import { chooseHeuristic } from "../../sim/heuristics";
import { hashSeed, mulberry32 } from "../../sim/rng";
import {
  targetActionFromDecision,
} from "../action";
import { evaluateHeuristic, evaluatePolicy } from "../evaluate";
import { OBS_DIM, VendingEnv } from "../env";
import {
  actionFromPrediction,
  buildActorCritic,
  predictBatch,
} from "../nets";
import {
  disposeBatchTensors,
  makeBatch,
  makeBatchTensors,
  policyEntropy,
  policyLogProbs,
  type BatchTensors,
  type PolicyTensors,
  type Sample,
} from "./batch";

export interface TrainControl {
  stopped: boolean;
  waitIfPaused: () => Promise<void>;
}

export interface TrainProgress {
  phase: "teacher" | "bc" | "ppo";
  iteration: number;
  totalIterations: number;
  trainProfit: number;
  evalProfit: number | null;
  greedyProfit: number;
  entropy: number;
  elapsedSec: number;
  bestEvalProfit: number;
}

export interface PPOTrainConfig {
  iterations: number;
  envs: number;
  lr: number;
  gamma: number;
  gaeLambda: number;
  clip: number;
  epochs: number;
  minibatch: number;
  entropyCoef: number;
  valueCoef: number;
  seed: number;
  evalEvery: number;
  evalSeeds: number;
  bcEpisodes: number;
  bcEpochs: number;
  onProgress?: (progress: TrainProgress) => void;
  onBcEpoch?: (epoch: number, loss: number) => void;
  control?: TrainControl;
}

export interface PPOTrainResult {
  model: tf.LayersModel;
  bestEvalProfit: number;
  evalProfit: number;
  greedyProfit: number;
  iterations: number;
  elapsedSec: number;
}

interface WeightSnapshot {
  shapes: number[][];
  values: Float32Array[];
}

function snapshotWeights(model: tf.LayersModel): WeightSnapshot {
  const weights = model.getWeights();
  return {
    shapes: weights.map((weight) => [...weight.shape]),
    values: weights.map((weight) => Float32Array.from(weight.dataSync())),
  };
}

function restoreWeights(model: tf.LayersModel, snapshot: WeightSnapshot): void {
  const tensors = snapshot.values.map((values, index) =>
    tf.tensor(values, snapshot.shapes[index], "float32")
  );
  model.setWeights(tensors);
  for (const tensor of tensors) tensor.dispose();
}

function shuffle<T>(values: T[], rng: () => number): void {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
}

function gatherPolicyTensors(
  tensors: BatchTensors,
  indices: tf.Tensor1D
): PolicyTensors {
  return {
    stockMasks: tf.gather(tensors.stockMasks, indices) as tf.Tensor3D,
    stockActions: tf.gather(tensors.stockActions, indices) as tf.Tensor2D,
    stockStepMask: tf.gather(tensors.stockStepMask, indices) as tf.Tensor2D,
    qtyMasks: tf.gather(tensors.qtyMasks, indices) as tf.Tensor3D,
    qtyActions: tf.gather(tensors.qtyActions, indices) as tf.Tensor2D,
    priceActions: tf.gather(tensors.priceActions, indices) as tf.Tensor2D,
    activeMasks: tf.gather(tensors.activeMasks, indices) as tf.Tensor2D,
  };
}

function collectTeacher(episodes: number, seedBase: number): Sample[] {
  const samples: Sample[] = [];
  for (let episode = 0; episode < episodes; episode++) {
    const env = new VendingEnv(seedBase + episode);
    while (!env.done) {
      const context = env.actionContext();
      const decision = chooseHeuristic("greedy", env.game);
      const action = targetActionFromDecision(
        decision,
        context,
        env.game.machine,
        currentWholesale(env.game)
      );
      samples.push({ obs: env.observe(), action });
      env.step(action);
    }
  }
  return samples;
}

async function behaviorClone(
  model: tf.LayersModel,
  samples: readonly Sample[],
  epochs: number,
  minibatch: number,
  seed: number,
  onEpoch?: (epoch: number, loss: number) => void
): Promise<void> {
  if (samples.length === 0) return;
  const batch = makeBatch(samples);
  const tensors = makeBatchTensors(batch);
  const optimizer = tf.train.adam(1e-3);
  const indices = Array.from({ length: samples.length }, (_, index) => index);
  const rng = mulberry32(hashSeed(seed, "bc"));

  for (let epoch = 0; epoch < epochs; epoch++) {
    shuffle(indices, rng);
    let epochLoss = 0;
    let batches = 0;
    for (let start = 0; start < indices.length; start += minibatch) {
      const idx = indices.slice(start, start + minibatch);
      const idxT = tf.tensor1d(idx, "int32");
      const cost = optimizer.minimize(() => {
        const obsBatch = tf.gather(tensors.obs, idxT);
        const policyTensors = gatherPolicyTensors(tensors, idxT);
        const [stock, qty, price] = model.apply(obsBatch) as tf.Tensor[];
        const logProb = policyLogProbs(stock, qty, price, policyTensors);
        return tf.neg(tf.mean(logProb)) as tf.Scalar;
      }, true);
      if (cost) {
        epochLoss += cost.dataSync()[0];
        cost.dispose();
        batches++;
      }
      idxT.dispose();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    onEpoch?.(epoch, batches > 0 ? epochLoss / batches : 0);
  }

  disposeBatchTensors(tensors);
}

interface Rollout {
  samples: Sample[];
  rewards: Float32Array;
  values: Float32Array;
  advantages: Float32Array;
  returns: Float32Array;
  meanProfit: number;
}

function collectRollout(
  model: tf.LayersModel,
  envs: VendingEnv[],
  seed: number,
  iteration: number,
  gamma: number,
  gaeLambda: number
): Rollout {
  const count = envs.length;
  const samplesByEnv: Sample[][] = envs.map(() => []);
  const rewardsByEnv: number[][] = envs.map(() => []);
  const valuesByEnv: number[][] = envs.map(() => []);
  const profits = new Array<number>(count).fill(0);
  const rng = mulberry32(hashSeed(seed, "rollout", iteration));

  for (let day = 0; day < CONFIG.DAYS; day++) {
    const obsData = new Float32Array(count * OBS_DIM);
    for (let i = 0; i < count; i++) {
      obsData.set(envs[i].observe(), i * OBS_DIM);
    }
    const prediction = predictBatch(model, obsData, count);
    for (let i = 0; i < count; i++) {
      const action = actionFromPrediction(
        prediction,
        i,
        envs[i].actionContext(),
        rng,
        false
      );
      const obs = obsData.slice(i * OBS_DIM, (i + 1) * OBS_DIM);
      samplesByEnv[i].push({ obs, action });
      valuesByEnv[i].push(prediction.values[i]);
      const stepped = envs[i].step(action);
      rewardsByEnv[i].push(stepped.reward);
      profits[i] += stepped.info.stats.profit;
    }
  }

  const samples: Sample[] = [];
  const rewards = new Float32Array(count * CONFIG.DAYS);
  const values = new Float32Array(count * CONFIG.DAYS);
  const advantages = new Float32Array(count * CONFIG.DAYS);
  const returns = new Float32Array(count * CONFIG.DAYS);

  let cursor = 0;
  for (let i = 0; i < count; i++) {
    let gae = 0;
    for (let t = CONFIG.DAYS - 1; t >= 0; t--) {
      const index = cursor + t;
      const nextValue = t === CONFIG.DAYS - 1 ? 0 : valuesByEnv[i][t + 1];
      const delta =
        rewardsByEnv[i][t] + gamma * nextValue - valuesByEnv[i][t];
      gae = delta + gamma * gaeLambda * gae;
      advantages[index] = gae;
      returns[index] = gae + valuesByEnv[i][t];
      samples.push(samplesByEnv[i][t]);
      rewards[index] = rewardsByEnv[i][t];
      values[index] = valuesByEnv[i][t];
    }
    cursor += CONFIG.DAYS;
  }

  let sum = 0;
  let sumSq = 0;
  for (const value of advantages) {
    sum += value;
    sumSq += value * value;
  }
  const mean = sum / advantages.length;
  const variance = Math.max(0, sumSq / advantages.length - mean * mean);
  const std = Math.sqrt(variance) || 1;
  for (let i = 0; i < advantages.length; i++) {
    advantages[i] = (advantages[i] - mean) / std;
  }

  return {
    samples,
    rewards,
    values,
    advantages,
    returns,
    meanProfit:
      profits.reduce((total, profit) => total + profit, 0) / profits.length,
  };
}

function ppoUpdate(
  model: tf.LayersModel,
  optimizer: tf.Optimizer,
  rollout: Rollout,
  config: PPOTrainConfig,
  iteration: number
): number {
  const batch = makeBatch(rollout.samples);
  const tensors = makeBatchTensors(batch);

  const [oldLogProbT, entropyT] = tf.tidy(() => {
    const [stock, qty, price] = model.apply(tensors.obs) as tf.Tensor[];
    return [
      policyLogProbs(stock, qty, price, tensors),
      policyEntropy(stock, qty, price, tensors),
    ] as [tf.Tensor1D, tf.Scalar];
  });
  const oldLogProb = tf.tensor1d(oldLogProbT.dataSync());
  const entropy = entropyT.dataSync()[0];
  oldLogProbT.dispose();
  entropyT.dispose();

  const advantageT = tf.tensor1d(rollout.advantages);
  const returnT = tf.tensor1d(rollout.returns);
  const indices = Array.from({ length: batch.size }, (_, index) => index);
  const rng = mulberry32(hashSeed(config.seed, "ppo", iteration));

  for (let epoch = 0; epoch < config.epochs; epoch++) {
    shuffle(indices, rng);
    for (let start = 0; start < indices.length; start += config.minibatch) {
      const idx = indices.slice(start, start + config.minibatch);
      const idxT = tf.tensor1d(idx, "int32");
      const cost = optimizer.minimize(() => {
        const obsBatch = tf.gather(tensors.obs, idxT);
        const policyTensors = gatherPolicyTensors(tensors, idxT);
        const [stock, qty, price, value] = model.apply(obsBatch) as tf.Tensor[];
        const logProb = policyLogProbs(stock, qty, price, policyTensors);
        const oldProb = tf.gather(oldLogProb, idxT);
        const advantage = tf.gather(advantageT, idxT);
        const target = tf.gather(returnT, idxT);

        const ratio = tf.exp(tf.sub(logProb, oldProb));
        const clipped = tf.clipByValue(
          ratio,
          1 - config.clip,
          1 + config.clip
        );
        const surrogate = tf.minimum(
          tf.mul(ratio, advantage),
          tf.mul(clipped, advantage)
        );
        const policyLoss = tf.neg(tf.mean(surrogate));
        const valueLoss = tf.mean(
          tf.square(tf.sub(tf.squeeze(value, [1]), target))
        );
        const entropyLoss = policyEntropy(stock, qty, price, policyTensors);
        return tf.sub(
          tf.add(policyLoss, tf.mul(config.valueCoef, valueLoss)),
          tf.mul(config.entropyCoef, entropyLoss)
        ) as tf.Scalar;
      }, true);
      cost?.dispose();
      idxT.dispose();
    }
  }

  oldLogProb.dispose();
  advantageT.dispose();
  returnT.dispose();
  disposeBatchTensors(tensors);
  return entropy;
}

export async function trainPPO(
  config: PPOTrainConfig
): Promise<PPOTrainResult> {
  await tf.setBackend("cpu");
  await tf.ready();
  const startedAt = Date.now();

  const model = buildActorCritic();
  const evalSeeds = Array.from(
    { length: config.evalSeeds },
    (_, index) => config.seed + 100_000 + index
  );
  const greedy = evaluateHeuristic("greedy", evalSeeds);

  let bestEval = -Infinity;
  let bestSnapshot: WeightSnapshot | null = null;
  let evalProfit: number | null = null;

  if (config.bcEpisodes > 0) {
    config.onProgress?.({
      phase: "teacher",
      iteration: 0,
      totalIterations: config.iterations,
      trainProfit: 0,
      evalProfit: null,
      greedyProfit: greedy.mean,
      entropy: 0,
      elapsedSec: (Date.now() - startedAt) / 1000,
      bestEvalProfit: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const teacher = collectTeacher(
      config.bcEpisodes,
      config.seed + 500_000
    );
    config.onProgress?.({
      phase: "bc",
      iteration: 0,
      totalIterations: config.iterations,
      trainProfit: 0,
      evalProfit: null,
      greedyProfit: greedy.mean,
      entropy: 0,
      elapsedSec: (Date.now() - startedAt) / 1000,
      bestEvalProfit: 0,
    });
    await behaviorClone(
      model,
      teacher,
      config.bcEpochs,
      config.minibatch,
      config.seed,
      config.onBcEpoch
    );
  }

  if (evalSeeds.length > 0) {
    const initialEval = evaluatePolicy(model, evalSeeds);
    evalProfit = initialEval.mean;
    bestEval = initialEval.mean;
    bestSnapshot = snapshotWeights(model);
    config.onProgress?.({
      phase: "bc",
      iteration: 0,
      totalIterations: config.iterations,
      trainProfit: 0,
      evalProfit: initialEval.mean,
      greedyProfit: greedy.mean,
      entropy: 0,
      elapsedSec: (Date.now() - startedAt) / 1000,
      bestEvalProfit: bestEval,
    });
  }

  const optimizer = tf.train.adam(config.lr);
  const envs = Array.from(
    { length: config.envs },
    (_, index) => new VendingEnv(config.seed + 10_000 + index)
  );
  const trainingBase = config.seed + 10_000;
  let completed = 0;

  for (let iteration = 1; iteration <= config.iterations; iteration++) {
    if (config.control) {
      await config.control.waitIfPaused();
      if (config.control.stopped) break;
    }
    for (let i = 0; i < envs.length; i++) {
      envs[i].reset(trainingBase + (iteration - 1) * config.envs + i);
    }

    const rollout = collectRollout(
      model,
      envs,
      config.seed,
      iteration,
      config.gamma,
      config.gaeLambda
    );
    const entropy = ppoUpdate(
      model,
      optimizer,
      rollout,
      config,
      iteration
    );
    completed = iteration;

    let currentEval: number | null = null;
    const shouldEval =
      iteration % config.evalEvery === 0 || iteration === config.iterations;
    if (shouldEval && evalSeeds.length > 0) {
      const result = evaluatePolicy(model, evalSeeds);
      currentEval = result.mean;
      evalProfit = result.mean;
      if (result.mean > bestEval) {
        bestEval = result.mean;
        bestSnapshot = snapshotWeights(model);
      }
    }

    config.onProgress?.({
      phase: "ppo",
      iteration,
      totalIterations: config.iterations,
      trainProfit: rollout.meanProfit,
      evalProfit: currentEval,
      greedyProfit: greedy.mean,
      entropy,
      elapsedSec: (Date.now() - startedAt) / 1000,
      bestEvalProfit: bestEval,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (bestSnapshot) {
    restoreWeights(model, bestSnapshot);
    evalProfit = bestEval;
  } else if (evalProfit === null) {
    const result = evaluatePolicy(model, evalSeeds);
    evalProfit = result.mean;
    bestEval = result.mean;
  }

  return {
    model,
    bestEvalProfit: bestEval,
    evalProfit: evalProfit ?? bestEval,
    greedyProfit: greedy.mean,
    iterations: completed,
    elapsedSec: (Date.now() - startedAt) / 1000,
  };
}
