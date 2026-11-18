import * as tf from "@tensorflow/tfjs";
import { ITEMS } from "../sim/items";
import { OBS_DIM } from "./env";
import {
  RL_PRICE_LEVELS,
  RL_QTY_LEVELS,
  STOCK_CHOICES,
  type ActionContext,
  type RLAction,
} from "./action";
import { sampleAction } from "./action";

export const QTY_UNITS = ITEMS.length * RL_QTY_LEVELS.length;
export const PRICE_UNITS = ITEMS.length * RL_PRICE_LEVELS.length;

export const POLICY_HIDDEN = 128;

export function buildActorCritic(
  obsDim: number = OBS_DIM,
  hidden = POLICY_HIDDEN
): tf.LayersModel {
  const input = tf.input({ shape: [obsDim] });
  const h1 = tf.layers
    .dense({
      units: hidden,
      activation: "tanh",
      kernelInitializer: "glorotNormal",
    })
    .apply(input);
  const h2 = tf.layers
    .dense({ units: hidden, activation: "tanh" })
    .apply(h1);
  const stock = tf.layers
    .dense({ units: STOCK_CHOICES })
    .apply(h2) as tf.SymbolicTensor;
  const qty = tf.layers
    .reshape({ targetShape: [ITEMS.length, RL_QTY_LEVELS.length] })
    .apply(
      tf.layers.dense({ units: QTY_UNITS }).apply(h2) as tf.SymbolicTensor
    ) as tf.SymbolicTensor;
  const price = tf.layers
    .reshape({ targetShape: [ITEMS.length, RL_PRICE_LEVELS.length] })
    .apply(
      tf.layers.dense({ units: PRICE_UNITS }).apply(h2) as tf.SymbolicTensor
    ) as tf.SymbolicTensor;
  const value = tf.layers.dense({ units: 1 }).apply(h2) as tf.SymbolicTensor;
  const model = tf.model({ inputs: input, outputs: [stock, qty, price, value] });
  applyPolicyPrior(model);
  return model;
}

export function applyPolicyPrior(model: tf.LayersModel): void {
  for (const layer of model.layers) {
    const weights = layer.getWeights();
    if (weights.length < 2 || weights[0].shape.length !== 2) continue;
    if (weights[0].shape[1] !== PRICE_UNITS) continue;
    const bias = new Float32Array(PRICE_UNITS);
    for (let i = 0; i < ITEMS.length; i++) {
      bias[i * RL_PRICE_LEVELS.length + 2] = 3;
    }
    const kernel = tf.zeros(weights[0].shape);
    const biasTensor = tf.tensor1d(bias);
    layer.setWeights([kernel, biasTensor]);
    kernel.dispose();
    biasTensor.dispose();
  }
}

export interface BatchPrediction {
  stockLogits: number[][];
  qtyLogits: number[][][];
  priceLogits: number[][][];
  values: number[];
}

export function predictBatch(
  model: tf.LayersModel,
  obs: Float32Array,
  batchSize: number
): BatchPrediction {
  return tf.tidy(() => {
    const input = tf.tensor2d(obs, [batchSize, OBS_DIM]);
    const outputs = model.predict(input) as tf.Tensor[];
    const [stock, qty, price, value] = outputs;
    return {
      stockLogits: stock.arraySync() as number[][],
      qtyLogits: qty.arraySync() as number[][][],
      priceLogits: price.arraySync() as number[][][],
      values: (value.arraySync() as number[][]).map((row) => row[0]),
    };
  });
}

export function actionFromPrediction(
  prediction: BatchPrediction,
  index: number,
  context: ActionContext,
  rng: () => number,
  deterministic: boolean
): RLAction {
  return sampleAction(
    prediction.stockLogits[index],
    prediction.qtyLogits[index].flat(),
    prediction.priceLogits[index].flat(),
    context,
    rng,
    deterministic
  );
}
