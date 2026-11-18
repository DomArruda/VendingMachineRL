import * as tf from "@tensorflow/tfjs";
import { OBS_DIM } from "./env";
import { buildActorCritic, POLICY_HIDDEN } from "./nets";

export interface PolicyData {
  obsDim: number;
  hidden: number;
  metadata?: {
    name: string;
    algorithm: string;
    trainedAt: string;
    training: Record<string, string | number>;
    evaluation: Record<string, string | number>;
    weightPrecision?: number;
  };
  weights: { shape: number[]; values: number[] }[];
}

export function serializePolicy(
  model: tf.LayersModel,
  metadata?: PolicyData["metadata"]
): PolicyData {
  return {
    obsDim: OBS_DIM,
    hidden: POLICY_HIDDEN,
    ...(metadata ? { metadata } : {}),
    weights: model.getWeights().map((tensor) => ({
      shape: [...tensor.shape],
      values: Array.from(tensor.dataSync()),
    })),
  };
}

export function loadPolicy(data: PolicyData): tf.LayersModel {
  const model = buildActorCritic(data.obsDim, data.hidden ?? POLICY_HIDDEN);
  const tensors = data.weights.map((weight) =>
    tf.tensor(weight.values, weight.shape, "float32")
  );
  model.setWeights(tensors);
  for (const tensor of tensors) tensor.dispose();
  return model;
}
