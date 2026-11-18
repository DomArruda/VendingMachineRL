import type { PPOTrainConfig, TrainProgress } from "./algos/ppo";
import type { RLAction } from "./action";
import type { PolicyData, PolicyMetadata } from "./policyIO";

export type WorkerTrainConfig = Omit<
  PPOTrainConfig,
  "onProgress" | "control" | "onBcEpoch"
> & { policyName: string };

export type WorkerRequest =
  | { type: "train"; config: WorkerTrainConfig }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "load-pretrained" }
  | { type: "load-policy"; name: string; policy: PolicyData }
  | {
      type: "decide";
      obs: Float32Array;
      existing: boolean[];
      freeSlots: number;
    };

export interface WorkerDoneResult {
  bestEvalProfit: number;
  evalProfit: number;
  greedyProfit: number;
  iterations: number;
  elapsedSec: number;
  policyName: string;
  policy: PolicyData;
}

export type WorkerResponse =
  | { type: "ready"; hasModel: boolean; metadata?: PolicyMetadata }
  | { type: "policy-loaded"; name: string; metadata?: PolicyMetadata }
  | { type: "progress"; progress: TrainProgress }
  | { type: "bc"; epoch: number; loss: number }
  | { type: "done"; result: WorkerDoneResult }
  | { type: "decision"; action: RLAction | null; error?: string }
  | { type: "error"; message: string }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "stopping" };
