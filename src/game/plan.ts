import { CONFIG } from "../sim/config";
import { ITEM_BY_ID, ITEMS } from "../sim/items";
import {
  clampPrice,
  qtyOf,
  type Decision,
  type MachineState,
  type WarehouseBuy,
} from "../sim/machine";
import { snapPrice, suggestedPrice } from "../sim/market";

export interface PlanSlot {
  itemId: string;
  price: number;
  buy: number;
  refill: number;
}

export type Plan = (PlanSlot | null)[];

export function planFromMachine(
  machine: MachineState,
  wholesale: Record<string, number>
): Plan {
  return machine.slots.map((slot) => {
    if (!slot.itemId) return null;
    const item = ITEM_BY_ID[slot.itemId];
    const suggested = suggestedPrice(item, wholesale[item.id]);
    return {
      itemId: item.id,
      price: clampPrice(slot.price || suggested, suggested),
      buy: 0,
      refill: 0,
    };
  });
}

export function decisionFromPlan(
  plan: Plan,
  warehouseBuys: Record<string, number> = {},
  machine?: MachineState
): Decision {
  const plans = plan
    .map((slot, index) =>
      slot
        ? {
            itemId: slot.itemId,
            buyQty: Math.max(0, Math.floor(slot.buy)),
            refillQty: Math.max(0, Math.floor(slot.refill)),
            price: slot.price,
            priority: index,
          }
        : null
    )
    .filter((plan): plan is NonNullable<typeof plan> => plan !== null);
  const buys: WarehouseBuy[] = ITEMS.filter(
    (item) => (warehouseBuys[item.id] ?? 0) > 0
  ).map((item, priority) => ({
    itemId: item.id,
    qty: Math.floor(warehouseBuys[item.id]),
    priority,
  }));
  const kept = new Set(plan.flatMap((slot) => (slot ? [slot.itemId] : [])));
  const removeItems = machine
    ? machine.slots
        .filter((slot) => slot.itemId !== null && !kept.has(slot.itemId))
        .map((slot) => slot.itemId as string)
    : [];
  return { plans, warehouseBuys: buys, removeItems };
}

export function planSpend(
  plan: Plan,
  wholesale: Record<string, number>,
  warehouseBuys: Record<string, number> = {}
): number {
  let total = 0;
  for (const slot of plan) {
    if (!slot) continue;
    total += slot.buy * (wholesale[slot.itemId] ?? 0);
  }
  for (const [itemId, qty] of Object.entries(warehouseBuys)) {
    total += qty * (wholesale[itemId] ?? 0);
  }
  return total;
}

export function planStock(plan: Plan, machine: MachineState): number {
  let total = 0;
  for (const slot of plan) {
    if (slot) total += qtyOf(machine, slot.itemId);
  }
  return total;
}

export function addItem(
  plan: Plan,
  itemId: string,
  wholesale: Record<string, number>
): Plan {
  if (plan.some((slot) => slot?.itemId === itemId)) return plan;
  const index = plan.findIndex((slot) => slot === null);
  if (index < 0) return plan;
  const item = ITEM_BY_ID[itemId];
  const next = [...plan];
  next[index] = {
    itemId,
    price: suggestedPrice(item, wholesale[itemId]),
    buy: 5,
    refill: 0,
  };
  return next;
}

export function removeItem(plan: Plan, index: number): Plan {
  const next = [...plan];
  next[index] = null;
  return next;
}

export function updateSlot(plan: Plan, index: number, patch: Partial<PlanSlot>): Plan {
  const slot = plan[index];
  if (!slot) return plan;
  const next = [...plan];
  next[index] = { ...slot, ...patch };
  return next;
}

export function maxBuy(
  itemId: string,
  machine: MachineState,
  refill = 0
): number {
  const held = qtyOf(machine, itemId);
  return Math.max(0, CONFIG.SLOT_CAP - held - refill);
}

export function warehouseTotal(machine: MachineState): number {
  return Object.values(machine.warehouse).reduce(
    (total, qty) => total + Math.max(0, qty),
    0
  );
}

export function priceBounds(
  itemId: string,
  wholesale: Record<string, number>
): { min: number; max: number; suggested: number } {
  const item = ITEM_BY_ID[itemId];
  const suggested = suggestedPrice(item, wholesale[itemId]);
  return {
    min: snapPrice(suggested * CONFIG.PRICE_MIN_MULT),
    max: snapPrice(suggested * CONFIG.PRICE_MAX_MULT),
    suggested,
  };
}

export function stockedItems(plan: Plan): Set<string> {
  return new Set(
    plan
      .filter((slot): slot is PlanSlot => slot !== null)
      .map((slot) => slot.itemId)
  );
}

export function availableItems(plan: Plan): string[] {
  const stocked = stockedItems(plan);
  return ITEMS.filter((item) => !stocked.has(item.id)).map((item) => item.id);
}

export function randomlyFillBlankSlots(
  plan: Plan,
  machine: MachineState,
  wholesale: Record<string, number>,
  warehouseBuys: Record<string, number>,
  rng: () => number = Math.random
): Plan {
  const next = [...plan];
  const stocked = stockedItems(plan);
  const inMachine = new Set(
    machine.slots.flatMap((slot) => (slot.itemId ? [slot.itemId] : []))
  );
  const candidates = ITEMS.filter(
    (item) => !stocked.has(item.id) && !inMachine.has(item.id)
  );
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  let remainingCash = Math.max(
    0,
    machine.cash - planSpend(plan, wholesale, warehouseBuys)
  );
  for (let slotIndex = 0; slotIndex < next.length; slotIndex++) {
    if (next[slotIndex] !== null) continue;
    let selected = -1;
    let quantity = 0;
    for (let i = 0; i < candidates.length; i++) {
      const cost = wholesale[candidates[i].id];
      const affordable = Math.floor((remainingCash + 1e-9) / cost);
      if (affordable <= 0) continue;
      selected = i;
      quantity = Math.min(CONFIG.SLOT_CAP, affordable);
      break;
    }
    if (selected < 0) break;
    const item = candidates.splice(selected, 1)[0];
    next[slotIndex] = {
      itemId: item.id,
      price: suggestedPrice(item, wholesale[item.id]),
      buy: quantity,
      refill: 0,
    };
    remainingCash -= quantity * wholesale[item.id];
  }
  return next;
}
