import { CONFIG } from "../sim/config";
import type { DayStats } from "../sim/day";
import { createGame, type GameState } from "../sim/game";
import { ITEM_BY_ID } from "../sim/items";
import type { Decision, MachineState, Slot } from "../sim/machine";
import type { Plan, PlanSlot } from "./plan";

const STORAGE_KEY = "vending-wars-game-saves-v1";
export const MAX_GAME_SAVES = 3;

export interface GameProgress {
  day: number;
  machine: MachineState;
  history: DayStats[];
}

export interface GameSave {
  id: string;
  savedAt: string;
  seed: number;
  opponentId: string;
  human: GameProgress;
  agent: GameProgress;
  planning: boolean;
  humanDecision: Decision | null;
  agentDecision: Decision | null;
  plan: Plan;
  warehouseBuys: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isItemId(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(ITEM_BY_ID, value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSlot(value: unknown): value is Slot {
  if (
    !isRecord(value) ||
    !(value.itemId === null || isItemId(value.itemId)) ||
    !isNonnegativeInteger(value.qty) ||
    value.qty > CONFIG.SLOT_CAP ||
    !isFiniteNumber(value.price) ||
    value.price < 0
  ) {
    return false;
  }
  return value.itemId === null
    ? value.qty === 0 && value.price === 0
    : value.price > 0;
}

function isMachineState(value: unknown): value is MachineState {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.cash) ||
    value.cash < 0 ||
    !Array.isArray(value.slots) ||
    value.slots.length !== CONFIG.SLOTS ||
    !value.slots.every(isSlot) ||
    !isRecord(value.warehouse)
  ) {
    return false;
  }

  const slots = value.slots as Slot[];
  const itemIds = slots.flatMap((slot) => (slot.itemId ? [slot.itemId] : []));
  if (new Set(itemIds).size !== itemIds.length) return false;

  let warehouseUnits = 0;
  for (const [itemId, qty] of Object.entries(value.warehouse)) {
    if (!isItemId(itemId) || !isNonnegativeInteger(qty)) return false;
    warehouseUnits += qty;
  }
  return warehouseUnits <= CONFIG.WAREHOUSE_CAP;
}

function isCountMap(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([itemId, count]) => isItemId(itemId) && isNonnegativeInteger(count)
    )
  );
}

function isDayStats(value: unknown): value is DayStats {
  return (
    isRecord(value) &&
    isNonnegativeInteger(value.day) &&
    value.day < CONFIG.DAYS &&
    isFiniteNumber(value.revenue) &&
    isFiniteNumber(value.spend) &&
    isFiniteNumber(value.cogs) &&
    isFiniteNumber(value.profit) &&
    isNonnegativeInteger(value.unitsSold) &&
    isCountMap(value.byItem) &&
    isRecord(value.walkaways) &&
    isNonnegativeInteger(value.walkaways.notStocked) &&
    isNonnegativeInteger(value.walkaways.tooExpensive) &&
    isCountMap(value.wantedNotStocked) &&
    isFiniteNumber(value.endingCash) &&
    value.endingCash >= 0 &&
    isNonnegativeInteger(value.endingWarehouseUnits) &&
    value.endingWarehouseUnits <= CONFIG.WAREHOUSE_CAP &&
    (value.salvage === undefined || isFiniteNumber(value.salvage))
  );
}

function isGameProgress(value: unknown): value is GameProgress {
  return (
    isRecord(value) &&
    isNonnegativeInteger(value.day) &&
    value.day <= CONFIG.DAYS &&
    isMachineState(value.machine) &&
    Array.isArray(value.history) &&
    value.history.length === value.day &&
    value.history.every((stats, index) => isDayStats(stats) && stats.day === index)
  );
}

function isPlanSlot(value: unknown): value is PlanSlot {
  return (
    isRecord(value) &&
    isItemId(value.itemId) &&
    isFiniteNumber(value.price) &&
    value.price > 0 &&
    isNonnegativeInteger(value.buy) &&
    value.buy <= CONFIG.SLOT_CAP &&
    isNonnegativeInteger(value.refill) &&
    value.refill <= CONFIG.SLOT_CAP
  );
}

function isPlan(value: unknown): value is Plan {
  if (!Array.isArray(value) || value.length !== CONFIG.SLOTS) return false;
  if (!value.every((slot) => slot === null || isPlanSlot(slot))) return false;
  const itemIds = (value as (PlanSlot | null)[]).flatMap((slot) =>
    slot ? [slot.itemId] : []
  );
  return new Set(itemIds).size === itemIds.length;
}

function isDecisionPlan(value: unknown): boolean {
  return (
    isRecord(value) &&
    isItemId(value.itemId) &&
    isNonnegativeInteger(value.buyQty) &&
    value.buyQty <= CONFIG.SLOT_CAP &&
    (value.price === undefined || (isFiniteNumber(value.price) && value.price > 0)) &&
    (value.priority === undefined || isNonnegativeInteger(value.priority)) &&
    (value.refillQty === undefined ||
      (isNonnegativeInteger(value.refillQty) && value.refillQty <= CONFIG.SLOT_CAP))
  );
}

function isDecision(value: unknown): value is Decision {
  if (
    !isRecord(value) ||
    !Array.isArray(value.plans) ||
    value.plans.length > CONFIG.SLOTS ||
    !value.plans.every(isDecisionPlan)
  ) {
    return false;
  }

  const planItemIds = value.plans.map((plan) => (plan as { itemId: string }).itemId);
  if (new Set(planItemIds).size !== planItemIds.length) return false;

  if (value.warehouseBuys !== undefined) {
    if (!Array.isArray(value.warehouseBuys) || value.warehouseBuys.length > Object.keys(ITEM_BY_ID).length) {
      return false;
    }
    const buys = value.warehouseBuys;
    if (
      !buys.every(
        (buy) =>
          isRecord(buy) &&
          isItemId(buy.itemId) &&
          isNonnegativeInteger(buy.qty) &&
          buy.qty <= CONFIG.WAREHOUSE_CAP &&
          (buy.priority === undefined || isNonnegativeInteger(buy.priority))
      )
    ) {
      return false;
    }
    const buyItemIds = buys.map((buy) => (buy as { itemId: string }).itemId);
    if (new Set(buyItemIds).size !== buyItemIds.length) return false;
  }

  return (
    value.removeItems === undefined ||
    (Array.isArray(value.removeItems) &&
      value.removeItems.length <= CONFIG.SLOTS &&
      value.removeItems.every(
        (itemId) => isItemId(itemId)
      ) &&
      new Set(value.removeItems).size === value.removeItems.length)
  );
}

function isWarehouseBuys(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([itemId, qty]) => isItemId(itemId) && isNonnegativeInteger(qty) && qty > 0
    )
  );
}

function isGameSave(value: unknown): value is GameSave {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    typeof value.savedAt !== "string" ||
    !Number.isFinite(Date.parse(value.savedAt)) ||
    typeof value.seed !== "number" ||
    !Number.isSafeInteger(value.seed) ||
    value.seed < 0 ||
    typeof value.opponentId !== "string" ||
    value.opponentId.length === 0 ||
    value.opponentId.length > 80 ||
    typeof value.planning !== "boolean" ||
    !isGameProgress(value.human) ||
    !isGameProgress(value.agent) ||
    value.human.day !== value.agent.day ||
    !(value.humanDecision === null || isDecision(value.humanDecision)) ||
    !(value.agentDecision === null || isDecision(value.agentDecision)) ||
    !isPlan(value.plan) ||
    !isWarehouseBuys(value.warehouseBuys)
  ) {
    return false;
  }

  if (
    (value.planning &&
      (value.human.day >= CONFIG.DAYS ||
        value.humanDecision !== null ||
        value.agentDecision !== null)) ||
    (!value.planning &&
      (value.human.day === 0 || !value.humanDecision || !value.agentDecision))
  ) {
    return false;
  }

  const plannedSlots = value.plan.filter((slot): slot is PlanSlot => slot !== null);
  for (const slot of plannedSlots) {
    const held =
      value.human.machine.slots.find((machineSlot) => machineSlot.itemId === slot.itemId)
        ?.qty ?? 0;
    if (held + slot.buy + slot.refill > CONFIG.SLOT_CAP) return false;
  }

  const plannedWarehouseUnits = Object.values(value.warehouseBuys).reduce(
    (total, qty) => total + qty,
    0
  );
  const heldWarehouseUnits = Object.values(value.human.machine.warehouse).reduce(
    (total, qty) => total + qty,
    0
  );
  return heldWarehouseUnits + plannedWarehouseUnits <= CONFIG.WAREHOUSE_CAP;
}

export function parseGameSaves(serialized: string | null): GameSave[] {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isGameSave)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .slice(0, MAX_GAME_SAVES);
  } catch {
    return [];
  }
}

export function readGameSaves(): GameSave[] {
  try {
    return parseGameSaves(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeGameSaves(saves: GameSave[]): void {
  const limited = saves.slice(0, MAX_GAME_SAVES);
  if (limited.length === 0) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(limited));
}

export function upsertGameSave(saves: GameSave[], save: GameSave): GameSave[] {
  return [save, ...saves.filter((existing) => existing.id !== save.id)].slice(
    0,
    MAX_GAME_SAVES
  );
}

export function newGameSaveId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function restoreGame(seed: number, progress: GameProgress): GameState {
  return { ...createGame(seed), ...progress };
}
