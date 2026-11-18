import * as tf from "@tensorflow/tfjs";
import { ITEMS } from "../../sim/items";
import {
  MAX_PICKS,
  RL_PRICE_LEVELS,
  RL_QTY_LEVELS,
  RL_STOP,
  STOCK_CHOICES,
  type RLAction,
} from "../action";
import { OBS_DIM } from "../env";

export interface Sample {
  obs: Float32Array;
  action: RLAction;
}

export interface BatchArrays {
  size: number;
  obs: Float32Array;
  stockMasks: Float32Array;
  stockActions: Int32Array;
  stockStepMask: Float32Array;
  qtyMasks: Float32Array;
  qtyActions: Int32Array;
  priceActions: Int32Array;
  activeMasks: Float32Array;
}

export interface PolicyTensors {
  stockMasks: tf.Tensor3D;
  stockActions: tf.Tensor2D;
  stockStepMask: tf.Tensor2D;
  qtyMasks: tf.Tensor3D;
  qtyActions: tf.Tensor2D;
  priceActions: tf.Tensor2D;
  activeMasks: tf.Tensor2D;
}

export interface BatchTensors extends PolicyTensors {
  obs: tf.Tensor2D;
}

const DISALLOW = -1e9;

export function makeBatch(samples: readonly Sample[]): BatchArrays {
  const size = samples.length;
  const obs = new Float32Array(size * OBS_DIM);
  const stockMasks = new Float32Array(size * MAX_PICKS * STOCK_CHOICES);
  const stockActions = new Int32Array(size * MAX_PICKS);
  const stockStepMask = new Float32Array(size * MAX_PICKS);
  const qtyMasks = new Float32Array(size * ITEMS.length * 3);
  const qtyActions = new Int32Array(size * ITEMS.length);
  const priceActions = new Int32Array(size * ITEMS.length);
  const activeMasks = new Float32Array(size * ITEMS.length);

  for (let b = 0; b < size; b++) {
    const { action } = samples[b];
    obs.set(samples[b].obs, b * OBS_DIM);

    const used = new Set<number>();
    let stopped = false;
    for (let t = 0; t < MAX_PICKS; t++) {
      const stepIndex = b * MAX_PICKS + t;
      const maskBase = stepIndex * STOCK_CHOICES;
      if (t >= action.freeSlots || stopped) {
        stockActions[stepIndex] = 0;
        stockStepMask[stepIndex] = 0;
        continue;
      }

      let chosen: number;
      if (t < action.picks.length) {
        chosen = action.picks[t];
        if (chosen < 0 || chosen >= ITEMS.length) chosen = RL_STOP;
      } else {
        chosen = RL_STOP;
      }
      if (chosen === RL_STOP) stopped = true;

      stockActions[stepIndex] = chosen;
      stockStepMask[stepIndex] = 1;
      for (let i = 0; i < ITEMS.length; i++) {
        stockMasks[maskBase + i] =
          action.existing[i] || used.has(i) ? DISALLOW : 0;
      }
      if (chosen !== RL_STOP) used.add(chosen);
    }

    for (let i = 0; i < ITEMS.length; i++) {
      const index = b * ITEMS.length + i;
      if (!action.active[i]) {
        qtyActions[index] = 0;
        priceActions[index] = 0;
        activeMasks[index] = 0;
        continue;
      }
      activeMasks[index] = 1;
      const qtyIndex = Math.max(
        0,
        Math.min(RL_QTY_LEVELS.length - 1, action.qty[i] ?? 0)
      );
      qtyActions[index] = qtyIndex;
      priceActions[index] = Math.max(
        0,
        Math.min(RL_PRICE_LEVELS.length - 1, action.price[i] ?? 2)
      );
      if (!action.existing[i]) {
        qtyMasks[(b * ITEMS.length + i) * 3] = DISALLOW;
      }
    }
  }

  return {
    size,
    obs,
    stockMasks,
    stockActions,
    stockStepMask,
    qtyMasks,
    qtyActions,
    priceActions,
    activeMasks,
  };
}

export function makeBatchTensors(batch: BatchArrays): BatchTensors {
  const size = batch.size;
  return {
    obs: tf.tensor2d(batch.obs, [size, OBS_DIM]),
    stockMasks: tf.tensor3d(batch.stockMasks, [
      size,
      MAX_PICKS,
      STOCK_CHOICES,
    ]),
    stockActions: tf.tensor2d(
      batch.stockActions,
      [size, MAX_PICKS],
      "int32"
    ),
    stockStepMask: tf.tensor2d(batch.stockStepMask, [size, MAX_PICKS]),
    qtyMasks: tf.tensor3d(batch.qtyMasks, [size, ITEMS.length, 3]),
    qtyActions: tf.tensor2d(batch.qtyActions, [size, ITEMS.length], "int32"),
    priceActions: tf.tensor2d(
      batch.priceActions,
      [size, ITEMS.length],
      "int32"
    ),
    activeMasks: tf.tensor2d(batch.activeMasks, [size, ITEMS.length]),
  };
}

export function disposeBatchTensors(tensors: BatchTensors): void {
  tensors.obs.dispose();
  tensors.stockMasks.dispose();
  tensors.stockActions.dispose();
  tensors.stockStepMask.dispose();
  tensors.qtyMasks.dispose();
  tensors.qtyActions.dispose();
  tensors.priceActions.dispose();
  tensors.activeMasks.dispose();
}

export function policyLogProbs(
  stock: tf.Tensor,
  qty: tf.Tensor,
  price: tf.Tensor,
  tensors: PolicyTensors
): tf.Tensor1D {
  const stockMasked = tf.add(tf.expandDims(stock, 1), tensors.stockMasks);
  const stockLog = tf.logSoftmax(stockMasked, -1);
  const stockOneHot = tf.cast(
    tf.oneHot(tensors.stockActions, STOCK_CHOICES),
    "float32"
  );
  const stockSum = tf.sum(
    tf.mul(
      tf.mul(stockOneHot, stockLog),
      tf.expandDims(tensors.stockStepMask, 2)
    ),
    [1, 2]
  );

  const qtyMasked = tf.add(qty, tensors.qtyMasks);
  const qtyLog = tf.logSoftmax(qtyMasked, -1);
  const qtyOneHot = tf.cast(
    tf.oneHot(tensors.qtyActions, 3),
    "float32"
  );
  const active3 = tf.expandDims(tensors.activeMasks, 2);
  const qtySum = tf.sum(tf.mul(tf.mul(qtyOneHot, qtyLog), active3), [1, 2]);

  const priceLog = tf.logSoftmax(price, -1);
  const priceOneHot = tf.cast(
    tf.oneHot(tensors.priceActions, RL_PRICE_LEVELS.length),
    "float32"
  );
  const priceSum = tf.sum(
    tf.mul(tf.mul(priceOneHot, priceLog), active3),
    [1, 2]
  );

  return tf.add(stockSum, tf.add(qtySum, priceSum)) as tf.Tensor1D;
}

export function policyEntropy(
  stock: tf.Tensor,
  qty: tf.Tensor,
  price: tf.Tensor,
  tensors: PolicyTensors
): tf.Scalar {
  const stockMasked = tf.add(tf.expandDims(stock, 1), tensors.stockMasks);
  const stockLog = tf.logSoftmax(stockMasked, -1);
  const stockProbs = tf.softmax(stockMasked, -1);
  const stockEnt = tf.sum(tf.mul(stockProbs, tf.neg(stockLog)), 2);
  const stockSteps = tf.sum(tensors.stockStepMask);
  const stockAvg = tf.div(
    tf.sum(tf.mul(stockEnt, tensors.stockStepMask)),
    tf.maximum(stockSteps, tf.scalar(1))
  );

  const qtyMasked = tf.add(qty, tensors.qtyMasks);
  const qtyLog = tf.logSoftmax(qtyMasked, -1);
  const qtyProbs = tf.softmax(qtyMasked, -1);
  const qtyEnt = tf.sum(tf.mul(qtyProbs, tf.neg(qtyLog)), 2);
  const activeCount = tf.sum(tensors.activeMasks);
  const qtyAvg = tf.div(
    tf.sum(tf.mul(qtyEnt, tensors.activeMasks)),
    tf.maximum(activeCount, tf.scalar(1))
  );

  const priceLog = tf.logSoftmax(price, -1);
  const priceProbs = tf.softmax(price, -1);
  const priceEnt = tf.sum(tf.mul(priceProbs, tf.neg(priceLog)), 2);
  const priceAvg = tf.div(
    tf.sum(tf.mul(priceEnt, tensors.activeMasks)),
    tf.maximum(activeCount, tf.scalar(1))
  );

  return tf.add(stockAvg, tf.add(qtyAvg, priceAvg)) as tf.Scalar;
}
