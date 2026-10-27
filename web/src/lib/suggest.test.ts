import { describe, expect, it } from "vitest";
import { suggestLive, type LiveTableState } from "./suggest";

const base: LiveTableState = {
  game_id: "abc",
  hand_number: 1,
  street: "preflop",
  pot: 3,
  board: [],
  hero_cards: ["Ah", "Kd"],
  hero_stack: 200,
  amount_to_call: 0,
  big_blind: 2,
  hero_turn: true,
  to_act: "hero",
  seats: [],
};

describe("suggestLive", () => {
  it("opens strong preflop hands", () => {
    const s = suggestLive(base);
    expect(s.suggested_action).toBe("raise");
    expect(s.size).toBeGreaterThan(0);
  });

  it("folds a weak hand to a raise", () => {
    const s = suggestLive({ ...base, hero_cards: ["7c", "2d"], amount_to_call: 8 });
    expect(s.suggested_action).toBe("fold");
  });
});
