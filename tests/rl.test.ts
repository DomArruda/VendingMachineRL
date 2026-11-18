import { describe, expect, test } from "bun:test";
import {
  decodeAction,
  RL_PRICE_LEVELS,
  RL_QTY_LEVELS,
  STOCK_CHOICES,
  sampleAction,
} from "../src/rl/action";
import { VendingEnv } from "../src/rl/env";
import { currentWholesale } from "../src/sim/game";
import { ITEMS } from "../src/sim/items";
import { mulberry32, type Rng } from "../src/sim/rng";

function logits(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => (rng() * 2 - 1) * 2.5);
}

const QTY_LOGITS = ITEMS.length * RL_QTY_LEVELS.length;
const PRICE_LOGITS = ITEMS.length * RL_PRICE_LEVELS.length;

describe("rl action layer", () => {
  test("random factorized actions stay valid and decodable", () => {
    const rng = mulberry32(4242);
    for (let episode = 0; episode < 150; episode++) {
      const env = new VendingEnv(10_000 + episode);
      while (!env.done) {
        const context = env.actionContext();
        const action = sampleAction(
          logits(rng, STOCK_CHOICES),
          logits(rng, QTY_LOGITS),
          logits(rng, PRICE_LOGITS),
          context,
          rng
        );

        expect(action.picks.length).toBeLessThanOrEqual(context.freeSlots);
        expect(new Set(action.picks).size).toBe(action.picks.length);
        for (const pick of action.picks) {
          expect(context.existing[pick]).toBe(false);
          expect(pick).toBeGreaterThanOrEqual(0);
          expect(pick).toBeLessThan(ITEMS.length);
        }
        for (let i = 0; i < ITEMS.length; i++) {
          if (action.active[i]) {
            expect(action.qty[i]).toBeGreaterThanOrEqual(0);
            expect(action.qty[i]).toBeLessThan(RL_QTY_LEVELS.length);
            expect(action.price[i]).toBeGreaterThanOrEqual(0);
            expect(action.price[i]).toBeLessThan(RL_PRICE_LEVELS.length);
          } else {
            expect(action.qty[i]).toBe(-1);
            expect(action.price[i]).toBe(-1);
          }
        }

        const decision = decodeAction(
          env.game.machine,
          action,
          currentWholesale(env.game)
        );
        expect(decision.plans.length).toBeLessThanOrEqual(12);
        const ids = new Set<string>();
        for (const plan of decision.plans) {
          expect(plan.buyQty).toBeGreaterThanOrEqual(0);
          expect(plan.buyQty).toBeLessThanOrEqual(10);
          expect(ids.has(plan.itemId)).toBe(false);
          ids.add(plan.itemId);
        }

        env.step(action);
        expect(env.game.machine.cash).toBeGreaterThanOrEqual(-1e-9);
        expect(env.game.machine.slots.length).toBe(12);
        const filled = env.game.machine.slots.filter(
          (slot) => slot.itemId !== null
        );
        expect(new Set(filled.map((slot) => slot.itemId)).size).toBe(
          filled.length
        );
        for (const slot of env.game.machine.slots) {
          expect(slot.qty).toBeGreaterThanOrEqual(0);
          expect(slot.qty).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  test("same seed and action sequence produce the same RL episode", () => {
    const left = new VendingEnv(777);
    const right = new VendingEnv(777);
    const rng = mulberry32(99);

    while (!left.done) {
      const action = sampleAction(
        logits(rng, STOCK_CHOICES),
        logits(rng, QTY_LOGITS),
        logits(rng, PRICE_LOGITS),
        left.actionContext(),
        rng
      );
      const a = left.step(action);
      const b = right.step(action);
      expect(b.reward).toBeCloseTo(a.reward, 8);
      expect(b.info.stats).toEqual(a.info.stats);
      expect(b.info.log).toEqual(a.info.log);
      expect(b.info.decision).toEqual(a.info.decision);
    }
    expect(right.done).toBe(true);
  });
});
