"""Offline No-Limit Hold'em simulator for measuring strategies (bb/100).

Every hand starts all players at the same stack, so there are never side pots. Duplicate mode
replays each deal once per seat rotation, so each strategy holds every seat's cards, which
removes most card luck from the comparison.
"""
import math
import random
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from .cards import DECK, equity, score, to_ints
from .models import Action, Decision, GameState, Player
from .preflop import Seat
from .ranges import class_of, in_top
from .strategy import EquityStrategy, HandContext, OpponentProfile, Strategy

STREETS = ("preflop", "flop", "turn", "river")


class SimStats:
    """Online per-player counters, exposed in the same shape as PlayerStore.player_stats."""
    def __init__(self):
        self.c = defaultdict(lambda: defaultdict(int))

    def stats(self, pid):
        c = self.c[pid]
        hands = c["hands"]
        return {"player_id": pid, "observed_hands": hands,
                "vpip": c["vpip"] / hands if hands else None,
                "pfr": c["pfr"] / hands if hands else None,
                "fold_to_bet": c["fold_vs_bet"] / c["faced_bet"] if c["faced_bet"] else None,
                "aggression_factor": c["aggr"] / c["calls"] if c["calls"] else (float(c["aggr"]) if c["aggr"] else None)}

    def record_hand(self, history, dealt):
        for pid in dealt:
            self.c[pid]["hands"] += 1
        vpip, pfr = set(), set()
        for pid, street, action, _amt, facing in history:
            c = self.c[pid]
            if street == "preflop":
                if action in ("call", "bet", "raise"):
                    vpip.add(pid)
                if action in ("bet", "raise"):
                    pfr.add(pid)
                continue
            if facing:
                c["faced_bet"] += 1
                c["fold_vs_bet"] += action == "fold"
            c["aggr"] += action in ("bet", "raise")
            c["calls"] += action == "call"
        for pid in vpip:
            self.c[pid]["vpip"] += 1
        for pid in pfr:
            self.c[pid]["pfr"] += 1


def play_hand(strategies: dict, seat_pids: list, deck: list, button: int, stats: SimStats,
              hand_id: str, stack: float = 200.0, bb: float = 2.0) -> dict:
    """Play one hand. strategies: pid -> Strategy; seat_pids[i] = pid in seat i. Returns pid -> net chips."""
    n = len(seat_pids)
    stacks = [stack] * n
    bets = [0.0] * n
    contrib = [0.0] * n
    folded = [False] * n
    holes = [deck[2 * i: 2 * i + 2] for i in range(n)]
    board_all = deck[2 * n: 2 * n + 5]
    if n == 2:
        sb, bbs = button, (button + 1) % n
        pre_first, post_first = button, bbs
    else:
        sb, bbs = (button + 1) % n, (button + 2) % n
        pre_first, post_first = (button + 3) % n, sb
    seats = {}
    for i, pid in enumerate(seat_pids):
        seats[pid] = Seat(distance=(button - i) % n, small_blind=i == sb, big_blind=i == bbs, players=n)
    order = [seat_pids[(post_first + k) % n] for k in range(n)]
    history = []          # (pid, street, action, amount, faced_bet)
    preflop_raisers = []

    def post(i, amount):
        amount = min(amount, stacks[i])
        stacks[i] -= amount
        bets[i] += amount

    post(sb, bb / 2)
    post(bbs, bb)

    def active():
        return [i for i in range(n) if not folded[i]]

    def betting(street, first, board):
        highest = max(bets)
        min_inc = bb
        need = {j for j in active() if stacks[j] > 0}
        i = first
        while need and len(active()) > 1:
            live = [j for j in active() if stacks[j] > 0]
            if len(live) <= 1 and all(bets[j] >= highest for j in live):
                return
            if i not in need:
                i = (i + 1) % n
                continue
            pid = seat_pids[i]
            to_call = min(highest - bets[i], stacks[i])
            pot = sum(contrib) + sum(bets)
            min_to = min(highest + min_inc if highest else bb, bets[i] + stacks[i])
            state = GameState(hand_id, pid, stacks[i], tuple(DECK[c] for c in holes[i]), tuple(board), pot, to_call,
                              min_to, bb, str(i), True,
                              [Player(seat_pids[j], j, stacks[j]) for j in active()], 1.0, bets[i])
            last_raiser = preflop_raisers[-1] if preflop_raisers else None
            ctx = HandContext(
                hero_preflop_aggressor=last_raiser == pid,
                hero_late_position=i in (button, sb),
                opponents=[OpponentProfile.from_stats(stats.stats(seat_pids[j])) for j in active() if j != i],
                history=[h[:4] for h in history], seat=seats[pid], seats=seats,
                raiser_seat=seats[preflop_raisers[0]] if preflop_raisers else None, order=order)
            try:
                d = strategies[pid].decide(state, ctx)
            except ValueError:
                d = Decision(Action.FOLD)
            act = d.action
            if act == Action.FOLD and to_call == 0:
                act = Action.CHECK
            if act == Action.CHECK and to_call > 0:
                act = Action.FOLD
            facing = to_call > 0
            if act == Action.FOLD:
                folded[i] = True
                history.append((pid, street, "fold", None, facing))
            elif act == Action.CHECK:
                history.append((pid, street, "check", None, facing))
            elif act == Action.CALL or (act in (Action.BET, Action.RAISE) and bets[i] + stacks[i] <= highest):
                post(i, to_call)
                history.append((pid, street, "call", bets[i], facing))
            else:
                target = min(max(d.amount or 0, min_to), bets[i] + stacks[i])
                if target <= highest:
                    post(i, to_call)
                    history.append((pid, street, "call", bets[i], facing))
                else:
                    full = target - highest >= min_inc
                    if full:
                        min_inc = target - highest
                    post(i, target - bets[i])
                    highest = target
                    kind = "bet" if not facing and street != "preflop" else "raise"
                    history.append((pid, street, kind, target, facing))
                    if street == "preflop":
                        preflop_raisers.append(pid)
                    others = {j for j in active() if stacks[j] > 0 and j != i}
                    need = others if full else need | {j for j in others if bets[j] < highest}
            need.discard(i)
            i = (i + 1) % n

    shown = {"preflop": 0, "flop": 3, "turn": 4, "river": 5}
    for street in STREETS:
        board = board_all[:shown[street]]
        if len(active()) > 1:
            first = pre_first if street == "preflop" else post_first
            betting(street, first, [DECK[c] for c in board])
        for j in range(n):
            contrib[j] += bets[j]
            bets[j] = 0.0
    pot = sum(contrib)
    alive = active()
    if len(alive) == 1:
        winners = alive
    else:
        scores = {j: score(holes[j] + board_all) for j in alive}
        best = max(scores.values())
        winners = [j for j in alive if scores[j] == best]
    net = {seat_pids[j]: -contrib[j] for j in range(n)}
    for j in winners:
        net[seat_pids[j]] += pot / len(winners)
    stats.record_hand(history, seat_pids)
    return net


# ---- archetype opponents ---------------------------------------------------------

class CallingStation(Strategy):
    """Plays 60% of hands, calls almost any bet, only bets the nuts-ish."""
    def __init__(self, rng=None):
        self.rng = rng or random.Random()

    def decide(self, state, context=None):
        tc = state.amount_to_call
        if not state.board:
            if in_top(class_of(state.hero_cards), 0.6) and tc <= 0.2 * (state.hero_stack + state.hero_bet):
                return Decision(Action.CALL if tc else Action.CHECK)
            return Decision(Action.FOLD if tc else Action.CHECK)
        eq = equity(state.hero_cards, state.board, len(state.players) - 1, 150, self.rng)
        if eq > 0.85 and state.min_raise_to:
            return Decision(Action.BET if not tc else Action.RAISE, state.hero_bet + tc + state.pot)
        if tc == 0:
            return Decision(Action.CHECK)
        return Decision(Action.CALL if eq > 0.22 else Action.FOLD)


class Nit(Strategy):
    """Plays the top 9% of hands, bets only strong hands, folds to pressure."""
    def __init__(self, rng=None):
        self.rng = rng or random.Random()

    def decide(self, state, context=None):
        tc = state.amount_to_call
        if not state.board:
            cls = class_of(state.hero_cards)
            if in_top(cls, 0.04):
                return Decision(Action.RAISE, max(state.min_raise_to or 0, (state.hero_bet + tc) * 3))
            if in_top(cls, 0.09) and tc <= 6 * state.big_blind:
                return Decision(Action.CALL if tc else Action.CHECK)
            return Decision(Action.FOLD if tc else Action.CHECK)
        eq = equity(state.hero_cards, state.board, len(state.players) - 1, 150, self.rng)
        if eq > 0.75:
            return Decision(Action.BET if not tc else Action.RAISE, state.hero_bet + tc + round(state.pot * 0.7))
        if tc == 0:
            return Decision(Action.CHECK)
        return Decision(Action.CALL if eq > 0.6 else Action.FOLD)


class Maniac(Strategy):
    """Raises 55% of hands preflop and bets/raises most streets regardless of strength."""
    def __init__(self, rng=None):
        self.rng = rng or random.Random()

    def decide(self, state, context=None):
        tc = state.amount_to_call
        r = self.rng.random()
        if not state.board and not in_top(class_of(state.hero_cards), 0.55):
            return Decision(Action.FOLD if tc else Action.CHECK)
        if r < 0.55:
            return Decision(Action.BET if not tc else Action.RAISE, state.hero_bet + tc + round(state.pot * 0.8))
        if tc == 0:
            return Decision(Action.CHECK)
        return Decision(Action.CALL if r < 0.85 else Action.FOLD)


def make_strategy(name: str, seed: int) -> Strategy:
    rng = random.Random(seed)
    if name == "theory":
        from .theory import TheoryStrategy
        return TheoryStrategy(iterations=250, rng=rng, solver_iterations=200)
    if name == "equity":
        return EquityStrategy(iterations=250, rng=rng)
    if name == "station":
        return CallingStation(rng)
    if name == "nit":
        return Nit(rng)
    if name == "maniac":
        return Maniac(rng)
    raise ValueError(f"unknown strategy {name!r}")


def _run_chunk(args):
    names, deals, seed, players = args
    pids = [f"{name}#{k}" for k, name in enumerate(names)]
    strategies = {pid: make_strategy(name, seed * 31 + k) for k, (pid, name) in enumerate(zip(pids, names))}
    stats = SimStats()
    rng = random.Random(seed)
    totals = {pid: [] for pid in pids}
    for deal in range(deals):
        deck = list(range(52))
        rng.shuffle(deck)
        button = deal % players
        per_deal = defaultdict(float)
        for rot in range(players):
            seat_pids = [pids[(k + rot) % len(pids)] for k in range(players)]
            net = play_hand(strategies, seat_pids, deck, button, stats, f"{seed}-{deal}-{rot}")
            for pid, v in net.items():
                per_deal[pid] += v
        for pid in pids:
            totals[pid].append(per_deal[pid] / players)
    return totals


def simulate(names: list[str], deals: int = 1000, seed: int = 1, workers: int = 8, bb: float = 2.0) -> dict:
    """Duplicate match. Returns name#k -> (bb/100, standard error in bb/100, hands)."""
    players = len(names)
    workers = max(1, min(workers, deals))
    per = [deals // workers + (1 if w < deals % workers else 0) for w in range(workers)]
    jobs = [(names, per[w], seed * 1000 + w, players) for w in range(workers) if per[w]]
    merged = defaultdict(list)
    with ProcessPoolExecutor(max_workers=len(jobs)) as pool:
        for chunk in pool.map(_run_chunk, jobs):
            for pid, vals in chunk.items():
                merged[pid].extend(vals)
    out = {}
    for pid, vals in merged.items():
        m = sum(vals) / len(vals)
        var = sum((v - m) ** 2 for v in vals) / max(1, len(vals) - 1)
        out[pid] = (m / bb * 100, math.sqrt(var / len(vals)) / bb * 100, len(vals) * players)
    return out
