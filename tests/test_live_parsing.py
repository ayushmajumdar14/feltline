import json
import random
from poker_agent.cards import rank_hand, equity, normalize_card
from poker_agent.models import Action
from poker_agent.pokernow_state import TableTracker, apply_diff
from poker_agent.strategy import EquityStrategy

ME = "bot"


def frame(event, payload):
    return "42" + json.dumps([event, payload])


def seated_tracker():
    t = TableTracker()
    t.feed(frame("registered", {"currentPlayer": {"id": ME}, "gameState": {
        "gN": 7, "hI": "hand7", "bigBlind": 20, "pot": 0, "mR": 40, "cHB": 20,
        "seats": [[1, "opp"], [3, ME]],
        "players": {"opp": {"stack": 980}, ME: {"stack": 990}},
        "pGS": {"opp": "inGame", ME: "inGame"},
        "pC": {"opp": {"cards": [{"value": None}, {"value": None}]},
               ME: {"cards": [{"value": "Ac"}, {"value": "Ad"}]}},
        "oTC": {"1": []}, "tB": {ME: 10, "opp": 20},
        "cPI": ME, "sNA": "FCPFS"}}))
    return t


def test_apply_diff_deep_merges_and_deletes():
    state = {"players": {"a": {"stack": 10, "name": "x"}}, "tB": {"a": 5}}
    apply_diff(state, {"players": {"a": {"stack": 7}}, "tB": {"a": "<D>"}})
    assert state == {"players": {"a": {"stack": 7, "name": "x"}}, "tB": {}}


def test_hand_ranking_order():
    assert rank_hand(["As", "Ks", "Qs", "Js", "Ts", "2c", "3d"])[0] == 8
    assert rank_hand(["Ah", "2d", "3c", "4s", "5h", "9c", "Kd"]) == (4, 5)
    assert rank_hand(["Kh", "Kd", "Kc", "2s", "2h", "9c", "8d"])[0] == 6
    assert rank_hand(["Kh", "Kd", "Qc", "Qs", "2h", "9c", "8d"]) > rank_hand(["Kh", "Kd", "Qc", "Js", "2h", "9c", "8d"])
    assert normalize_card("10c") == "Tc"


def test_equity_is_sane():
    rng = random.Random(1)
    assert equity(["As", "Ah"], [], 1, 1500, rng) > 0.8
    assert equity(["7c", "2d"], [], 1, 1500, rng) < 0.4


def test_tracker_reads_hero_turn_state():
    s = seated_tracker().game_state()
    assert s.hero_turn and s.parse_confidence == 1
    assert s.hero_cards == ("Ac", "Ad") and s.board == ()
    assert s.pot == 30 and s.amount_to_call == 10 and s.hero_bet == 10
    assert s.min_raise_to == 40 and len(s.players) == 2


def test_turn_ends_when_status_leaves_fcpfs_even_if_cpi_lags():
    t = seated_tracker()
    t.feed(frame("gC", {"sNA": "NSAA", "tB": {ME: 60}, "cHB": 60}))
    assert not t.hero_turn


def test_equity_strategy_raises_aces_and_folds_trash():
    t = seated_tracker()
    d = EquityStrategy(rng=random.Random(2)).decide(t.game_state())
    assert d.action == Action.RAISE and 40 <= d.amount <= 1000
    t.feed(frame("gC", {"pC": {ME: {"cards": [{"value": "7c"}, {"value": "2d"}]}},
                        "tB": {"opp": 400}, "cHB": 400}))
    assert EquityStrategy(rng=random.Random(2)).decide(t.game_state()).action == Action.FOLD
