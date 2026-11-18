import { CONFIG } from "./config";
import { ITEMS, type Item } from "./items";
import { normal, stream, type Rng } from "./rng";
import { roundToCents } from "./util";

export interface Market {
  history: Record<string, number[]>;
}

export function snapPrice(x: number): number {
  return roundToCents(Math.round(x / CONFIG.PRICE_STEP) * CONFIG.PRICE_STEP);
}

export function generateMarket(seed: number): Market {
  const totalDays = CONFIG.PREHISTORY_DAYS + CONFIG.DAYS;
  const history: Record<string, number[]> = {};
  for (const item of ITEMS) {
    const rng = stream(seed, "market", item.id);
    let logP = Math.log(item.baseWholesale);
    const days: number[] = [];
    for (let d = 0; d < totalDays; d++) {
      logP +=
        CONFIG.MARKET_KAPPA * (Math.log(item.baseWholesale) - logP) +
        item.trend +
        item.volatility * normal(rng);
      days.push(roundToCents(Math.exp(logP)));
    }
    history[item.id] = days;
  }
  return { history };
}

export function wholesaleAt(market: Market, itemId: string, day: number): number {
  return market.history[itemId][CONFIG.PREHISTORY_DAYS + day];
}

export function wholesaleHistory(market: Market, itemId: string, day: number): number[] {
  return market.history[itemId].slice(0, CONFIG.PREHISTORY_DAYS + day);
}

export function suggestedPrice(item: Item, wholesale: number): number {
  return snapPrice(item.refPrice * Math.sqrt(wholesale / item.baseWholesale));
}

export function makeRng(seed: number, ...labels: (string | number)[]): Rng {
  return stream(seed, ...labels);
}
