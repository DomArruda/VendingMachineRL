import { describe, expect, test } from "bun:test";
import { CONFIG } from "../src/sim/config";
import {
  parseGameSaves,
  restoreGame,
  upsertGameSave,
  type GameSave,
} from "../src/game/gameSaveStore";
import { planFromMachine } from "../src/game/plan";
import { chooseHeuristic } from "../src/sim/heuristics";
import { createGame, currentWholesale, stepGame } from "../src/sim/game";

function save(id: string, day: number): GameSave {
  let game = createGame(123);
  while (game.day < day) {
    game = stepGame(game, chooseHeuristic("greedy", game)).game;
  }
  const progress = {
    day: game.day,
    machine: game.machine,
    history: game.history,
  };
  const planning = day === 0;
  return {
    id,
    savedAt: new Date(Date.UTC(2026, 0, day + 1)).toISOString(),
    seed: game.seed,
    opponentId: "__bundled_ppo__",
    human: progress,
    agent: progress,
    planning,
    humanDecision: planning ? null : { plans: [] },
    agentDecision: planning ? null : { plans: [] },
    plan: planning
      ? planFromMachine(game.machine, currentWholesale(game))
      : Array.from({ length: CONFIG.SLOTS }, () => null),
    warehouseBuys: {},
  };
}

describe("game save storage", () => {
  test("loads only the three newest valid saves and rebuilds the seeded market", () => {
    const saves = [save("day-0", 0), save("day-1", 1), save("day-2", 2), save("day-3", 3)];
    const loaded = parseGameSaves(JSON.stringify(saves));

    expect(loaded.map((entry) => entry.id)).toEqual(["day-3", "day-2", "day-1"]);
    expect(restoreGame(loaded[0].seed, loaded[0].human).market).toEqual(
      createGame(123).market
    );
  });

  test("ignores malformed or invalid saved data", () => {
    expect(parseGameSaves("not json")).toEqual([]);
    const valid = save("bad", 0);
    const invalid = {
      ...valid,
      human: { ...valid.human, machine: { cash: "invalid" } },
    };
    expect(parseGameSaves(JSON.stringify([invalid]))).toEqual([]);

    const spoofedItem = {
      ...valid,
      plan: [
        { itemId: "__proto__", price: 1, buy: 1, refill: 0 },
        ...Array.from({ length: CONFIG.SLOTS - 1 }, () => null),
      ],
    };
    expect(parseGameSaves(JSON.stringify([spoofedItem]))).toEqual([]);
  });

  test("updating a save replaces it without exceeding three slots", () => {
    const saves = [save("one", 0), save("two", 1), save("three", 2)];
    const updated = { ...save("two", 3), id: "two" };
    const next = upsertGameSave(saves, updated);

    expect(next).toHaveLength(3);
    expect(next.map((entry) => entry.id)).toEqual(["two", "one", "three"]);
  });
});
