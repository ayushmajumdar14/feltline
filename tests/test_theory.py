import json
import random
import numpy as np
from poker_agent.cards import DECK, rank_hand, score, to_ints
from poker_agent.models import Action, GameState, Player
from poker_agent.pokernow_state import TableTracker
from poker_agent.preflop import Seat, preflop_decision
from poker_agent.ranges import Range, equity_vs_ranges
from poker_agent.river import solve
from poker_agent.sim import SimStats, make_strategy, play_hand
from poker_agent.strategy import HandContext
from poker_agent.theory import TheoryStrategy, board_texture, geometric_fraction


def test_fast_score_matches_reference_ranking():
    rng = random.Random(4)
    for _ in range(3000):
        a, b = rng.sample(DECK, 7), rng.sample(DECK, 7)
        assert (rank_hand(a) > rank_hand(b)) == (score(to_ints(a)) > score(to_ints(b)))
        assert (rank_hand(a) == rank_hand(b)) == (score(to_ints(a)) == score(to_ints(b)))


def test_range_width_and_equity_vs_tight_range():
    assert abs(Range.top(0.10).total() - 132.6) < 1
    rng = random.Random(1)
    vs_tight = equity_vs_ranges(["Qs", "Js"], [], [Range.top(0.08)], 1500, rng)
    vs_loose = equity_vs_ranges(["Qs", "Js"], [], [Range.top(0.8)], 1500, rng)
    assert vs_tight < 0.42 < vs_loose


def test_betting_narrows_range_toward_strong_hands():
    board = to_ints(["Kh", "9h", "2c"])
    wide = Range.top(0.5).remove(board)
    bet = wide.copy().narrow("bet", board)
    k_combos = lambda r: sum(r.w[i] for i, s in r.strengths(board).items() if s[0] > 0.7)
    assert k_combos(bet) / bet.total() > k_combos(wide) / wide.total()


def test_river_solver_reproduces_toy_game_equilibrium():
    s = solve(np.array([0.5, 0, 0.5]), np.array([0, 1.0, 0]), pot=1.0, bet=1.0, iterations=2000)
    assert abs(s["root"][0, 1] - 0.5) < 0.05    # bluff half the air with a pot-sized bet
    assert s["root"][2, 1] > 0.95               # always bet the nuts
    assert abs(s["b"][1, 1] - 0.5) < 0.05       # bluff-catcher calls at MDF = 1/(1+1)


def test_texture_and_geometric_sizing():
    assert board_texture(["Kd", "7s", "2c"]) == "dry"
    assert board_texture(["Jh", "Th", "8c"]) == "wet"
    f = geometric_fraction(spr=4, streets_left=3)
    pot, stack = 1.0, 4.0
    for _ in range(3):
        bet = pot * f
        stack -= bet
        pot += 2 * bet
    assert abs(stack) < 1e-9


def preflop_state(cards, to_call=1, hero_bet=1, players=6):
    return GameState("h", "me", 199, cards, (), pot=3, amount_to_call=to_call, min_raise_to=4,
                     big_blind=2, hero_turn=True, parse_confidence=1, hero_bet=hero_bet,
                     players=[Player("me", 0, 199)] + [Player(f"p{i}", i, 200) for i in range(1, players)])


def test_preflop_chart_opens_by_position():
    rng = random.Random(2)
    early = HandContext(seat=Seat(distance=5, players=6))
    button = HandContext(seat=Seat(distance=0, players=6))
    assert preflop_decision(preflop_state(("As", "Ad"), 2, 0), early, rng).action in (Action.RAISE, Action.BET)
    assert preflop_decision(preflop_state(("7c", "2d"), 2, 0), early, rng).action == Action.FOLD
    opens = sum(preflop_decision(preflop_state(("Kd", "9s"), 2, 0), button, rng).action == Action.RAISE for _ in range(50))
    folds_early = sum(preflop_decision(preflop_state(("Kd", "9s"), 2, 0), early, rng).action == Action.FOLD for _ in range(50))
    assert opens == 50 and folds_early == 50


def test_simulated_hands_are_zero_sum_and_complete():
    strategies = {"a": make_strategy("theory", 1), "b": make_strategy("maniac", 2), "c": make_strategy("station", 3)}
    stats = SimStats()
    rng = random.Random(9)
    for h in range(15):
        deck = list(range(52))
        rng.shuffle(deck)
        net = play_hand(strategies, ["a", "b", "c"], deck, h % 3, stats, f"t{h}")
        assert abs(sum(net.values())) < 1e-6
    assert stats.stats("b")["observed_hands"] == 15


def test_tracker_builds_action_history_from_diffs():
    t = TableTracker()
    frame = lambda e, p: "42" + json.dumps([e, p])
    t.feed(frame("registered", {"currentPlayer": {"id": "me"}, "gameState": {
        "hI": "h1", "bigBlind": 20, "seats": [[1, "a"], [3, "me"]], "dealerSeat": 1,
        "pC": {"a": {"cards": []}, "me": {"cards": []}}, "tB": {"a": 10, "me": 20}, "oTC": {"1": []}}}))
    t.feed(frame("gC", {"tB": {"a": 60}}))
    t.feed(frame("gC", {"tB": {"me": 60}}))
    t.feed(frame("gC", {"oTC": {"1": ["Kh", "9h", "2c"]}, "tB": {"a": "<D>", "me": "<D>"}}))
    t.feed(frame("gC", {"tB": {"me": "check"}}))
    t.feed(frame("gC", {"tB": {"a": 40}}))
    t.feed(frame("gC", {"pGS": {"me": "fold"}}))
    assert t.history == [("a", "preflop", "raise", 60), ("me", "preflop", "call", 60),
                         ("me", "flop", "check", None), ("a", "flop", "bet", 40), ("me", "flop", "fold", None)]
    assert t.preflop_raiser == "a" and t.dealt_order() == ["me", "a"]


def test_theory_strategy_folds_weak_hand_to_big_river_bet_from_passive_player():
    from poker_agent.strategy import OpponentProfile
    state = GameState("r", "me", 900, ("2c", "3d"), ("Kh", "9h", "8c", "Js", "Qd"), pot=400, amount_to_call=200,
                      min_raise_to=400, big_blind=20, hero_turn=True, parse_confidence=1,
                      players=[Player("me", 1, 900), Player("v", 2, 700)])
    ctx = HandContext(opponents=[OpponentProfile("v", 200, 0.15, 0.6, 0.4, 0.1)], order=["me", "v"],
                      seats={"me": Seat(0, False, True, 2), "v": Seat(1, True, False, 2)},
                      history=[("v", "preflop", "raise", 60), ("me", "preflop", "call", 60),
                               ("me", "river", "check", None), ("v", "river", "bet", 200)])
    assert TheoryStrategy(iterations=200, rng=random.Random(1)).decide(state, ctx).action == Action.FOLD
