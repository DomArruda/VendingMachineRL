import { CONFIG } from "./config";
import type { Item } from "./items";
import type { Rng } from "./rng";

export interface CustomerDraw {
  desireU: number;
  subU: number;
  buyU: number;
  walkU: number;
  pickSubU: number;
  pickAltU: number;
  altBuyU: number;
}

export function drawCustomers(rng: Rng, count: number): CustomerDraw[] {
  const customers: CustomerDraw[] = [];
  for (let i = 0; i < count; i++) {
    customers.push({
      desireU: rng(),
      subU: rng(),
      buyU: rng(),
      walkU: rng(),
      pickSubU: rng(),
      pickAltU: rng(),
      altBuyU: rng(),
    });
  }
  return customers;
}

export function customerCount(rng: Rng): number {
  return (
    CONFIG.CUSTOMERS_MIN +
    Math.floor(rng() * (CONFIG.CUSTOMERS_MAX - CONFIG.CUSTOMERS_MIN + 1))
  );
}

export function buyProbability(item: Item, price: number): number {
  const ratio = price / item.refPrice;
  const below =
    ratio < 1 ? 1 + CONFIG.BONUS_BELOW_REF * (1 - ratio) : 1;
  const p =
    CONFIG.B0 *
    Math.exp(
      -item.elasticity * CONFIG.PRICE_SENSITIVITY * Math.max(0, ratio - 1)
    ) *
    below;
  return Math.max(0, Math.min(0.98, p));
}
