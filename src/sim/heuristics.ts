import { CONFIG } from "./config";
import { buyProbability } from "./customers";
import { currentWholesale, type GameState } from "./game";
import { ITEMS, POPULARITY_TOTAL, type Item } from "./items";
import {
  qtyOf,
  type Decision,
  type ItemPlan,
  type MachineState,
} from "./machine";
import { makeRng, suggestedPrice } from "./market";

export const HEURISTICS = [
  "random",
  "topPopular",
  "topMargin",
  "greedy",
  "markupX",
] as const;

export type HeuristicName = (typeof HEURISTICS)[number];

const MEAN_CUSTOMERS = (CONFIG.CUSTOMERS_MIN + CONFIG.CUSTOMERS_MAX) / 2;

function fillToCap(
  items: readonly { item: Item; price: number }[],
  machine: MachineState
): Decision {
  const plans: ItemPlan[] = items.slice(0, CONFIG.SLOTS).map((row, index) => ({
    itemId: row.item.id,
    buyQty: CONFIG.SLOT_CAP - qtyOf(machine, row.item.id),
    price: row.price,
    priority: index,
  }));
  return { plans };
}

function rankedByProfit(
  game: GameState,
  priceFactor: number
): { item: Item; price: number; unitsPerDay: number; profitPerDay: number }[] {
  const wholesale = currentWholesale(game);
  return ITEMS.map((item) => {
    const cost = wholesale[item.id];
    const price = suggestedPrice(item, cost) * priceFactor;
    const unitsPerDay =
      (MEAN_CUSTOMERS * item.popularity * buyProbability(item, price)) /
      POPULARITY_TOTAL;
    return {
      item,
      price,
      unitsPerDay,
      profitPerDay: unitsPerDay * (price - cost),
    };
  }).sort((a, b) => b.profitPerDay - a.profitPerDay);
}

function greedyDecision(game: GameState, priceFactor: number): Decision {
  const daysRemaining = CONFIG.DAYS - game.day;
  const plans: ItemPlan[] = rankedByProfit(game, priceFactor)
    .slice(0, CONFIG.SLOTS)
    .map((row, index) => {
      const target = Math.ceil(row.unitsPerDay * daysRemaining);
      const held = qtyOf(game.machine, row.item.id);
      return {
        itemId: row.item.id,
        buyQty: Math.max(0, target - held),
        price: row.price,
        priority: index,
      };
    });
  return { plans };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function chooseHeuristic(name: HeuristicName, game: GameState): Decision {
  const wholesale = currentWholesale(game);

  if (name === "greedy") return greedyDecision(game, 1);
  if (name === "markupX") return greedyDecision(game, 1.2);

  if (name === "random") {
    const rng = makeRng(game.seed, "heuristic-random", game.day);
    const pool = shuffle([...ITEMS], rng);
    const plans: ItemPlan[] = pool.slice(0, CONFIG.SLOTS).map((item, index) => {
      const suggested = suggestedPrice(item, wholesale[item.id]);
      return {
        itemId: item.id,
        buyQty: Math.floor(rng() * (CONFIG.SLOT_CAP + 1)),
        price: suggested * (0.7 + rng() * 0.8),
        priority: index,
      };
    });
    return { plans };
  }

  if (name === "topPopular") {
    const ranked = [...ITEMS]
      .sort(
        (a, b) =>
          b.popularity - a.popularity || a.name.localeCompare(b.name)
      )
      .map((item) => ({
        item,
        price: suggestedPrice(item, wholesale[item.id]),
      }));
    return fillToCap(ranked, game.machine);
  }

  const ranked = ITEMS.map((item) => ({
    item,
    margin: suggestedPrice(item, wholesale[item.id]) - wholesale[item.id],
  })).sort((a, b) => b.margin - a.margin);
  return fillToCap(
    ranked.map((row) => ({
      item: row.item,
      price: suggestedPrice(row.item, wholesale[row.item.id]),
    })),
    game.machine
  );
}
