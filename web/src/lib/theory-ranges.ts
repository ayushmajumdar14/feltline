import { score } from "./theory-cards";

export const RANKING = [
  "AA", "KK", "QQ", "JJ", "TT", "99", "88", "AKs", "AQs", "AJs", "ATs", "AKo", "KQs", "AQo", "77",
  "KJs", "AJo", "KTs", "A8s", "A9s", "ATo", "66", "KQo", "QJs", "QTs", "A7s", "KJo", "K9s", "JTs",
  "A9o", "A5s", "A6s", "KTo", "A4s", "QJo", "K8s", "55", "A8o", "Q9s", "A3s", "A7o", "K7s", "QTo",
  "K9o", "J9s", "A5o", "Q8s", "K6s", "JTo", "A2s", "A6o", "J8s", "Q9o", "T9s", "K8o", "K5s", "A4o",
  "44", "K4s", "A3o", "Q7s", "J9o", "T8s", "A2o", "K3s", "K7o", "J7s", "Q8o", "T9o", "K2s", "Q6s",
  "K6o", "Q4s", "J8o", "33", "K4o", "K5o", "97s", "98s", "Q5s", "T7s", "Q3s", "Q7o", "T8o", "J6s",
  "87s", "J5s", "T6s", "Q6o", "Q2s", "J7o", "J4s", "Q5o", "96s", "98o", "22", "K2o", "K3o", "T7o",
  "J2s", "86s", "J3s", "T5s", "76s", "T4s", "95s", "97o", "J6o", "Q4o", "J5o", "T6o", "T3s", "Q3o",
  "87o", "T2s", "75s", "85s", "96o", "Q2o", "65s", "J4o", "84s", "94s", "54s", "J3o", "86o", "74s",
  "J2o", "93s", "76o", "T4o", "64s", "T5o", "92s", "85o", "53s", "95o", "63s", "75o", "T3o", "83s",
  "65o", "73s", "82s", "43s", "94o", "T2o", "54o", "52s", "93o", "74o", "72s", "62s", "84o", "64o",
  "92o", "42s", "83o", "32s", "73o", "53o", "63o", "43o", "82o", "52o", "62o", "72o", "42o", "32o",
] as const;

const RANKS = "23456789TJQKA";

export const COMBOS: [number, number][] = [];
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) COMBOS.push([a, b]);

function comboClass(a: number, b: number): string {
  const ra = a >> 2, rb = b >> 2;
  const hi = Math.max(ra, rb), lo = Math.min(ra, rb);
  if (hi === lo) return RANKS[hi] + RANKS[hi];
  return RANKS[hi] + RANKS[lo] + ((a & 3) === (b & 3) ? "s" : "o");
}

export const COMBO_CLASS = COMBOS.map(([a, b]) => comboClass(a, b));
const CLASS_COMBOS: Record<string, number[]> = Object.fromEntries(RANKING.map((c) => [c, [] as number[]]));
COMBO_CLASS.forEach((c, i) => CLASS_COMBOS[c].push(i));
const CLASS_BAND: Record<string, [number, number]> = {};
{
  let done = 0;
  for (const c of RANKING) {
    CLASS_BAND[c] = [done / 1326, (done + CLASS_COMBOS[c].length) / 1326];
    done += CLASS_COMBOS[c].length;
  }
}

export function classOf(cards: string[]): string {
  const [a, b] = cards.map((c) => {
    const r = "23456789TJQKA".indexOf(c[0].toUpperCase());
    const s = "cdhs".indexOf(c[1].toLowerCase());
    return r * 4 + s;
  });
  return comboClass(a, b);
}

export function inTop(cls: string, pct: number): number {
  const [lo, hi] = CLASS_BAND[cls] || [1, 1];
  if (pct <= lo) return 0;
  if (pct >= hi) return 1;
  return (pct - lo) / (hi - lo);
}

export function bandWeight(cls: string, loPct: number, hiPct: number): number {
  return Math.max(0, inTop(cls, hiPct) - inTop(cls, loPct));
}

function hasDraw(cards: number[]): boolean {
  const suits = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    suits[c & 3] += 1;
    mask |= 1 << (c >> 2);
  }
  if (suits.some((n) => n === 4)) return true;
  const m = (mask << 1) | (mask & (1 << 12) ? 1 : 0);
  for (let k = 1; k < 10; k++) if (((m >> k) & 0b1111) === 0b1111) return true;
  return false;
}

export class Range {
  w: number[];
  constructor(weights?: number[]) {
    this.w = weights ? weights.slice() : Array(1326).fill(1);
  }

  static fromClasses(fn: (c: string) => number) {
    return new Range(COMBO_CLASS.map(fn));
  }

  static top(pct: number, floor = 0) {
    return Range.fromClasses((c) => Math.max(floor, inTop(c, pct)));
  }

  static band(lo: number, hi: number, topWeight = 0, floor = 0) {
    return Range.fromClasses((c) => Math.max(floor, bandWeight(c, lo, hi) + topWeight * inTop(c, lo)));
  }

  copy() {
    return new Range(this.w);
  }

  scale(factor: number) {
    this.w = this.w.map((x) => x * factor);
    return this;
  }

  add(other: Range) {
    this.w = this.w.map((a, i) => Math.min(1, a + other.w[i]));
    return this;
  }

  remove(dead: number[]) {
    const d = new Set(dead);
    for (let i = 0; i < 1326; i++) {
      const [a, b] = COMBOS[i];
      if (d.has(a) || d.has(b)) this.w[i] = 0;
    }
    return this;
  }

  total() {
    return this.w.reduce((a, b) => a + b, 0);
  }

  strengths(board: number[]) {
    const dead = new Set(board);
    const scored: { s: number; i: number }[] = [];
    for (let i = 0; i < 1326; i++) {
      if (this.w[i] <= 0) continue;
      const [a, b] = COMBOS[i];
      if (dead.has(a) || dead.has(b)) continue;
      scored.push({ s: score([a, b, ...board]), i });
    }
    scored.sort((x, y) => x.s - y.s);
    const total = scored.reduce((a, x) => a + this.w[x.i], 0) || 1;
    const out = new Map<number, [number, boolean]>();
    let below = 0, k = 0;
    while (k < scored.length) {
      let j = k;
      while (j < scored.length && scored[j].s === scored[k].s) j++;
      const tie = scored.slice(k, j).reduce((a, x) => a + this.w[x.i], 0);
      const pct = (below + tie / 2) / total;
      for (let t = k; t < j; t++) {
        const i = scored[t].i;
        const [a, b] = COMBOS[i];
        out.set(i, [pct, board.length < 5 && hasDraw([a, b, ...board]) && !hasDraw(board)]);
      }
      below += tie;
      k = j;
    }
    return out;
  }

  percentileOf(hand: number[], board: number[]): number {
    const mine = score([...hand, ...board]);
    const dead = new Set([...board, ...hand]);
    let below = 0, tie = 0, total = 0;
    for (let i = 0; i < 1326; i++) {
      const w = this.w[i];
      if (w <= 0) continue;
      const [a, b] = COMBOS[i];
      if (dead.has(a) || dead.has(b)) continue;
      const s = score([a, b, ...board]);
      total += w;
      if (s < mine) below += w;
      else if (s === mine) tie += w;
    }
    return total ? (below + tie / 2) / total : 0.5;
  }

  narrow(action: string, board: number[], aggression = 1) {
    if (action === "fold") return this;
    const info = this.strengths(board);
    const bluff = Math.max(0.03, Math.min(0.45, 0.15 * aggression));
    const blur = action === "bet" || action === "raise" ? Math.max(0, Math.min(0.85, (aggression - 1) / 1.5)) : 0;
    for (let i = 0; i < 1326; i++) {
      if (this.w[i] <= 0) continue;
      const hit = info.get(i);
      if (!hit) {
        this.w[i] = 0;
        continue;
      }
      const [p, draw] = hit;
      let f = 1;
      if (action === "bet") f = p >= 0.7 ? 1 : draw ? 0.65 : p >= 0.45 ? 0.3 : bluff;
      else if (action === "raise") f = p >= 0.85 ? 1 : p >= 0.7 ? 0.45 : draw ? 0.35 : bluff / 3;
      else if (action === "call") f = p >= 0.92 ? 0.55 : p >= 0.35 ? 1 : draw ? 0.9 : 0.12;
      else if (action === "check") f = p >= 0.85 ? 0.45 : 1;
      this.w[i] *= f + (1 - f) * blur;
    }
    return this;
  }
}

export function pickWeighted(combos: [number, number][], cum: number[], rand: () => number): [number, number] {
  const t = rand() * cum[cum.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return combos[lo];
}

export function equityVsRanges(
  hero: number[],
  board: number[],
  ranges: Range[],
  iterations: number,
  rand: () => number,
): number {
  const dead = new Set([...hero, ...board]);
  const pools = ranges.map((r) => {
    const idx = COMBOS.map((_, i) => i).filter((i) => r.w[i] > 0 && !dead.has(COMBOS[i][0]) && !dead.has(COMBOS[i][1]));
    const use = idx.length ? idx : COMBOS.map((_, i) => i).filter((i) => !dead.has(COMBOS[i][0]) && !dead.has(COMBOS[i][1]));
    const weights = use.map((i) => (idx.length ? r.w[i] : 1));
    const combos = use.map((i) => COMBOS[i]);
    const cum: number[] = [];
    let acc = 0;
    for (const w of weights) {
      acc += w;
      cum.push(acc);
    }
    return { combos, cum };
  });
  const need = 5 - board.length;
  const deck = [...Array(52).keys()].filter((c) => !dead.has(c));
  let won = 0, done = 0;
  for (let n = 0; n < iterations; n++) {
    const used = new Set<number>();
    const hands: number[][] = [];
    let ok = true;
    for (const pool of pools) {
      let picked: [number, number] | null = null;
      for (let t = 0; t < 20; t++) {
        const [a, b] = pickWeighted(pool.combos, pool.cum, rand);
        if (!used.has(a) && !used.has(b)) {
          picked = [a, b];
          break;
        }
      }
      if (!picked) {
        ok = false;
        break;
      }
      used.add(picked[0]);
      used.add(picked[1]);
      hands.push(picked);
    }
    if (!ok) continue;
    const rest = deck.filter((c) => !used.has(c));
    const full = board.slice();
    for (let k = 0; k < need; k++) {
      const j = Math.floor(rand() * rest.length);
      full.push(rest.splice(j, 1)[0]);
    }
    const mine = score([...hero, ...full]);
    let best = true, tied = 1;
    for (const h of hands) {
      const theirs = score([...h, ...full]);
      if (theirs > mine) {
        best = false;
        break;
      }
      if (theirs === mine) tied += 1;
    }
    done += 1;
    if (best) won += 1 / tied;
  }
  return done ? won / done : 0;
}
