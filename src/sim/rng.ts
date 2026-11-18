export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts: (string | number)[]): number {
  const s = parts.join("|");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function stream(seed: number, ...labels: (string | number)[]): Rng {
  return mulberry32(hashSeed(seed, ...labels));
}

export function pickWeighted<T>(
  items: readonly T[],
  weights: readonly number[],
  u: number
): T | null {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return null;
  let target = u * total;
  let last: T | null = null;
  for (let i = 0; i < items.length; i++) {
    const w = Math.max(0, weights[i]);
    if (w <= 0) continue;
    last = items[i];
    target -= w;
    if (target < 0) return items[i];
  }
  return last;
}

export function normal(rng: Rng): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
