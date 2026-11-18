/// <reference lib="webworker" />
import * as tf from "@tensorflow/tfjs";
import pretrained from "../data/pretrained/ppo.json";
import { trainPPO, type TrainProgress } from "./algos/ppo";
import { actionFromPrediction, predictBatch } from "./nets";
import { loadPolicy, type PolicyData } from "./policyIO";
import type { WorkerRequest, WorkerResponse } from "./protocol";

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

async function init(): Promise<void> {
  await tf.setBackend("cpu");
  await tf.ready();
  try {
    model = loadPolicy(pretrained as unknown as PolicyData);
    post({ type: "ready", hasModel: true });
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
      const result = await trainPPO({
        ...message.config,
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
      model = result.model;
      post({
        type: "done",
        result: {
          bestEvalProfit: result.bestEvalProfit,
          evalProfit: result.evalProfit,
          greedyProfit: result.greedyProfit,
          iterations: result.iterations,
          elapsedSec: result.elapsedSec,
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

  if (message.type === "decide") {
    if (!model) {
      post({ type: "decision", action: null, error: "No trained agent" });
      return;
    }
    try {
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
