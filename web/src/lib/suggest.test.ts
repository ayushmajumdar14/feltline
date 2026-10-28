import { describe, expect, it } from "vitest";
import { suggestLive, type LiveTableState } from "./suggest";
import { classOf, Range } from "./theory-ranges";
import { effectiveBb } from "./theory-decide";

const base: LiveTableState = {
  game_id: "abc",
  hand_number: 1,
  street: "preflop",
  pot: 3,
  board: [],
  hero_cards: ["Ah", "Kd"],
  hero_stack: 200,
  hero_bet: 0,
  hero_id: "me",
  hero_seat: 3,
  dealer_seat: 3,
  amount_to_call: 2,
  big_blind: 2,
  hero_turn: true,
  to_act: "hero",
  history: [],
  seats: [
    { seat: 3, player_id: "me", name: "me", stack: 200, in_hand: true },
    { seat: 4, player_id: "sb", name: "sb", stack: 200, in_hand: true },
    { seat: 5, player_id: "bb", name: "bb", stack: 200, in_hand: true },
    { seat: 1, player_id: "ep", name: "ep", stack: 200, in_hand: true },
  ],
};

describe("suggestLive theory engine", () => {
  it("opens strong preflop hands", () => {
    const s = suggestLive(base);
    expect(s.suggested_action).toBe("raise");
    expect(s.size).toBeGreaterThan(0);
    expect(s.reason.toLowerCase()).toMatch(/open|jam/);
  });

  it("folds a weak hand to a raise", () => {
    const s = suggestLive({
      ...base,
      hero_cards: ["7c", "2d"],
      amount_to_call: 8,
      history: [["ep", "preflop", "raise", 6]],
    });
    expect(s.suggested_action).toBe("fold");
  });

  it("jams short-stack opens instead of min-raising", () => {
    const short: LiveTableState = {
      ...base,
      hero_stack: 20,
      seats: base.seats.map((s) => (s.player_id === "me" ? { ...s, stack: 20 } : { ...s, stack: 200 })),
    };
    const s = suggestLive(short);
    expect(s.suggested_action).toBe("raise");
    expect(s.size).toBe(20);
    expect(s.reason).toMatch(/jam/i);
  });
});

describe("line and stack ranges", () => {
  it("treats AKo as a strong class", () => {
    expect(classOf(["Ah", "Kd"])).toBe("AKo");
  });

  it("builds a tighter range for a jam than a 2.5x open", () => {
    const open = Range.top(0.27);
    const jam = Range.top(0.27 * 0.85);
    expect(jam.total()).toBeLessThan(open.total());
  });

  it("uses the shortest remaining stack as effective bb", () => {
    expect(effectiveBb(200, [40, 180], 2)).toBe(20);
    expect(effectiveBb(18, [200], 2)).toBe(9);
  });
});
