import * as tf from "@tensorflow/tfjs";
import { OBS_DIM } from "./env";
import { buildActorCritic, POLICY_HIDDEN } from "./nets";
import type { PolicyMetadata } from "./policyMetadata";

export { sanitizePolicyMetadata } from "./policyMetadata";
export type { PolicyMetadata } from "./policyMetadata";

export interface PolicyData {
  obsDim: number;
  hidden: number;
  metadata?: PolicyMetadata;
  weights: { shape: number[]; values: number[] }[];
}

export function serializePolicy(
  model: tf.LayersModel,
  metadata?: PolicyMetadata
): PolicyData {
  const weights = model.getWeights();
  const data: PolicyData = {
    obsDim: OBS_DIM,
    hidden: POLICY_HIDDEN,
    ...(metadata
      ? { metadata: { ...metadata, weightPrecisionDecimals: 4 } }
      : {}),
    weights: weights.map((tensor) => ({
      shape: [...tensor.shape],
      values: Array.from(
        tensor.dataSync(),
        (value) => Math.round(value * 10_000) / 10_000
      ),
    })),
  };
  return data;
}

export function loadPolicy(data: PolicyData): tf.LayersModel {
  if (
    !data ||
    data.obsDim !== OBS_DIM ||
    data.hidden !== POLICY_HIDDEN ||
    !Array.isArray(data.weights)
  ) {
    throw new Error("Unsupported policy format or network size");
  }

  const model = buildActorCritic(data.obsDim, data.hidden);
  const expected = model.getWeights();
  try {
    if (data.weights.length !== expected.length) {
      throw new Error("Policy weight count does not match the network");
    }
    let totalValues = 0;
    for (let i = 0; i < expected.length; i++) {
      const weight = data.weights[i];
      const shape = expected[i].shape;
      const expectedLength = shape.reduce((product, dimension) => product * dimension, 1);
      if (
        !Array.isArray(weight.values) ||
        weight.shape.length !== shape.length ||
        weight.shape.some((dimension, index) => dimension !== shape[index]) ||
        weight.values.length !== expectedLength
      ) {
        throw new Error(`Policy weight ${i} has an invalid shape`);
      }
      totalValues += weight.values.length;
      if (
        totalValues > 500_000 ||
        weight.values.some((value) => !Number.isFinite(value) || Math.abs(value) > 100)
      ) {
        throw new Error(`Policy weight ${i} contains invalid values`);
      }
    }

    const tensors = data.weights.map((weight) =>
      tf.tensor(weight.values, weight.shape, "float32")
    );
    try {
      model.setWeights(tensors);
    } finally {
      for (const tensor of tensors) tensor.dispose();
    }
    return model;
  } catch (error) {
    model.dispose();
    throw error;
  }
}
