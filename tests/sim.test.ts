import { describe, expect, test } from "bun:test";
import { CONFIG } from "../src/sim/config";
import { runDay } from "../src/sim/day";
import {
  createGame,
  makeDaySetup,
  playEpisode,
  stepGame,
} from "../src/sim/game";
import { chooseHeuristic } from "../src/sim/heuristics";
import { ITEMS } from "../src/sim/items";
import {
  addItem,
  planSpend,
  randomlyFillBlankSlots,
} from "../src/game/plan";
import {
  applyDecision,
  createMachine,
  salvageValue,
  slotOf,
  type Decision,
} from "../src/sim/machine";

function assertMachineLimits(machine: ReturnType<typeof createMachine>) {
  expect(machine.cash).toBeGreaterThanOrEqual(-1e-9);
  expect(machine.slots.length).toBe(CONFIG.SLOTS);
  const filled = machine.slots.filter((slot) => slot.itemId !== null);
  expect(filled.length).toBeLessThanOrEqual(CONFIG.SLOTS);
  expect(new Set(filled.map((slot) => slot.itemId)).size).toBe(filled.length);
  expect(
    Object.values(machine.warehouse).reduce((sum, qty) => sum + qty, 0)
  ).toBeLessThanOrEqual(CONFIG.WAREHOUSE_CAP);
  for (const qty of Object.values(machine.warehouse)) {
    expect(qty).toBeGreaterThanOrEqual(0);
  }
  for (const slot of machine.slots) {
    expect(slot.qty).toBeGreaterThanOrEqual(0);
    expect(slot.qty).toBeLessThanOrEqual(CONFIG.SLOT_CAP);
  }
}

describe("simulation", () => {
  test("adding a wholesale item plans up to five units within available cash", () => {
    const plan = Array.from({ length: CONFIG.SLOTS }, () => null);
    const wholesale = Object.fromEntries(ITEMS.map((item) => [item.id, 1]));

    expect(addItem(plan, "cola", wholesale, 5)[0]?.buy).toBe(5);
    expect(addItem(plan, "cola", wholesale, 3.99)[0]?.buy).toBe(3);
    expect(addItem(plan, "cola", wholesale, 0)[0]?.buy).toBe(0);
    const stocked = addItem(plan, "cola", wholesale, 5);
    expect(addItem(stocked, "cola", wholesale, 20)).toBe(stocked);
  });

  test("same seed and decisions produce an identical day", () => {
    const gameA = createGame(123);
    const gameB = createGame(123);
    const decision = chooseHeuristic("greedy", gameA);
    const a = stepGame(gameA, decision);
    const b = stepGame(gameB, decision);
    expect(a.result.log).toEqual(b.result.log);
    expect(a.result.stats).toEqual(b.result.stats);
    expect(a.result.machine).toEqual(b.result.machine);
  });

  test("common random numbers: identical decisions give identical outcomes", () => {
    const game = createGame(77);
    const setup = makeDaySetup(game.seed, 0, game.market);
    const decision = chooseHeuristic("topPopular", game);
    const human = runDay(createMachine(), setup, decision);
    const agent = runDay(createMachine(), setup, decision);
    expect(agent.stats).toEqual(human.stats);
    expect(agent.log).toEqual(human.log);
    expect(agent.machine).toEqual(human.machine);
  });

  test("cash, slot and unit limits hold for every heuristic", () => {
    for (const name of ["random", "topPopular", "topMargin", "greedy", "markupX"] as const) {
      for (let seed = 0; seed < 10; seed++) {
        let game = createGame(seed);
        while (game.day < CONFIG.DAYS) {
          const decision = chooseHeuristic(name, game);
          const next = stepGame(game, decision);
          assertMachineLimits(next.result.machine);
          expect(next.result.machine.cash).toBeCloseTo(
            next.result.stats.endingCash,
            5
          );
          for (const slot of next.result.machine.slots) {
            if (!slot.itemId) continue;
            expect(slot.price).toBeGreaterThan(0);
          }
          game = next.game;
        }
      }
    }
  });

  test("excessive decisions are capped by slots, capacity and cash", () => {
    const game = createGame(5);
    const setup = makeDaySetup(game.seed, 0, game.market);
    const decision: Decision = {
      plans: ITEMS.map((item) => ({
        itemId: item.id,
        buyQty: 999,
        price: 999,
      })),
    };
    const result = runDay(createMachine(), setup, decision);
    assertMachineLimits(result.machine);
    expect(result.machine.cash).toBeLessThanOrEqual(CONFIG.STARTING_CASH);
    expect(
      result.machine.slots.filter((slot) => slot.itemId !== null).length
    ).toBeLessThanOrEqual(CONFIG.SLOTS);
    expect(result.stats.spend).toBeLessThanOrEqual(CONFIG.STARTING_CASH + 1e-9);
  });

  test("backstock purchases obey cash/storage limits and refill without repaying", () => {
    const machine = createMachine(5);
    const wholesale = Object.fromEntries(ITEMS.map((item) => [item.id, 1]));
    const decision: Decision = {
      warehouseBuys: [{ itemId: "cola", qty: 10 }],
      plans: [
        { itemId: "cola", buyQty: 0, refillQty: 4, price: 1.2 },
      ],
    };

    const result = applyDecision(machine, decision, wholesale);
    expect(result.spend).toBe(5);
    expect(result.machine.cash).toBe(0);
    expect(slotOf(result.machine, "cola")?.qty).toBe(4);
    expect(result.machine.warehouse.cola).toBe(1);
    expect(Object.values(result.machine.warehouse).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(
      CONFIG.WAREHOUSE_CAP
    );
    expect(salvageValue(result.machine, wholesale)).toBe(1.5);
  });

  test("backstock capacity caps bulk buying", () => {
    const machine = createMachine(1000);
    const wholesale = Object.fromEntries(ITEMS.map((item) => [item.id, 1]));
    const result = applyDecision(
      machine,
      { plans: [], warehouseBuys: [{ itemId: "bottled-water", qty: 100 }] },
      wholesale
    );
    expect(result.machine.warehouse["bottled-water"]).toBe(CONFIG.WAREHOUSE_CAP);
    expect(result.spend).toBe(CONFIG.WAREHOUSE_CAP);
  });

  test("clearing an occupied slot frees it for a replacement item", () => {
    const wholesale = Object.fromEntries(ITEMS.map((item) => [item.id, 1]));
    const stocked = applyDecision(
      createMachine(20),
      { plans: [{ itemId: "cola", buyQty: 5, price: 1.2 }] },
      wholesale
    );
    const swapped = applyDecision(
      stocked.machine,
      {
        removeItems: ["cola"],
        plans: [{ itemId: "bottled-water", buyQty: 3, price: 0.9 }],
      },
      wholesale
    );
    expect(slotOf(swapped.machine, "cola")).toBeUndefined();
    expect(slotOf(swapped.machine, "bottled-water")?.qty).toBe(3);
    expect(swapped.machine.slots.filter((slot) => slot.itemId !== null)).toHaveLength(1);
  });

  test("random stock fills only blanks and stays within projected cash", () => {
    const game = createGame(61);
    const plan = Array.from({ length: CONFIG.SLOTS }, () => null);
    const wholesale = Object.fromEntries(
      ITEMS.map((item) => [
        item.id,
        game.market.history[item.id][CONFIG.PREHISTORY_DAYS],
      ])
    );
    const filled = randomlyFillBlankSlots(
      plan,
      game.machine,
      wholesale,
      {},
      () => 0.5
    );
    const selected = filled.filter((slot) => slot !== null);
    expect(selected.length).toBeLessThanOrEqual(CONFIG.SLOTS);
    expect(new Set(selected.map((slot) => slot?.itemId)).size).toBe(
      selected.length
    );
    expect(planSpend(filled, wholesale)).toBeLessThanOrEqual(
      game.machine.cash + 1e-9
    );
    for (const slot of selected) {
      expect(slot?.buy).toBeGreaterThan(0);
      expect(slot?.buy).toBeLessThanOrEqual(CONFIG.SLOT_CAP);
    }
  });

  test("salvage only lands on day 15", () => {
    const result = playEpisode(9, (game) => chooseHeuristic("topPopular", game));
    expect(result.history).toHaveLength(CONFIG.DAYS);
    for (const day of result.history.slice(0, -1)) {
      expect(day.salvage).toBeUndefined();
    }
    const final = result.history[result.history.length - 1];
    expect(typeof final.salvage).toBe("number");
    expect(final.salvage).toBeGreaterThanOrEqual(0);
  });

  test("an episode is deterministic end to end", () => {
    const a = playEpisode(42, (game) => chooseHeuristic("markupX", game));
    const b = playEpisode(42, (game) => chooseHeuristic("markupX", game));
    expect(b.profit).toBe(a.profit);
    expect(b.history).toEqual(a.history);
  });
});
