import { CONFIG } from "./config";
import { customerCount, drawCustomers } from "./customers";
import { runDay, type DayResult, type DaySetup, type DayStats } from "./day";
import { ITEMS } from "./items";
import {
  createMachine,
  salvageValue,
  type Decision,
  type MachineState,
} from "./machine";
import { generateMarket, wholesaleAt, type Market } from "./market";
import { stream } from "./rng";
import { roundToCents } from "./util";

export interface GameState {
  seed: number;
  day: number;
  market: Market;
  machine: MachineState;
  history: DayStats[];
}

export interface EpisodeResult {
  game: GameState;
  profit: number;
  history: DayStats[];
}

export function makeDaySetup(seed: number, day: number, market: Market): DaySetup {
  const wholesale: Record<string, number> = {};
  for (const itemId of Object.keys(market.history)) {
    wholesale[itemId] = wholesaleAt(market, itemId, day);
  }
  const rng = stream(seed, "customers", day);
  const customers = drawCustomers(rng, customerCount(rng));
  return { day, wholesale, customers };
}

export function currentWholesale(game: GameState): Record<string, number> {
  const wholesale: Record<string, number> = {};
  for (const item of ITEMS) {
    wholesale[item.id] = wholesaleAt(game.market, item.id, game.day);
  }
  return wholesale;
}

export function createGame(seed: number): GameState {
  return {
    seed,
    day: 0,
    market: generateMarket(seed),
    machine: createMachine(),
    history: [],
  };
}

export function stepGame(
  game: GameState,
  decision: Decision
): { game: GameState; result: DayResult } {
  if (game.day >= CONFIG.DAYS) throw new Error("Episode already finished");
  const setup = makeDaySetup(game.seed, game.day, game.market);
  const result = runDay(game.machine, setup, decision);

  let machine = result.machine;
  let stats = result.stats;

  if (game.day + 1 === CONFIG.DAYS) {
    const salvage = salvageValue(machine, setup.wholesale);
    stats = {
      ...stats,
      salvage,
      profit: roundToCents(stats.profit + salvage),
      endingCash: roundToCents(stats.endingCash + salvage),
    };
    machine = { ...machine, cash: roundToCents(machine.cash + salvage) };
  }

  return {
    game: {
      ...game,
      day: game.day + 1,
      machine,
      history: [...game.history, stats],
    },
    result: { ...result, machine, stats },
  };
}

export function playEpisode(
  seed: number,
  policy: (game: GameState) => Decision
): EpisodeResult {
  let game = createGame(seed);
  while (game.day < CONFIG.DAYS) {
    game = stepGame(game, policy(game)).game;
  }
  const profit = roundToCents(
    game.history.reduce((sum, day) => sum + day.profit, 0)
  );
  return { game, profit, history: game.history };
}
