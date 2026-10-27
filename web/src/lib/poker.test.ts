import { describe, expect, it } from "vitest";
import {
  autoplayDelayMs,
  canEnableAutoplay,
  computeStats,
  formatSuggestion,
  parsePokerNowUrl,
  shrink,
  type ActionRow,
} from "./poker";

describe("auto-play gating", () => {
  it("requires all four checklist items", () => {
    expect(canEnableAutoplay([true, true, true, false])).toBe(false);
    expect(canEnableAutoplay([true, true, true])).toBe(false);
    expect(canEnableAutoplay([true, true, true, true])).toBe(true);
  });
  it("countdown stays within 1.0–1.6s", () => {
    expect(autoplayDelayMs(0)).toBe(1000);
    expect(autoplayDelayMs(1)).toBe(1600);
  });
});

describe("stats", () => {
  it("shrinks toward prior with low samples", () => {
    expect(shrink(1, 1, 0.3)).toBeCloseTo((1 + 6) / 21);
  });
  it("flags low sample under 20 hands", () => {
    const acts: ActionRow[] = [
      { hand_id: "h1", seq: 1, actor: "o", street: "preflop", action: "call", amount: 6, facing: "raise" },
    ];
    const s = computeStats("o", ["h1"], acts, new Set(), 0);
    expect(s.lowSample).toBe(true);
    expect(s.hands).toBe(1);
  });
});

describe("copy + parsing", () => {
  it("formats raise as RAISE to N", () => {
    expect(formatSuggestion("raise", 60)).toBe("RAISE to 60");
    expect(formatSuggestion("check", null)).toBe("CHECK");
  });
  it("accepts only Poker Now game links", () => {
    expect(parsePokerNowUrl("https://www.pokernow.club/games/abc123")).toBe("abc123");
    expect(parsePokerNowUrl("https://www.pokerstars.com/games/abc")).toBeNull();
  });
});
