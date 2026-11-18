import { CONFIG } from "./config";
import { ITEM_BY_ID } from "./items";
import { snapPrice, suggestedPrice } from "./market";
import { roundToCents } from "./util";

export interface Slot {
  itemId: string | null;
  qty: number;
  price: number;
}

export interface MachineState {
  cash: number;
  slots: Slot[];
  warehouse: Record<string, number>;
}

export interface ItemPlan {
  itemId: string;
  buyQty: number;
  price?: number;
  priority?: number;
  refillQty?: number;
}

export interface WarehouseBuy {
  itemId: string;
  qty: number;
  priority?: number;
}

export interface Decision {
  plans: ItemPlan[];
  warehouseBuys?: WarehouseBuy[];
  removeItems?: string[];
}

export interface ApplyResult {
  machine: MachineState;
  spend: number;
  unitsBought: Record<string, number>;
}

export function createMachine(cash: number = CONFIG.STARTING_CASH): MachineState {
  return {
    cash,
    warehouse: {},
    slots: Array.from({ length: CONFIG.SLOTS }, () => ({
      itemId: null,
      qty: 0,
      price: 0,
    })),
  };
}

export function slotOf(machine: MachineState, itemId: string): Slot | undefined {
  return machine.slots.find((s) => s.itemId === itemId);
}

export function qtyOf(machine: MachineState, itemId: string): number {
  return slotOf(machine, itemId)?.qty ?? 0;
}

export function clampPrice(price: number, suggested: number): number {
  const lo = suggested * CONFIG.PRICE_MIN_MULT;
  const hi = suggested * CONFIG.PRICE_MAX_MULT;
  const safePrice = Number.isFinite(price) ? price : suggested;
  return snapPrice(Math.max(lo, Math.min(hi, safePrice)));
}

function wholeUnits(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function applyDecision(
  machine: MachineState,
  decision: Decision,
  wholesale: Record<string, number>
): ApplyResult {
  const slots: Slot[] = machine.slots.map((s) => ({ ...s }));
  const warehouse = { ...machine.warehouse };
  let cash = machine.cash;
  const unitsBought: Record<string, number> = {};
  const removed = new Set(
    (decision.removeItems ?? []).filter((itemId) => ITEM_BY_ID[itemId] !== undefined)
  );
  for (const slot of slots) {
    if (!slot.itemId || !removed.has(slot.itemId)) continue;
    slot.itemId = null;
    slot.qty = 0;
    slot.price = 0;
  }
  let warehouseUnits = Object.values(warehouse).reduce(
    (sum, qty) => sum + Math.max(0, qty),
    0
  );

  const warehouseBuys = (decision.warehouseBuys ?? [])
    .map((buy, index) => ({ buy, index }))
    .filter(({ buy }) => ITEM_BY_ID[buy.itemId] !== undefined)
    .sort(
      (a, b) =>
        (a.buy.priority ?? a.index) - (b.buy.priority ?? b.index) ||
        a.index - b.index
    );

  for (const { buy } of warehouseBuys) {
    const unitCost = wholesale[buy.itemId];
    if (unitCost === undefined || !Number.isFinite(unitCost) || unitCost <= 0) continue;
    const wanted = wholeUnits(buy.qty);
    const storageRoom = Math.max(0, CONFIG.WAREHOUSE_CAP - warehouseUnits);
    const affordable = Math.floor((cash + 1e-9) / unitCost);
    const qty = Math.min(wanted, storageRoom, affordable);
    if (qty <= 0) continue;
    warehouse[buy.itemId] = (warehouse[buy.itemId] ?? 0) + qty;
    warehouseUnits += qty;
    cash -= qty * unitCost;
    unitsBought[buy.itemId] = (unitsBought[buy.itemId] ?? 0) + qty;
  }

  const indexed = decision.plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => ITEM_BY_ID[plan.itemId] !== undefined)
    .sort(
      (a, b) =>
        (a.plan.priority ?? a.index) - (b.plan.priority ?? b.index) ||
        a.index - b.index
    );

  for (const { plan } of indexed) {
    const unitCost = wholesale[plan.itemId];
    if (unitCost === undefined || !Number.isFinite(unitCost) || unitCost <= 0) continue;
    const item = ITEM_BY_ID[plan.itemId];
    const suggested = suggestedPrice(item, unitCost);
    const wanted = wholeUnits(plan.buyQty);
    const refillWanted = wholeUnits(plan.refillQty ?? 0);

    let slot = slots.find((s) => s.itemId === plan.itemId);
    if (!slot) {
      if (wanted <= 0 && refillWanted <= 0) continue;
      const free = slots.find((s) => s.itemId === null);
      if (!free) continue;

      const refill = Math.min(
        CONFIG.SLOT_CAP,
        refillWanted,
        warehouse[plan.itemId] ?? 0
      );
      const buyRoom = CONFIG.SLOT_CAP - refill;
      const buy = Math.min(buyRoom, wanted);
      const affordable = Math.floor((cash + 1e-9) / unitCost);
      const purchased = Math.min(buy, affordable);
      if (refill + purchased <= 0) continue;
      free.itemId = item.id;
      free.qty = refill + purchased;
      free.price = clampPrice(plan.price ?? suggested, suggested);
      warehouse[item.id] = (warehouse[item.id] ?? 0) - refill;
      warehouseUnits -= refill;
      cash -= purchased * unitCost;
      unitsBought[item.id] = (unitsBought[item.id] ?? 0) + purchased;
      continue;
    }

    if (plan.price !== undefined) {
      slot.price = clampPrice(plan.price, suggested);
    }

    const refill = Math.min(
      CONFIG.SLOT_CAP - slot.qty,
      refillWanted,
      warehouse[plan.itemId] ?? 0
    );
    slot.qty += refill;
    warehouse[plan.itemId] = (warehouse[plan.itemId] ?? 0) - refill;
    warehouseUnits -= refill;

    const buyRoom = CONFIG.SLOT_CAP - slot.qty;
    const buy = Math.min(buyRoom, wanted);
    if (buy <= 0) continue;
    const affordable = Math.floor((cash + 1e-9) / unitCost);
    const qty = Math.min(buy, affordable);
    if (qty <= 0) continue;
    slot.qty += qty;
    cash -= qty * unitCost;
    unitsBought[item.id] = (unitsBought[item.id] ?? 0) + qty;
  }

  return {
    machine: { cash: roundToCents(cash), slots, warehouse },
    spend: roundToCents(machine.cash - cash),
    unitsBought,
  };
}

export function salvageValue(
  machine: MachineState,
  wholesale: Record<string, number>
): number {
  let total = 0;
  for (const slot of machine.slots) {
    if (!slot.itemId || slot.qty <= 0) continue;
    total += slot.qty * (wholesale[slot.itemId] ?? 0) * CONFIG.SALVAGE_RATE;
  }
  for (const [itemId, qty] of Object.entries(machine.warehouse)) {
    total += Math.max(0, qty) * (wholesale[itemId] ?? 0) * CONFIG.SALVAGE_RATE;
  }
  return roundToCents(total);
}
