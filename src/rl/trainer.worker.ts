/// <reference lib="webworker" />
import * as tf from "@tensorflow/tfjs";
import pretrained from "../data/pretrained/ppo.json";
import { CONFIG } from "../sim/config";
import { ITEMS } from "../sim/items";
import { trainPPO, type TrainProgress } from "./algos/ppo";
import { actionFromPrediction, predictBatch } from "./nets";
import { OBS_DIM } from "./env";
import {
  loadPolicy,
  sanitizePolicyMetadata,
  serializePolicy,
  type PolicyData,
} from "./policyIO";
import type { WorkerRequest, WorkerResponse, WorkerTrainConfig } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

let model: tf.LayersModel | null = null;
let training = false;
let stopped = false;
let paused = false;
let pausePromise: Promise<void> | null = null;
let pauseResolve: (() => void) | null = null;

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

function waitIfPaused(): Promise<void> {
  if (!paused) return Promise.resolve();
  if (!pausePromise) {
    pausePromise = new Promise((resolve) => {
      pauseResolve = resolve;
    });
  }
  return pausePromise;
}

function resume(): void {
  paused = false;
  pauseResolve?.();
  pauseResolve = null;
  pausePromise = null;
}

function validateTrainConfig(config: WorkerTrainConfig): void {
  const integerRange = (value: number, min: number, max: number) =>
    Number.isInteger(value) && value >= min && value <= max;
  const finiteRange = (value: number, min: number, max: number) =>
    Number.isFinite(value) && value >= min && value <= max;
  if (
    !integerRange(config.iterations, 1, 2_000) ||
    !integerRange(config.envs, 1, 32) ||
    !finiteRange(config.lr, 1e-6, 1e-2) ||
    !finiteRange(config.gamma, 0, 1) ||
    !finiteRange(config.gaeLambda, 0, 1) ||
    !finiteRange(config.clip, 0.01, 1) ||
    !integerRange(config.epochs, 1, 10) ||
    !integerRange(config.minibatch, 8, 512) ||
    !finiteRange(config.entropyCoef, 0, 1) ||
    !finiteRange(config.valueCoef, 0, 10) ||
    !Number.isSafeInteger(config.seed) ||
    !integerRange(config.evalEvery, 1, 100) ||
    !integerRange(config.evalSeeds, 1, 256) ||
    !integerRange(config.bcEpisodes, 0, 2_000) ||
    !integerRange(config.bcEpochs, 0, 30) ||
    typeof config.policyName !== "string" ||
    config.policyName.trim().length === 0 ||
    config.policyName.length > 40 ||
    config.policyName.toLowerCase() === "bundled ppo" ||
    config.policyName.toLowerCase() === "__bundled_ppo__"
  ) {
    throw new Error("Training settings are outside supported limits");
  }
}

async function init(): Promise<void> {
  await tf.setBackend("cpu");
  await tf.ready();
  try {
    model = loadPolicy(pretrained as unknown as PolicyData);
    post({
      type: "ready",
      hasModel: true,
      metadata: sanitizePolicyMetadata(
        (pretrained as unknown as PolicyData).metadata
      ),
    });
  } catch (error) {
    post({ type: "ready", hasModel: false });
    post({ type: "error", message: `Pretrained agent failed to load: ${error}` });
  }
}

void init();

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === "train") {
    if (training) {
      post({ type: "error", message: "Training is already running" });
      return;
    }
    training = true;
    stopped = false;
    resume();
    try {
      validateTrainConfig(message.config);
      const { policyName, ...trainConfig } = message.config;
      const result = await trainPPO({
        ...trainConfig,
        control: {
          get stopped() {
            return stopped;
          },
          waitIfPaused,
        },
        onProgress: (progress: TrainProgress) =>
          post({ type: "progress", progress }),
        onBcEpoch: (epoch, loss) => post({ type: "bc", epoch, loss }),
      });
      const previousModel = model;
      model = result.model;
      previousModel?.dispose();
      const policy = serializePolicy(model, {
        name: policyName,
        algorithm: "PPO + greedy-expert behavior cloning",
        trainedAt: new Date().toISOString(),
        training: {
          expertGames: trainConfig.bcEpisodes,
          expertCloningEpochs: trainConfig.bcEpochs,
          ppoIterations: result.iterations,
          parallelGames: trainConfig.envs,
          learningRate: trainConfig.lr,
          gamma: trainConfig.gamma,
          gaeLambda: trainConfig.gaeLambda,
          clip: trainConfig.clip,
          epochsPerUpdate: trainConfig.epochs,
          minibatch: trainConfig.minibatch,
          entropyCoefficient: trainConfig.entropyCoef,
          valueCoefficient: trainConfig.valueCoef,
          seed: trainConfig.seed,
        },
        evaluation: {
          fixedEvaluationMeanProfit: result.bestEvalProfit,
          fixedEvaluationSimulations: trainConfig.evalSeeds,
          greedyExpertMeanProfit: result.greedyProfit,
        },
      });
      post({
        type: "done",
        result: {
          bestEvalProfit: result.bestEvalProfit,
          evalProfit: result.evalProfit,
          greedyProfit: result.greedyProfit,
          iterations: result.iterations,
          elapsedSec: result.elapsedSec,
          policyName,
          policy,
        },
      });
    } catch (error) {
      post({ type: "error", message: `Training failed: ${error}` });
    } finally {
      training = false;
    }
    return;
  }

  if (message.type === "pause") {
    paused = true;
    post({ type: "paused" });
    return;
  }

  if (message.type === "resume") {
    resume();
    post({ type: "resumed" });
    return;
  }

  if (message.type === "stop") {
    stopped = true;
    resume();
    post({ type: "stopping" });
    return;
  }

  if (message.type === "load-pretrained") {
    try {
      const next = loadPolicy(pretrained as unknown as PolicyData);
      model?.dispose();
      model = next;
      post({
        type: "policy-loaded",
        name: "Bundled PPO",
        metadata: sanitizePolicyMetadata(
          (pretrained as unknown as PolicyData).metadata
        ),
      });
    } catch (error) {
      post({ type: "error", message: `Pretrained agent failed to load: ${error}` });
    }
    return;
  }

  if (message.type === "load-policy") {
    try {
      if (!message.name.trim() || message.name.length > 40) {
        throw new Error("Saved policy name is invalid");
      }
      const next = loadPolicy(message.policy);
      model?.dispose();
      model = next;
      post({
        type: "policy-loaded",
        name: message.name,
        metadata: sanitizePolicyMetadata(message.policy.metadata),
      });
    } catch (error) {
      post({ type: "error", message: `Saved policy failed to load: ${error}` });
    }
    return;
  }

  if (message.type === "decide") {
    if (!model) {
      post({ type: "decision", action: null, error: "No trained agent" });
      return;
    }
    try {
      if (
        !(message.obs instanceof Float32Array) ||
        message.obs.length !== OBS_DIM ||
        !message.obs.every(Number.isFinite) ||
        !Array.isArray(message.existing) ||
        message.existing.length !== ITEMS.length ||
        !message.existing.every((entry) => typeof entry === "boolean") ||
        !Number.isInteger(message.freeSlots) ||
        message.freeSlots < 0 ||
        message.freeSlots > CONFIG.SLOTS ||
        message.existing.filter(Boolean).length + message.freeSlots !== CONFIG.SLOTS
      ) {
        throw new Error("Invalid agent observation or action mask");
      }
      const prediction = predictBatch(model, message.obs, 1);
      const action = actionFromPrediction(
        prediction,
        0,
        { existing: message.existing, freeSlots: message.freeSlots },
        () => 0,
        true
      );
      post({ type: "decision", action });
    } catch (error) {
      post({ type: "decision", action: null, error: String(error) });
    }
  }
};
