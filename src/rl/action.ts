import { CONFIG } from "../sim/config";
import { ITEMS, ITEM_BY_ID } from "../sim/items";
import {
  slotOf,
  type Decision,
  type ItemPlan,
  type MachineState,
} from "../sim/machine";
import { suggestedPrice } from "../sim/market";
import type { Rng } from "../sim/rng";

export const RL_QTY_LEVELS = [0, 5, 10] as const;
export const RL_PRICE_LEVELS = [0.8, 0.9, 1.0, 1.1, 1.2] as const;
export const RL_STOP = ITEMS.length;
export const STOCK_CHOICES = RL_STOP + 1;
export const MAX_PICKS = CONFIG.SLOTS;

export const ITEM_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  ITEMS.map((item, index) => [item.id, index])
);

export interface ActionContext {
  existing: boolean[];
  freeSlots: number;
}

export interface RLAction {
  picks: number[];
  qty: number[];
  price: number[];
  active: boolean[];
  existing: boolean[];
  freeSlots: number;
}

export function getActionContext(machine: MachineState): ActionContext {
  const existing = ITEMS.map((item) => slotOf(machine, item.id) !== undefined);
  const freeSlots = machine.slots.filter((slot) => slot.itemId === null).length;
  return { existing, freeSlots };
}

function pickIndex(
  logits: readonly number[],
  allowed: readonly boolean[],
  rng: Rng,
  deterministic: boolean
): number {
  let best = -1;
  let bestValue = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (allowed[i] && logits[i] > bestValue) {
      bestValue = logits[i];
      best = i;
    }
  }
  if (best < 0) return 0;
  if (deterministic) return best;

  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (allowed[i]) max = Math.max(max, logits[i]);
  }
  let total = 0;
  for (let i = 0; i < logits.length; i++) {
    if (allowed[i]) total += Math.exp(logits[i] - max);
  }
  let r = rng() * total;
  let last = best;
  for (let i = 0; i < logits.length; i++) {
    if (!allowed[i]) continue;
    last = i;
    r -= Math.exp(logits[i] - max);
    if (r <= 0) return i;
  }
  return last;
}

export function sampleAction(
  stockLogits: readonly number[],
  qtyLogits: readonly number[],
  priceLogits: readonly number[],
  context: ActionContext,
  rng: Rng,
  deterministic = false
): RLAction {
  const stockAllowed = new Array<boolean>(STOCK_CHOICES).fill(true);
  for (let i = 0; i < ITEMS.length; i++) {
    stockAllowed[i] = !context.existing[i];
  }

  const picks: number[] = [];
  for (let step = 0; step < context.freeSlots; step++) {
    const choice = pickIndex(stockLogits, stockAllowed, rng, deterministic);
    if (choice === RL_STOP) break;
    picks.push(choice);
    stockAllowed[choice] = false;
  }

  const active = context.existing.slice();
  for (const pick of picks) active[pick] = true;

  const qty = new Array<number>(ITEMS.length).fill(-1);
  const price = new Array<number>(ITEMS.length).fill(-1);
  for (let i = 0; i < ITEMS.length; i++) {
    if (!active[i]) continue;
    const qtyAllowed = [true, true, true];
    if (!context.existing[i]) qtyAllowed[0] = false;
    qty[i] = pickIndex(
      qtyLogits.slice(i * 3, i * 3 + 3),
      qtyAllowed,
      rng,
      deterministic
    );
    price[i] = pickIndex(
      priceLogits.slice(i * 5, i * 5 + 5),
      [true, true, true, true, true],
      rng,
      deterministic
    );
  }

  return {
    picks,
    qty,
    price,
    active,
    existing: context.existing.slice(),
    freeSlots: context.freeSlots,
  };
}

function nearestIndex(ratio: number, levels: readonly number[]): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < levels.length; i++) {
    const distance = Math.abs(ratio - levels[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

export function decodeAction(
  machine: MachineState,
  action: RLAction,
  wholesale: Record<string, number>
): Decision {
  const plans: ItemPlan[] = [];
  const seen = new Set<string>();
  let priority = 0;

  for (const slot of machine.slots) {
    if (!slot.itemId) continue;
    const item = ITEM_BY_ID[slot.itemId];
    if (!item) continue;
    const index = ITEM_INDEX[item.id];
    const qtyIndex = action.qty[index] ?? -1;
    const priceIndex = action.price[index] ?? -1;
    const price =
      priceIndex >= 0 && priceIndex < RL_PRICE_LEVELS.length
        ? RL_PRICE_LEVELS[priceIndex] * suggestedPrice(item, wholesale[item.id])
        : slot.price;
    plans.push({
      itemId: item.id,
      buyQty: qtyIndex >= 0 ? RL_QTY_LEVELS[qtyIndex] : 0,
      price,
      priority: priority++,
    });
    seen.add(item.id);
  }

  for (const pick of action.picks) {
    if (pick < 0 || pick >= ITEMS.length) continue;
    const item = ITEMS[pick];
    if (seen.has(item.id)) continue;
    const qtyIndex = action.qty[pick] ?? -1;
    if (qtyIndex <= 0) continue;
    const priceIndex = action.price[pick] ?? 2;
    const price =
      priceIndex >= 0 && priceIndex < RL_PRICE_LEVELS.length
        ? RL_PRICE_LEVELS[priceIndex] * suggestedPrice(item, wholesale[item.id])
        : suggestedPrice(item, wholesale[item.id]);
    plans.push({
      itemId: item.id,
      buyQty: RL_QTY_LEVELS[qtyIndex],
      price,
      priority: priority++,
    });
    seen.add(item.id);
  }

  return { plans };
}

export function targetActionFromDecision(
  decision: Decision,
  context: ActionContext,
  machine: MachineState,
  wholesale: Record<string, number>
): RLAction {
  const planById = new Map(decision.plans.map((plan) => [plan.itemId, plan]));
  const picks: number[] = [];

  const ranked = [...decision.plans].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0)
  );
  for (const plan of ranked) {
    if (picks.length >= context.freeSlots) break;
    const index = ITEM_INDEX[plan.itemId];
    if (index === undefined || context.existing[index]) continue;
    if (plan.buyQty <= 0) continue;
    picks.push(index);
  }

  const active = context.existing.slice();
  for (const pick of picks) active[pick] = true;

  const qty = new Array<number>(ITEMS.length).fill(-1);
  const price = new Array<number>(ITEMS.length).fill(-1);
  for (let i = 0; i < ITEMS.length; i++) {
    if (!active[i]) continue;
    const item = ITEMS[i];
    const suggested = suggestedPrice(item, wholesale[item.id]);
    const plan = planById.get(item.id);
    if (context.existing[i]) {
      const slot = slotOf(machine, item.id);
      const buy = plan?.buyQty ?? 0;
      qty[i] = buy <= 2.5 ? 0 : buy <= 7.5 ? 1 : 2;
      const currentPrice = slot?.price ?? suggested;
      price[i] = nearestIndex(currentPrice / suggested, RL_PRICE_LEVELS);
    } else {
      qty[i] = (plan?.buyQty ?? 5) <= 7.5 ? 1 : 2;
      price[i] = nearestIndex(
        (plan?.price ?? suggested) / suggested,
        RL_PRICE_LEVELS
      );
    }
  }

  return {
    picks,
    qty,
    price,
    active,
    existing: context.existing.slice(),
    freeSlots: context.freeSlots,
  };
}
