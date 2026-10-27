import random
from poker_agent.cards import draws
from poker_agent.database import PlayerStore
from poker_agent.history import parse_hand_log
from poker_agent.models import Action, GameState, Player
from poker_agent.strategy import EquityStrategy, HandContext, OpponentProfile

A, B = '"alice @ idA"', '"bob @ idB"'
LOG = [
    "-- starting hand #4 (id: h4)  No Limit Texas Hold'em (dealer: \"alice @ idA\") --",
    f'Player stacks: #1 {A} (1000) | #2 {B} (800)',
    f"{A} posts a small blind of 10",
    f"{B} posts a big blind of 20",
    f"{A} raises to 60",
    f"{B} raises to 180",
    f"{A} calls 180",
    "Flop:  [10♣, 7♥, 6♠]",
    f"{B} bets 100",
    f"{A} folds",
    f'Uncalled bet of 100 returned to {B}',
    f"{B} collected 360 from pot",
    "-- ending hand #4 --",
]


def entries(lines):
    # Poker Now returns newest first.
    return [{"msg": m, "createdAt": str(1000 + i)} for i, m in enumerate(lines)][::-1]


def test_parse_hand_log_actions_and_facing():
    hand = parse_hand_log(entries(LOG))
    assert hand.complete and hand.number == 4 and hand.hand_id == "h4"
    assert hand.players["idB"] == {"name": "bob", "seat": 2, "stack": 800.0}
    assert hand.board == ["Tc", "7h", "6s"]
    summary = [(a["player_id"], a["street"], a["action"], a["facing"]) for a in hand.actions]
    assert summary == [("idA", "preflop", "raise", "blind"), ("idB", "preflop", "3bet", "raise"),
                       ("idA", "preflop", "call", "raise"), ("idB", "flop", "bet", "none"),
                       ("idA", "flop", "fold", "bet")]
    assert hand.winners == {"idB": 360.0}


def test_imported_hands_drive_player_stats(tmp_path):
    store = PlayerStore(tmp_path / "p.db")
    store.add_parsed_hand("g", parse_hand_log(entries(LOG)))
    assert store.add_parsed_hand("g", parse_hand_log(entries(LOG))) is False
    assert store.last_hand_number("g") == 4
    bob = store.player_stats("bob")
    assert bob["player_id"] == "idB" and bob["threebet_rate"] == 1.0 and bob["cbet"] == 1.0
    alice = store.player_stats("idA")
    assert alice["fold_to_bet"] == 1.0 and alice["vpip"] == 1.0 and alice["pfr"] == 1.0


def test_draw_detection():
    assert draws(["Ah", "5h"], ["Kh", "9h", "2c"])["flush_draw"]
    assert draws(["8c", "9d"], ["Tc", "7h", "2s"])["straight_draw"] == "open_ended"
    assert draws(["8c", "Td"], ["Jc", "7h", "2s"])["straight_draw"] == "gutshot"
    assert draws(["2c", "3d"], ["Kh", "9h", "8c"]) == {"flush_draw": False, "straight_draw": None}


def river_spot():
    return GameState("h", "me", 1000, ("2c", "3d"), ("Kh", "9h", "8c", "Js", "Qd"), pot=100,
                     hero_turn=True, parse_confidence=1, big_blind=20, min_raise_to=20,
                     players=[Player("me", 1, 1000), Player("opp", 2, 1000)])


def bluff_rate(context, n=300):
    strategy = EquityStrategy(iterations=150, rng=random.Random(3))
    return sum(strategy.decide(river_spot(), context).action == Action.BET for _ in range(n)) / n


def test_bluffs_more_against_folders_than_calling_stations():
    folder = HandContext(opponents=[OpponentProfile("opp", 200, 0.3, 0.75, 1.0)])
    station = HandContext(opponents=[OpponentProfile("opp", 200, 0.6, 0.1, 0.5)])
    assert bluff_rate(folder) > 0.15
    assert bluff_rate(station) < bluff_rate(folder) / 2
    assert EquityStrategy(iterations=150, bluffing=False).decide(river_spot(), folder).action == Action.CHECK


def test_bluff_and_value_bets_use_same_size():
    strategy = EquityStrategy(iterations=150, rng=random.Random(5))
    folder = HandContext(opponents=[OpponentProfile("opp", 200, 0.3, 0.9, 1.0)])
    bluff = next(d for d in (strategy.decide(river_spot(), folder) for _ in range(50)) if d.action == Action.BET)
    value_spot = river_spot()
    value_spot.hero_cards = ("Ah", "Tc")
    value = strategy.decide(value_spot, folder)
    assert value.action == Action.BET and value.amount == bluff.amount
