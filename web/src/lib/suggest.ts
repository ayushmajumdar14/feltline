import type { Action, OppStats } from "./poker";
import { decideTheory, profilesFromStats, type LiveProfile } from "./theory-decide";

export type LiveHistory = [string, string, string, number | null];

export type LiveTableState = {
  game_id: string;
  hand_number: number;
  street: "preflop" | "flop" | "turn" | "river";
  pot: number;
  board: string[];
  hero_cards: string[];
  hero_stack?: number;
  hero_bet?: number;
  hero_id?: string;
  hero_seat?: number;
  dealer_seat?: number;
  amount_to_call?: number;
  min_raise_to?: number | null;
  big_blind?: number;
  hero_turn?: boolean;
  to_act: string;
  history?: LiveHistory[];
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

/** Theory engine on the live extension path: ranges from the line, stacks, opponent book. */
export function suggestLive(
  state: LiveTableState,
  _strategy: "theory" | "equity" = "theory",
  profiles: LiveProfile[] = [],
): LiveSuggestion {
  return decideTheory(state, profiles);
}

export { profilesFromStats };
export type { LiveProfile, OppStats };
