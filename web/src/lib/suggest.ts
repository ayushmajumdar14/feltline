import type { Action } from "./poker";

export type LiveTableState = {
  game_id: string;
  hand_number: number;
  street: "preflop" | "flop" | "turn" | "river";
  pot: number;
  board: string[];
  hero_cards: string[];
  hero_stack?: number;
  amount_to_call?: number;
  min_raise_to?: number | null;
  big_blind?: number;
  hero_turn?: boolean;
  to_act: string;
  seats: { seat: number; player_id: string; name: string; stack: number; in_hand: boolean }[];
};

export type LiveSuggestion = {
  id: string;
  accepted: "pending";
  suggested_action: Action;
  size: number | null;
  reason: string;
  confidence: number;
};

const RANK: Record<string, number> = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };

function ranks(cards: string[]) {
  return cards.map((c) => RANK[c[0]] || 0).sort((a, b) => b - a);
}

function suited(cards: string[]) {
  return cards.length >= 2 && cards[0][1] === cards[1][1];
}

function pair(cards: string[]) {
  const r = ranks(cards);
  return r.length >= 2 && r[0] === r[1];
}

function boardPair(board: string[]) {
  const r = ranks(board);
  return r.some((v, i) => r.indexOf(v) !== i);
}

function madePair(hero: string[], board: string[]) {
  const hr = ranks(hero);
  const br = ranks(board);
  if (hr[0] && hr[0] === hr[1]) return hr[0];
  for (const v of hr) if (br.includes(v)) return v;
  return 0;
}

function flushDraw(hero: string[], board: string[]) {
  const all = [...hero, ...board];
  const suits: Record<string, number> = {};
  for (const c of all) suits[c[1]] = (suits[c[1]] || 0) + 1;
  return Object.values(suits).some((n) => n === 4);
}

/** Compact live suggestion. Not GTO — enough to coach a private table from the extension. */
export function suggestLive(state: LiveTableState, _strategy: "theory" | "equity" = "theory"): LiveSuggestion {
  const bb = state.big_blind || 2;
  const toCall = Number(state.amount_to_call || 0);
  const stack = Number(state.hero_stack || 0);
  const pot = Number(state.pot || 0);
  const hero = state.hero_cards || [];
  const board = state.board || [];
  const minTo = Number(state.min_raise_to || toCall + bb);
  const id = `ext-${state.game_id}-${state.hand_number}-${state.street}-${Math.round(toCall)}`;

  const pack = (action: Action, size: number | null, reason: string, confidence: number): LiveSuggestion => ({
    id,
    accepted: "pending",
    suggested_action: action,
    size,
    reason,
    confidence,
  });

  if (hero.length !== 2) return pack("check", null, "Waiting for hole cards.", 40);

  const r = ranks(hero);
  const premium = (pair(hero) && r[0] >= 12) || (r[0] === 14 && r[1] >= 13);
  const strong = pair(hero) || (r[0] >= 13 && r[1] >= 11) || (suited(hero) && r[0] >= 13);
  const openTo = Math.min(stack, Math.max(minTo, Math.round(bb * 2.5)));

  if (state.street === "preflop") {
    if (toCall === 0) {
      if (strong) return pack("raise", openTo, `Open ${hero.join(" ")} to ${openTo}.`, premium ? 78 : 62);
      return pack("check", null, "Fold/check this opener. Wait for a better spot.", 58);
    }
    if (premium) return pack("raise", Math.min(stack, Math.max(minTo, toCall * 3)), "Value 3-bet a premium.", 74);
    if (strong && toCall <= 4 * bb) return pack("call", toCall, "Call in position/range. Not a 3-bet.", 60);
    if (toCall >= stack * 0.35) return pack("fold", null, "Too large vs this hand. Fold.", 70);
    return pack("fold", null, "Fold this preflop raise.", 64);
  }

  const made = madePair(hero, board);
  const draw = flushDraw(hero, board);
  const bet = Math.min(stack, Math.max(bb, Math.round(pot * (boardPair(board) ? 0.5 : 0.66))));

  if (toCall === 0) {
    if (made >= 12 || (made && state.street === "flop")) return pack("bet", bet, `C-bet ${bet} with a made hand on ${state.street}.`, 68);
    if (draw && state.street !== "river") return pack("bet", Math.round(pot * 0.5), "Semi-bluff the flush draw.", 55);
    return pack("check", null, "Check. No made hand worth a lead.", 57);
  }
  if (made >= 11) return pack("call", toCall, "Call with a strong pair.", 66);
  if (made && toCall <= pot * 0.55) return pack("call", toCall, "Call one street with a pair.", 58);
  if (draw && toCall <= pot * 0.6 && state.street !== "river") return pack("call", toCall, "Call with a flush draw.", 56);
  if (toCall === 0) return pack("check", null, "Check.", 50);
  return pack("fold", null, "Fold. Facing a bet without enough hand.", 63);
}
