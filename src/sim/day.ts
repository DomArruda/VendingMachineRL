import { CONFIG } from "./config";
import { buyProbability, type CustomerDraw } from "./customers";
import { ITEM_BY_ID, ITEMS, type Category } from "./items";
import {
  applyDecision,
  type Decision,
  type MachineState,
  type Slot,
} from "./machine";
import { pickWeighted } from "./rng";
import { roundToCents } from "./util";

export interface DaySetup {
  day: number;
  wholesale: Record<string, number>;
  customers: CustomerDraw[];
}

export interface DayWalkaways {
  notStocked: number;
  tooExpensive: number;
}

export interface DayStats {
  day: number;
  revenue: number;
  spend: number;
  cogs: number;
  profit: number;
  unitsSold: number;
  byItem: Record<string, number>;
  walkaways: DayWalkaways;
  wantedNotStocked: Record<string, number>;
  endingCash: number;
  endingWarehouseUnits: number;
  salvage?: number;
}

export interface DayEvent {
  customer: number;
  desiredItemId: string;
  soldItemId: string | null;
  outcome: "buy" | "walk";
  reason?: "not-stocked" | "price";
  substitute: boolean;
}

export interface DayResult {
  machine: MachineState;
  stats: DayStats;
  log: DayEvent[];
}

const DESIRE_WEIGHTS = ITEMS.map((item) => item.popularity);

function chooseStocked(
  slots: readonly Slot[],
  category: Category | null,
  excludeItemId: string | null,
  u: number
): Slot | null {
  const eligible: Slot[] = [];
  const weights: number[] = [];
  for (const slot of slots) {
    if (!slot.itemId || slot.qty <= 0) continue;
    if (slot.itemId === excludeItemId) continue;
    const item = ITEM_BY_ID[slot.itemId];
    if (!item) continue;
    if (category && item.category !== category) continue;
    eligible.push(slot);
    weights.push(item.popularity);
  }
  return pickWeighted(eligible, weights, u);
}

export function runDay(
  machine: MachineState,
  setup: DaySetup,
  decision: Decision
): DayResult {
  const applied = applyDecision(machine, decision, setup.wholesale);
  const slots = applied.machine.slots;

  let cash = applied.machine.cash;
  let revenue = 0;
  let cogs = 0;
  let unitsSold = 0;
  const byItem: Record<string, number> = {};
  const wantedNotStocked: Record<string, number> = {};
  const walkaways: DayWalkaways = { notStocked: 0, tooExpensive: 0 };
  const log: DayEvent[] = [];

  const sell = (slot: Slot): void => {
    const item = ITEM_BY_ID[slot.itemId!];
    slot.qty -= 1;
    revenue += slot.price;
    cogs += setup.wholesale[item.id] ?? 0;
    unitsSold += 1;
    byItem[item.id] = (byItem[item.id] ?? 0) + 1;
  };

  for (let i = 0; i < setup.customers.length; i++) {
    const customer = setup.customers[i];
    const desired = pickWeighted(ITEMS, DESIRE_WEIGHTS, customer.desireU)!;

    let slot = slots.find((s) => s.itemId === desired.id && s.qty > 0) ?? null;
    let substitute = false;

    if (!slot) {
      wantedNotStocked[desired.id] = (wantedNotStocked[desired.id] ?? 0) + 1;
      if (customer.subU < CONFIG.P_SUBSTITUTE) {
        slot = chooseStocked(slots, desired.category, null, customer.pickSubU);
        substitute = true;
      }
    }

    if (!slot) {
      walkaways.notStocked += 1;
      log.push({
        customer: i,
        desiredItemId: desired.id,
        soldItemId: null,
        outcome: "walk",
        reason: "not-stocked",
        substitute: false,
      });
      continue;
    }

    const firstItem = ITEM_BY_ID[slot.itemId!];
    if (customer.buyU < buyProbability(firstItem, slot.price)) {
      sell(slot);
      cash += slot.price;
      log.push({
        customer: i,
        desiredItemId: desired.id,
        soldItemId: firstItem.id,
        outcome: "buy",
        substitute,
      });
      continue;
    }

    if (customer.walkU >= CONFIG.P_WALK_ON_REJECT) {
      const alt = chooseStocked(slots, null, slot.itemId, customer.pickAltU);
      if (alt) {
        const altItem = ITEM_BY_ID[alt.itemId!];
        const altP = buyProbability(altItem, alt.price) * CONFIG.ALT_PROB_MULT;
        if (customer.altBuyU < altP) {
          sell(alt);
          cash += alt.price;
          log.push({
            customer: i,
            desiredItemId: desired.id,
            soldItemId: altItem.id,
            outcome: "buy",
            substitute: true,
          });
          continue;
        }
      }
    }

    walkaways.tooExpensive += 1;
    log.push({
      customer: i,
      desiredItemId: desired.id,
      soldItemId: null,
      outcome: "walk",
      reason: "price",
      substitute,
    });
  }

  const stats: DayStats = {
    day: setup.day,
    revenue: roundToCents(revenue),
    spend: applied.spend,
    cogs: roundToCents(cogs),
    profit: roundToCents(revenue - applied.spend),
    unitsSold,
    byItem,
    walkaways,
    wantedNotStocked,
    endingCash: roundToCents(cash),
    endingWarehouseUnits: Object.values(applied.machine.warehouse).reduce(
      (total, qty) => total + Math.max(0, qty),
      0
    ),
  };

  applied.machine.cash = stats.endingCash;

  return { machine: applied.machine, stats, log };
}
