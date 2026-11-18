import { CONFIG } from "../sim/config";
import type { DayEvent, DayStats } from "../sim/day";
import {
  createGame,
  currentWholesale,
  stepGame,
  type GameState,
} from "../sim/game";
import { ITEMS } from "../sim/items";
import { slotOf, type Decision } from "../sim/machine";
import { suggestedPrice } from "../sim/market";
import {
  decodeAction,
  getActionContext,
  type ActionContext,
  type RLAction,
} from "./action";

export const REWARD_SCALE = 20;

const CATEGORIES = [
  "chips",
  "candy",
  "soda",
  "water",
  "healthy",
  "premium",
] as const;

export const OBS_DIM = 7 + ITEMS.length * 18;

export function encodeObservation(
  game: GameState,
  lastStats: DayStats | null
): Float32Array {
  const obs = new Float32Array(OBS_DIM);
  const wholesale = currentWholesale(game);
  const slotsUsed = game.machine.slots.filter((slot) => slot.itemId !== null).length;
  const freeSlots = CONFIG.SLOTS - slotsUsed;
  const lastWalkaways = lastStats
    ? lastStats.walkaways.notStocked + lastStats.walkaways.tooExpensive
    : 0;

  let k = 0;
  obs[k++] = game.day / CONFIG.DAYS;
  obs[k++] = (CONFIG.DAYS - game.day) / CONFIG.DAYS;
  obs[k++] = game.machine.cash / 100;
  obs[k++] = slotsUsed / CONFIG.SLOTS;
  obs[k++] = freeSlots / CONFIG.SLOTS;
  obs[k++] = (lastStats?.unitsSold ?? 0) / 20;
  obs[k++] = lastWalkaways / 20;

  for (const item of ITEMS) {
    const slot = slotOf(game.machine, item.id);
    const held = slot?.qty ?? 0;
    const hasSlot = slot ? 1 : 0;
    const price = slot?.price ?? 0;
    const history = game.market.history[item.id];
    const index = CONFIG.PREHISTORY_DAYS + game.day;
    const wholesaleNow = wholesale[item.id];
    const wholesalePrev = index >= 1 ? history[index - 1] : wholesaleNow;
    const wholesalePast = index >= 5 ? history[index - 5] : wholesaleNow;

    obs[k++] = wholesaleNow / item.baseWholesale - 1;
    obs[k++] = suggestedPrice(item, wholesaleNow) / item.refPrice - 1;
    obs[k++] = wholesaleNow / wholesalePrev - 1;
    obs[k++] = wholesaleNow / wholesalePast - 1;
    obs[k++] = item.popularity / 5;
    obs[k++] = item.elasticity / 3;
    obs[k++] = item.refPrice / 6;
    obs[k++] = held / CONFIG.SLOT_CAP;
    obs[k++] = hasSlot ? price / item.refPrice - 1 : 0;
    obs[k++] = hasSlot;
    obs[k++] = (lastStats?.byItem[item.id] ?? 0) / 10;
    obs[k++] = (lastStats?.wantedNotStocked[item.id] ?? 0) / 10;
    for (const category of CATEGORIES) {
      obs[k++] = item.category === category ? 1 : 0;
    }
  }

  if (k !== OBS_DIM) {
    throw new Error(`Observation length mismatch: ${k} != ${OBS_DIM}`);
  }
  return obs;
}

export interface EnvStepInfo {
  day: number;
  stats: DayStats;
  log: DayEvent[];
  decision: Decision;
  action: RLAction;
}

export class VendingEnv {
  game: GameState;
  lastStats: DayStats | null = null;
  done = false;

  constructor(public seed: number) {
    this.game = createGame(seed);
  }

  reset(seed: number = this.seed): Float32Array {
    this.seed = seed;
    this.game = createGame(seed);
    this.lastStats = null;
    this.done = false;
    return this.observe();
  }

  observe(): Float32Array {
    return encodeObservation(this.game, this.lastStats);
  }

  actionContext(): ActionContext {
    return getActionContext(this.game.machine);
  }

  step(action: RLAction): {
    obs: Float32Array;
    reward: number;
    done: boolean;
    info: EnvStepInfo;
  } {
    if (this.done) throw new Error("Episode already finished");
    const wholesale = currentWholesale(this.game);
    const decision = decodeAction(this.game.machine, action, wholesale);
    const stepped = stepGame(this.game, decision);
    this.game = stepped.game;
    this.lastStats = stepped.result.stats;
    this.done = this.game.day >= CONFIG.DAYS;
    return {
      obs: this.observe(),
      reward: stepped.result.stats.profit / REWARD_SCALE,
      done: this.done,
      info: {
        day: stepped.result.stats.day,
        stats: stepped.result.stats,
        log: stepped.result.log,
        decision,
        action,
      },
    };
  }
}
