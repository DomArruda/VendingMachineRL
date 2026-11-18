import * as tf from "@tensorflow/tfjs";
import { CONFIG } from "../sim/config";
import { playEpisode, type GameState } from "../sim/game";
import { chooseHeuristic, type HeuristicName } from "../sim/heuristics";
import type { DayStats } from "../sim/day";
import {
  encodeObservation,
  OBS_DIM,
  VendingEnv,
} from "./env";
import { getActionContext, type RLAction } from "./action";
import { actionFromPrediction, predictBatch } from "./nets";
import { roundToCents } from "../sim/util";

export interface EvalResult {
  mean: number;
  std: number;
  count: number;
}

export function summarize(values: readonly number[]): EvalResult {
  const count = values.length;
  let sum = 0;
  let sumSq = 0;
  for (const value of values) {
    sum += value;
    sumSq += value * value;
  }
  const mean = count > 0 ? sum / count : 0;
  const variance = count > 0 ? Math.max(0, sumSq / count - mean * mean) : 0;
  return { mean: roundToCents(mean), std: Math.sqrt(variance), count };
}

export function evaluateHeuristic(
  name: HeuristicName,
  seeds: readonly number[]
): EvalResult {
  return summarize(
    seeds.map((seed) => playEpisode(seed, (game) => chooseHeuristic(name, game)).profit)
  );
}

export function evaluatePolicy(
  model: tf.LayersModel,
  seeds: readonly number[],
  deterministic = true
): EvalResult {
  const profits = new Array<number>(seeds.length).fill(0);
  const chunkSize = 256;

  for (let start = 0; start < seeds.length; start += chunkSize) {
    const chunk = seeds.slice(start, start + chunkSize);
    const envs = chunk.map((seed) => new VendingEnv(seed));
    for (let day = 0; day < CONFIG.DAYS; day++) {
      const obsData = new Float32Array(envs.length * OBS_DIM);
      for (let i = 0; i < envs.length; i++) {
        obsData.set(envs[i].observe(), i * OBS_DIM);
      }
      const prediction = predictBatch(model, obsData, envs.length);
      for (let i = 0; i < envs.length; i++) {
        const action = actionFromPrediction(
          prediction,
          i,
          envs[i].actionContext(),
          () => 0,
          deterministic
        );
        profits[start + i] += envs[i].step(action).info.stats.profit;
      }
    }
  }

  return summarize(profits);
}

export function decideAction(
  model: tf.LayersModel,
  game: GameState,
  lastStats: DayStats | null
): RLAction {
  const obs = encodeObservation(game, lastStats);
  const prediction = predictBatch(model, obs, 1);
  return actionFromPrediction(
    prediction,
    0,
    getActionContext(game.machine),
    () => 0,
    true
  );
}
