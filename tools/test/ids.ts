// createIds: a seeded generator of cell and execution ids so fixtures are stable.

export type Ids = {
  /** `c_` plus six lowercase base36 characters. */
  readonly cell: () => string;
  /** `x_` plus eight lowercase base36 characters. */
  readonly execution: () => string;
};

/** mulberry32: a small deterministic PRNG over a 32-bit state. */
const prng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Returns id generators whose sequence depends only on `seed`. */
export function createIds(seed: number): Ids {
  const next = prng(seed);
  const base36 = (length: number): string =>
    Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)] ?? "0").join("");
  return {
    cell: () => `c_${base36(6)}`,
    execution: () => `x_${base36(8)}`,
  };
}
