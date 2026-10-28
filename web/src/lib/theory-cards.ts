export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";
export const CARD_INDEX: Record<string, number> = Object.fromEntries(
  [...RANKS].flatMap((r, ri) => [...SUITS].map((s, si) => [r + s, ri * 4 + si])),
);

export function toInts(cards: string[]): number[] {
  return cards.map((c) => {
    let x = c.trim();
    if (x.length === 3 && x.startsWith("10")) x = "T" + x[2];
    const key = x[0].toUpperCase() + x[1].toLowerCase();
    const n = CARD_INDEX[key];
    if (n == null) throw new Error(`bad card ${c}`);
    return n;
  });
}

function straightHighMask(mask: number): number {
  const bits = (mask << 1) | (mask & (1 << 12) ? 1 : 0);
  for (let high = 13; high >= 4; high--) {
    const window = 0b11111 << (high - 4);
    if ((bits & window) === window) return high;
  }
  return 0;
}

function top(mask: number, n: number): number {
  let m = mask;
  while (bitCount(m) > n) m &= m - 1;
  return m;
}

function bitCount(n: number): number {
  n = n >>> 0;
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Pack a category + rank payload into a JS-safe number (no 40-bit shifts). */
function pack(cat: number, a = 0, b = 0, c = 0, d = 0): number {
  return (((cat * 16 + a) * 16 + b) * 16 + c) * 16 + d;
}

export function score(cards: number[]): number {
  const counts = Array(13).fill(0);
  const suits = [0, 0, 0, 0];
  let ranks = 0;
  for (const c of cards) {
    const r = c >> 2;
    counts[r] += 1;
    suits[c & 3] |= 1 << r;
    ranks |= 1 << r;
  }
  for (const sm of suits) {
    if (bitCount(sm) >= 5) {
      const high = straightHighMask(sm);
      return high ? pack(8, high) : pack(5, top(sm, 5));
    }
  }
  let quad = -1, trip = -1, trip2 = -1, pair = -1, pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = counts[r];
    if (n === 4) quad = r;
    else if (n === 3) {
      if (trip < 0) trip = r;
      else if (trip2 < 0) trip2 = r;
    } else if (n === 2) {
      if (pair < 0) pair = r;
      else if (pair2 < 0) pair2 = r;
    }
  }
  if (quad >= 0) return pack(7, quad, top(ranks & ~(1 << quad), 1));
  if (trip >= 0 && (pair >= 0 || trip2 >= 0)) return pack(6, trip, Math.max(pair, trip2));
  const high = straightHighMask(ranks);
  if (high) return pack(4, high);
  if (trip >= 0) return pack(3, trip, top(ranks & ~(1 << trip), 2));
  if (pair2 >= 0) return pack(2, pair, pair2, top(ranks & ~(1 << pair) & ~(1 << pair2), 1));
  if (pair >= 0) return pack(1, pair, top(ranks & ~(1 << pair), 3));
  return pack(0, top(ranks, 5));
}

export function draws(hero: string[], board: string[]) {
  const result: { flush_draw: boolean; straight_draw: "open_ended" | "gutshot" | null } = {
    flush_draw: false,
    straight_draw: null,
  };
  if (board.length !== 3 && board.length !== 4) return result;
  const cards = [...hero, ...board];
  const suitCount: Record<string, number> = {};
  for (const c of cards) suitCount[c[1]] = (suitCount[c[1]] || 0) + 1;
  result.flush_draw = Object.entries(suitCount).some(([s, n]) => n === 4 && hero.some((h) => h[1] === s));
  const rankVal = (c: string) => RANKS.indexOf(c[0].toUpperCase()) + 2;
  const values = new Set(cards.map(rankVal));
  const heroValues = new Set(hero.map(rankVal));
  if (values.has(14)) values.add(1);
  if (heroValues.has(14)) heroValues.add(1);
  const straightHigh = (vs: Set<number>) => {
    const copy = new Set(vs);
    if (copy.has(14)) copy.add(1);
    let run = 0;
    for (let v = 14; v >= 1; v--) {
      run = copy.has(v) ? run + 1 : 0;
      if (run === 5) return v + 4;
    }
    return 0;
  };
  if (straightHigh(values)) return result;
  for (let low = 1; low <= 10; low++) {
    const window = new Set([low, low + 1, low + 2, low + 3, low + 4]);
    const have = [...window].filter((v) => values.has(v));
    if (have.length === 4 && have.some((v) => heroValues.has(v))) {
      const missing = [...window].find((v) => !values.has(v))!;
      const edge = (missing === low || missing === low + 4) && low !== 1 && low !== 10;
      if (edge) {
        result.straight_draw = "open_ended";
        break;
      }
      result.straight_draw = result.straight_draw || "gutshot";
    }
  }
  return result;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
