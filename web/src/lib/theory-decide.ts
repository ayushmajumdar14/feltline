import type { Action, OppStats } from "./poker";
import type { LiveSuggestion, LiveTableState } from "./suggest";
import { draws, mulberry32, toInts } from "./theory-cards";
import { bandWeight, classOf, equityVsRanges, inTop, Range } from "./theory-ranges";

export type LiveProfile = {
  player_id: string;
  hands: number;
  vpip?: number;
  pfr?: number;
  foldToBet?: number;
  af?: number;
};

type Seat = { distance: number; smallBlind: boolean; bigBlind: boolean; players: number };
type Hist = [string, string, string, number | null];

const OPEN_BY_DISTANCE = [0.43, 0.27, 0.21, 0.17, 0.14, 0.12, 0.11, 0.1, 0.09];
const POPULATION_FOLD = 0.45;
const POPULATION_VPIP = 0.35;
const PRIOR_HANDS = 20;

function shrink(obs: number | undefined, prior: number, hands: number) {
  if (obs == null) return prior;
  const w = hands / (hands + PRIOR_HANDS);
  return w * obs + (1 - w) * prior;
}

function openShare(seat: Seat): number {
  if (seat.players <= 2) return seat.smallBlind || seat.distance === 0 ? 0.8 : 0;
  if (seat.smallBlind) return 0.4;
  if (seat.bigBlind) return 0;
  return OPEN_BY_DISTANCE[Math.min(seat.distance, OPEN_BY_DISTANCE.length - 1)];
}

export function effectiveBb(heroStack: number, stacks: number[], bb: number): number {
  const others = stacks.filter((s) => s > 0);
  const eff = others.length ? Math.min(heroStack, ...others) : heroStack;
  return Math.max(eff, 0) / Math.max(bb, 1e-9);
}

function stackOpenMult(stackBb: number): number {
  if (stackBb <= 8) return 1.55;
  if (stackBb <= 15) return 1.35;
  if (stackBb <= 25) return 1.18;
  if (stackBb <= 40) return 1.08;
  if (stackBb >= 200) return 0.82;
  if (stackBb >= 150) return 0.9;
  return 1;
}

function sizedOpenShare(seat: Seat, stackBb: number): number {
  const base = openShare(seat);
  if (base <= 0) return 0;
  const cap = seat.players <= 2 ? 0.92 : 0.55;
  return Math.min(cap, Math.max(0.06, base * stackOpenMult(stackBb)));
}

function jammed(stackBb: number, raiseToBb: number | null): boolean {
  if (stackBb <= 15) return true;
  return raiseToBb != null && raiseToBb >= 0.7 * Math.max(stackBb, 1);
}

function preflopRangeFor(
  kind: string,
  seat: Seat,
  profile: LiveProfile | undefined,
  stackBb: number,
  raiseToBb: number | null,
  facingBb: number | null,
): Range {
  const vpip = profile ? shrink(profile.vpip, POPULATION_VPIP, profile.hands) : undefined;
  const pfr = profile ? shrink(profile.pfr, 0.18, profile.hands) : undefined;
  let openW = sizedOpenShare(seat, stackBb) || 0.12;
  if (pfr != null && profile && profile.hands >= 15) openW = Math.min(0.85, Math.max(0.06, pfr * stackOpenMult(stackBb)));
  const isJam = jammed(stackBb, raiseToBb);

  if (kind === "open") {
    if (isJam) return Range.top(Math.min(0.4, openW * (stackBb <= 10 ? 1.15 : 0.85)));
    if (raiseToBb != null && raiseToBb <= 2.2) return Range.top(Math.min(0.55, openW * 1.15));
    return Range.top(openW);
  }
  if (kind === "3bet") {
    if (isJam) return Range.top(Math.min(0.18, stackBb <= 12 ? 0.11 : 0.08));
    const value = raiseToBb && raiseToBb >= 9 ? 0.05 : 0.06;
    const bluffHi = raiseToBb && raiseToBb >= 9 ? 0.16 : 0.2;
    return Range.top(value).add(Range.band(0.1, bluffHi).scale(0.25));
  }
  if (kind === "4bet") return Range.top(isJam ? 0.05 : 0.03);
  if (kind === "call_raise") {
    let width = vpip != null && profile && profile.hands >= 15 ? vpip : seat.bigBlind ? 0.45 : 0.18;
    if (facingBb != null && facingBb >= 8) width = Math.min(width, 0.1);
    else if (facingBb != null && facingBb >= 4) width *= 0.7;
    else if (facingBb != null && facingBb <= 2.2) width = Math.min(0.5, width * 1.15);
    if (stackBb <= 20) width = Math.min(width, 0.12);
    return Range.band(0.04, Math.max(width, 0.06), 0.3);
  }
  if (kind === "limp") return Range.band(0.08, Math.max(vpip ?? 0.35, 0.1), 0.25);
  return Range.top(1);
}

function preflopLine(pid: string, history: Hist[]): string {
  let raises = 0;
  let line = "none";
  for (const [actor, street, action] of history) {
    if (street !== "preflop") continue;
    if (action === "bet" || action === "raise") {
      raises += 1;
      if (actor === pid) line = raises === 1 ? "open" : raises === 2 ? "3bet" : "4bet";
    } else if (action === "call" && actor === pid && line === "none") {
      line = raises ? "call_raise" : "limp";
    }
  }
  return line;
}

function lineSizing(pid: string, history: Hist[], bb: number): { raiseToBb: number | null; facingBb: number | null } {
  let raiseToBb: number | null = null;
  let facingBb: number | null = null;
  for (const [actor, street, action, amount] of history) {
    if (street !== "preflop" || amount == null) continue;
    const size = amount / Math.max(bb, 1e-9);
    if (action === "bet" || action === "raise") {
      if (actor === pid) raiseToBb = size;
      else facingBb = size;
    } else if (action === "call" && actor === pid) facingBb = facingBb ?? size;
  }
  return { raiseToBb, facingBb };
}

function seatsFromState(state: LiveTableState): { map: Map<string, Seat>; hero: Seat; n: number } {
  const live = state.seats.filter((s) => s.in_hand !== false);
  const n = Math.max(2, live.length + (live.some((s) => s.player_id === state.hero_id) ? 0 : 1));
  const ordered = [...live].sort((a, b) => a.seat - b.seat);
  const dealer = state.dealer_seat ?? Math.min(...ordered.map((s) => s.seat), 0);
  const start = ordered.findIndex((s) => s.seat > dealer);
  const fromBtn = start < 0 ? ordered : [...ordered.slice(start), ...ordered.slice(0, start)];
  const map = new Map<string, Seat>();
  fromBtn.forEach((s, idx) => {
    const small = n === 2 ? idx === n - 1 : idx === 0;
    const big = n === 2 ? idx === 0 : idx === 1;
    map.set(s.player_id, { distance: n - 1 - idx, smallBlind: small, bigBlind: big, players: n });
  });
  const heroId = state.hero_id || "";
  const hero = map.get(heroId) || { distance: 0, smallBlind: false, bigBlind: false, players: n };
  return { map, hero, n };
}

function boardTexture(board: string[]): "wet" | "dry" {
  if (board.length < 3) return "dry";
  const ints = toInts(board.slice(0, 4));
  const suits = [0, 0, 0, 0];
  const rankSet = new Set<number>();
  for (const c of ints) {
    suits[c & 3] += 1;
    rankSet.add(c >> 2);
  }
  const ranks = [...rankSet].sort((a, b) => a - b);
  const paired = ranks.length < ints.length;
  const connected = ranks.some((_, i) => i + 2 < ranks.length && ranks[i + 2] - ranks[i] <= 4);
  const wet = Math.max(...suits) >= 3 || (Math.max(...suits) === 2 && connected) || (connected && !paired && ranks[ranks.length - 1] >= 7);
  return wet ? "wet" : "dry";
}

function geometricFraction(spr: number, streetsLeft: number) {
  return ((1 + 2 * spr) ** (1 / streetsLeft) - 1) / 2;
}

function buildRanges(state: LiveTableState, history: Hist[], profiles: Map<string, LiveProfile>, bb: number) {
  const { map, n } = seatsFromState(state);
  const heroId = state.hero_id || "";
  const heroInts = state.hero_cards.length === 2 ? toInts(state.hero_cards) : [];
  const board = state.board.length ? toInts(state.board) : [];
  const out = new Map<string, Range>();
  const streetCards: Record<string, number> = { flop: 3, turn: 4, river: 5 };
  for (const s of state.seats.filter((x) => x.in_hand !== false || x.player_id === heroId)) {
    const seat = map.get(s.player_id) || { distance: 0, smallBlind: false, bigBlind: false, players: n };
    const { raiseToBb, facingBb } = lineSizing(s.player_id, history, bb);
    const stackBb = effectiveBb(s.stack, state.seats.filter((o) => o.player_id !== s.player_id && o.in_hand !== false).map((o) => o.stack), bb);
    const rng = preflopRangeFor(preflopLine(s.player_id, history), seat, profiles.get(s.player_id), stackBb, raiseToBb, facingBb);
    if (s.player_id !== heroId && heroInts.length === 2) rng.remove(heroInts);
    const profile = profiles.get(s.player_id);
    const looseness = shrink(profile?.vpip, POPULATION_VPIP, profile?.hands ?? 0);
    const af = shrink(profile?.af, 1.5, profile?.hands ?? 0);
    const aggression = Math.max(0.3, Math.min(2.5, af / 1.5)) * Math.min(1, looseness / POPULATION_VPIP);
    for (const [, street, action] of history.filter((h) => h[0] === s.player_id && streetCards[h[1]])) {
      const nCards = streetCards[street];
      if (board.length >= nCards) rng.narrow(action, board.slice(0, nCards), aggression);
    }
    out.set(s.player_id, rng.remove(board));
  }
  return out;
}

function pack(
  state: LiveTableState,
  action: Action,
  size: number | null,
  reason: string,
  confidence: number,
): LiveSuggestion {
  const toCall = Number(state.amount_to_call || 0);
  return {
    id: `ext-${state.game_id}-${state.hand_number}-${state.street}-${Math.round(toCall)}`,
    accepted: "pending",
    suggested_action: action,
    size,
    reason,
    confidence,
  };
}

function playShare(cls: string, share: number) {
  const f = inTop(cls, share);
  return { play: f >= 0.5, freq: f };
}

export function decideTheory(state: LiveTableState, profiles: LiveProfile[] = []): LiveSuggestion {
  const bb = state.big_blind || 2;
  const toCall = Number(state.amount_to_call || 0);
  const heroStack = Number(state.hero_stack || 0);
  const pot = Number(state.pot || 0);
  const hero = state.hero_cards || [];
  const minTo = Number(state.min_raise_to || toCall + bb);
  const history = (state.history ?? []) as Hist[];
  const heroId = state.hero_id || "";
  const heroBet = Number(state.hero_bet || 0);
  const maxTo = heroBet + heroStack;
  const liveOpps = state.seats.filter((s) => s.player_id !== heroId && s.in_hand !== false);
  const stackBb = effectiveBb(heroStack, liveOpps.map((s) => s.stack), bb);
  const spr = stackBb * bb / Math.max(pot, 1);

  if (hero.length !== 2) return pack(state, "check", null, "Waiting for hole cards.", 40);

  const byId = new Map(profiles.map((p) => [p.player_id, p]));
  const { hero: heroSeat } = seatsFromState(state);
  const cls = classOf(hero);
  const rand = mulberry32((state.hand_number || 1) * 10007 + cls.charCodeAt(0));
  const ranges = buildRanges(state, history, byId, bb);
  const oppRanges = liveOpps.map((s) => ranges.get(s.player_id) || Range.top(0.35));
  const n = Math.max(1, liveOpps.length);
  const foldFactor = (() => {
    if (!liveOpps.length) return 1;
    const folds = Math.min(...liveOpps.map((s) => shrink(byId.get(s.player_id)?.foldToBet, POPULATION_FOLD, byId.get(s.player_id)?.hands ?? 0)));
    return Math.max(0.3, Math.min(1.7, folds / POPULATION_FOLD));
  })();

  const raiseTo = (amount: number, why: string, conf: number): LiveSuggestion => {
    const size = Math.min(Math.max(minTo, Math.round(amount)), maxTo);
    if (size <= heroBet + toCall && toCall > 0) return pack(state, "call", toCall, `${why} (capped)`, conf);
    return pack(state, toCall ? "raise" : "bet", size, why, conf);
  };

  if (state.street === "preflop") {
    const bigDecision = toCall >= 0.35 * (heroStack + heroBet) && toCall > 4 * bb;
    if (bigDecision && oppRanges.length) {
      const eq = equityVsRanges(toInts(hero), [], oppRanges, 280, rand);
      const potOdds = toCall / (pot + toCall);
      const call = eq >= potOdds;
      return pack(
        state,
        call ? "call" : "fold",
        call ? toCall : null,
        `stack-off ${stackBb.toFixed(0)}bb: equity ${eq.toFixed(2)} vs ranges, pot odds ${potOdds.toFixed(2)}`,
        call ? 72 : 68,
      );
    }

    const raises = history.filter((h) => h[1] === "preflop" && (h[2] === "bet" || h[2] === "raise"));
    const limpers = history.filter((h) => h[1] === "preflop" && h[0] !== heroId && h[2] === "call").length;
    if (!raises.length) {
      if (heroSeat.bigBlind && toCall === 0) return pack(state, "check", null, `${cls} ${stackBb.toFixed(0)}bb, big blind checks`, 70);
      const share = sizedOpenShare(heroSeat, stackBb);
      const { play, freq } = playShare(cls, share);
      if (!heroSeat.bigBlind && play) {
        const size = heroSeat.smallBlind && heroSeat.players > 2 ? 3 * bb : 2.5 * bb;
        if (stackBb <= 15 || size >= 0.35 * maxTo) {
          return raiseTo(maxTo, `${cls} open jam ${stackBb.toFixed(0)}bb (top ${Math.round(share * 100)}%)`, 70 + freq * 10);
        }
        return raiseTo(size, `${cls} open ${Math.round(share * 100)}% at ${stackBb.toFixed(0)}bb`, 62 + freq * 12);
      }
      if (limpers && playShare(cls, (share || 0.15) * 0.6).play && !heroSeat.bigBlind) {
        return raiseTo((3 + limpers) * bb, `${cls} isolate ${limpers} limper(s)`, 64);
      }
      if (toCall === 0) return pack(state, "check", null, `${cls} outside open ${stackBb.toFixed(0)}bb`, 60);
      return pack(state, "fold", null, `${cls} fold vs open range at ${stackBb.toFixed(0)}bb`, 64);
    }
    if (raises.length === 1) {
      const value = Math.min(0.1, Math.max(0.025, 0.08));
      if (playShare(cls, value).play) {
        const size = (heroBet + toCall) * 3;
        if (stackBb <= 25 || size >= 0.4 * maxTo) return raiseTo(maxTo, `${cls} value 3-bet jam ${stackBb.toFixed(0)}bb`, 76);
        return raiseTo(size, `${cls} value 3-bet`, 74);
      }
      if (cls.endsWith("s") && bandWeight(cls, 0.12, 0.22) >= 0.5) {
        return raiseTo((heroBet + toCall) * 3, `${cls} 3-bet bluff`, 58);
      }
      if (inTop(cls, 0.22) >= 0.5 && toCall <= 4 * bb) return pack(state, "call", toCall, `${cls} flat vs open`, 60);
      return pack(state, toCall ? "fold" : "check", null, `${cls} fold to open at ${stackBb.toFixed(0)}bb`, 64);
    }
    if (inTop(cls, 0.025) >= 0.5) return raiseTo((heroBet + toCall) * 2.4, `${cls} value 4-bet`, 78);
    if (inTop(cls, 0.07) >= 0.5) return pack(state, "call", toCall, `${cls} call 3-bet`, 62);
    return pack(state, "fold", null, `${cls} fold to 3-bet`, 68);
  }

  const eq = oppRanges.length
    ? equityVsRanges(toInts(hero), toInts(state.board), oppRanges, 280, rand)
    : 0.5;
  const texture = boardTexture(state.board);
  const street = state.board.length;
  const note = `range equity ${eq.toFixed(2)} vs ${n} · ${texture} · SPR ${spr.toFixed(1)} · ${stackBb.toFixed(0)}bb`;
  const sizeFrac = street === 3 && texture === "dry" ? 0.33 : street === 5 ? 0.75 : 0.66;
  const betTo = (fraction: number, why: string, conf: number) => {
    let f = fraction;
    if (spr <= 3 && why.startsWith("value")) f = Math.max(f, Math.min(1.2, geometricFraction(spr, 6 - street)));
    const size = heroBet + toCall + (pot + toCall) * f;
    return raiseTo(size, `${note}, ${why} ${Math.round(f * 100)}% pot`, conf);
  };

  const d = draws(hero, state.board);
  if (toCall === 0) {
    const valueCut = 0.6 + 0.08 * (n - 1);
    if (eq >= valueCut) return betTo(sizeFrac, "value bet", 70);
    if (n <= 2) {
      let p = 0;
      let kind = "";
      if (street <= 4 && (d.flush_draw || d.straight_draw === "open_ended")) {
        p = street === 3 ? 0.65 : 0.5;
        kind = "semi-bluff";
      } else if (street === 3) {
        p = texture === "dry" ? 0.55 : 0.25;
        kind = "c-bet";
      }
      p *= foldFactor * (n === 2 ? 0.4 : 1);
      if (p >= 0.45) return betTo(sizeFrac, kind, 52 + p * 20);
    }
    return pack(state, "check", null, note, 58);
  }

  const potOdds = toCall / (pot + toCall);
  const canRaise = maxTo > heroBet + toCall;
  if (canRaise && eq >= (n === 1 ? 0.72 : 0.8)) return betTo(0.9, "value raise", 74);
  if (canRaise && n === 1 && street === 3 && (d.flush_draw || d.straight_draw === "open_ended") && foldFactor >= 0.9) {
    return betTo(0.9, "semi-bluff raise", 58);
  }
  if (eq >= potOdds) return pack(state, "call", toCall, `${note}, pot odds ${potOdds.toFixed(2)}`, 64);
  const heroRange = ranges.get(heroId) || Range.top(0.35);
  const mdf = 1 / (1 + toCall / Math.max(pot - toCall, 1));
  if (n === 1) {
    const pct = heroRange.percentileOf(toInts(hero), toInts(state.board));
    if (pct >= 1 - mdf) return pack(state, "call", toCall, `${note}, MDF defend (top ${Math.round(mdf * 100)}%)`, 60);
  }
  return pack(state, "fold", null, `${note}, pot odds ${potOdds.toFixed(2)}`, 66);
}

export function profilesFromStats(
  state: LiveTableState,
  opponents: { id: string; player_id: string | null }[],
  stats: Map<string, OppStats>,
): LiveProfile[] {
  const heroId = state.hero_id || "";
  return state.seats
    .filter((s) => s.player_id !== heroId)
    .map((s) => {
      const row = opponents.find((o) => o.player_id === s.player_id);
      const st = row ? stats.get(row.id) : undefined;
      return {
        player_id: s.player_id,
        hands: st?.hands ?? 0,
        vpip: st?.vpip,
        pfr: st?.pfr,
        foldToBet: st?.foldToBet,
        af: st?.af,
      };
    });
}
