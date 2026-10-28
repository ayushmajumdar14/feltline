"""Theory-based strategy: preflop charts, range modeling, texture sizing, MDF and a river solver.

Still NOT a full solver: flop/turn play is principled heuristics on top of range equity; only
heads-up river spots are solved (with bucketed ranges).
"""
import random
from .cards import draws, to_ints
from .models import Action, Decision, GameState
from .preflop import Seat, preflop_decision, preflop_range_for
from .ranges import Range, equity_vs_ranges
from .river import solve_spot
from .strategy import POPULATION_VPIP, HandContext, Strategy

STREET_CARDS = {"flop": 3, "turn": 4, "river": 5}


def board_texture(board) -> str:
    """'wet' when the flop/turn offers many draws, else 'dry'."""
    cards = to_ints(board[:4])
    suits = [0, 0, 0, 0]
    ranks = sorted({c >> 2 for c in cards})
    for c in cards:
        suits[c & 3] += 1
    paired = len(ranks) < len(cards)
    connected = any(ranks[i + 2] - ranks[i] <= 4 for i in range(len(ranks) - 2))
    wet = max(suits) >= 3 or (max(suits) == 2 and connected) or (connected and not paired and ranks[-1] >= 7)
    return "wet" if wet else "dry"


def geometric_fraction(spr: float, streets_left: int) -> float:
    """Pot fraction per bet that gets the effective stack in evenly by the river."""
    return ((1 + 2 * spr) ** (1 / streets_left) - 1) / 2


def preflop_line(pid, history) -> str:
    raises = 0
    line = "none"
    for actor, street, action, _amount in history:
        if street != "preflop":
            continue
        if action in ("bet", "raise"):
            raises += 1
            if actor == pid:
                line = {1: "open", 2: "3bet"}.get(raises, "4bet")
        elif action == "call" and actor == pid and line == "none":
            line = "call_raise" if raises else "limp"
    return line


def line_sizing(pid, history, big_blind: float):
    """(raise_to_bb this player put in, facing_bb of the last raise they saw)."""
    raise_to_bb = facing_bb = None
    bb = max(big_blind, 1e-9)
    for actor, street, action, amount in history:
        if street != "preflop" or amount is None:
            continue
        size = amount / bb
        if action in ("bet", "raise"):
            if actor == pid:
                raise_to_bb = size
            else:
                facing_bb = size
        elif action == "call" and actor == pid:
            facing_bb = facing_bb or size
    return raise_to_bb, facing_bb


def player_stack_bb(state: GameState, pid: str) -> float:
    mine = next((p.stack for p in state.players if p.player_id == pid), state.hero_stack)
    others = [p.stack for p in state.players if p.player_id != pid and p.stack > 0]
    eff = min([mine] + others) if others else mine
    return max(eff, 0.0) / max(state.big_blind, 1e-9)


class TheoryStrategy(Strategy):
    def __init__(self, iterations=400, rng=None, bluffing=True, solver_iterations=300):
        self.iterations = iterations
        self.rng = rng or random.Random()
        self.bluffing = bluffing
        self.solver_iterations = solver_iterations
        self._cache = {}

    # ---- range bookkeeping -------------------------------------------------
    def ranges(self, state: GameState, ctx: HandContext) -> dict:
        """pid -> Range for everyone still in the hand (hero's range as opponents would see it)."""
        cache = self._cache.setdefault(state.hand_id, {})
        if len(self._cache) > 50:
            for key in list(self._cache)[:-10]:
                self._cache.pop(key, None)
        board = to_ints(state.board)
        out = {}
        for player in state.players:
            pid = player.player_id
            seat = ctx.seats.get(pid) or Seat(players=len(state.players))
            entry = cache.get(pid)
            postflop = [h for h in ctx.history if h[0] == pid and h[1] in STREET_CARDS]
            if entry is None or entry[0] > len(postflop):
                raise_to_bb, facing_bb = line_sizing(pid, ctx.history, state.big_blind)
                start = preflop_range_for(
                    preflop_line(pid, ctx.history),
                    seat,
                    ctx.profile(pid),
                    stack_bb=player_stack_bb(state, pid),
                    raise_to_bb=raise_to_bb,
                    facing_bb=facing_bb,
                )
                if pid != state.hero_id:
                    start.remove(to_ints(state.hero_cards))
                entry = (0, start)
            done, rng_ = entry
            profile = ctx.profile(pid)
            # Aggression factor alone flags nits (who rarely call) as bluffers; tight players bluff less.
            aggression = profile.bluffiness * min(1.0, profile.looseness / POPULATION_VPIP) if profile else 1.0
            for _actor, street, action, _amt in postflop[done:]:
                street_board = board[:STREET_CARDS[street]]
                if len(street_board) == STREET_CARDS[street]:
                    rng_.narrow(action, street_board, aggression)
            cache[pid] = (len(postflop), rng_)
            out[pid] = rng_.copy().remove(board)
        return out

    # ---- decisions ---------------------------------------------------------
    def decide(self, state: GameState, context: HandContext | None = None) -> Decision:
        state.validate()
        if not state.hero_turn or state.parse_confidence < 0.99 or len(state.hero_cards) != 2:
            raise ValueError("State insufficiently verified for action")
        ctx = context or HandContext()
        opponents = [p for p in state.players if p.player_id != state.hero_id]
        if not opponents:
            return Decision(Action.CHECK if state.amount_to_call == 0 else Action.CALL, reason="no opponents")
        ranges = self.ranges(state, ctx)
        if not state.board:
            return self._preflop(state, ctx, opponents, ranges)
        return self._postflop(state, ctx, opponents, ranges)

    def _preflop(self, state, ctx, opponents, ranges):
        to_call = state.amount_to_call
        big_decision = to_call >= 0.35 * (state.hero_stack + state.hero_bet) and to_call > 4 * state.big_blind
        if big_decision:
            eq = equity_vs_ranges(state.hero_cards, [], [ranges[p.player_id] for p in opponents],
                                  self.iterations, self.rng)
            pot_odds = to_call / (state.pot + to_call)
            action = Action.CALL if eq >= pot_odds else Action.FOLD
            return Decision(action, reason=f"stack-off decision: equity {eq:.2f} vs ranges, pot odds {pot_odds:.2f}")
        return preflop_decision(state, ctx, self.rng)

    def _postflop(self, state, ctx, opponents, ranges):
        hero, board = list(state.hero_cards), list(state.board)
        street = len(board)
        n = len(opponents)
        opp_ranges = [ranges[p.player_id] for p in opponents]
        eq = equity_vs_ranges(hero, board, opp_ranges, self.iterations, self.rng)
        to_call = state.amount_to_call
        max_to = state.hero_bet + state.hero_stack
        min_to = state.min_raise_to or (state.hero_bet + to_call + state.big_blind)
        eff = min([state.hero_stack] + [p.stack for p in opponents if p.stack > 0] or [state.hero_stack])
        spr = eff / max(state.pot, 1)
        texture = board_texture(board)
        fold_factor = ctx.fold_factor
        note = f"range equity {eq:.2f} vs {n} opp, {texture}, SPR {spr:.1f}, NOT GTO"

        if street == 5 and n == 1 and ctx.order:
            solved = self._river(state, ctx, opponents[0], ranges, eq, note, max_to, min_to)
            if solved:
                return solved

        def bet_to(fraction, why):
            if spr <= 3 and why.startswith("value"):
                fraction = max(fraction, min(1.2, geometric_fraction(spr, 6 - street)))
            size = state.hero_bet + to_call + (state.pot + to_call) * fraction
            size = min(max(min_to, round(size)), max_to)
            act = Action.RAISE if to_call else Action.BET
            return Decision(act, size, f"{note}, {why} {fraction:.0%} pot")

        size = 0.33 if (street == 3 and texture == "dry") else 0.75 if street == 5 else 0.66
        if to_call == 0:
            value_cut = 0.6 + 0.08 * (n - 1)
            if eq >= value_cut:
                if n == 1 and street == 3 and eq >= 0.85 and texture == "dry" and self.rng.random() < 0.12:
                    return Decision(Action.CHECK, reason=f"{note}, slow-play")
                return bet_to(size, "value bet")
            if self.bluffing and n <= 2:
                p, kind = self._bluff_odds(state, ctx, hero, board, texture, street)
                p *= fold_factor * (0.4 if n == 2 else 1.0)
                if p and self.rng.random() < min(0.95, p):
                    return bet_to(size, f"{kind} (bluff, p={min(0.95, p):.2f}),")
            return Decision(Action.CHECK, reason=note)

        pot_odds = to_call / (state.pot + to_call)
        bet_fraction = to_call / max(state.pot - to_call, 1)
        mdf = 1 / (1 + bet_fraction)
        can_raise = max_to > state.hero_bet + to_call
        if can_raise and eq >= (0.72 if n == 1 else 0.8):
            return bet_to(0.9, "value raise")
        d = draws(hero, board)
        if self.bluffing and can_raise and n == 1 and street == 3 and \
                (d["flush_draw"] or d["straight_draw"] == "open_ended") and self.rng.random() < 0.25 * fold_factor:
            return bet_to(0.9, "semi-bluff raise")
        if eq >= pot_odds:
            return Decision(Action.CALL, reason=f"{note}, pot odds {pot_odds:.2f}")
        villain = ctx.profile(opponents[0].player_id) if n == 1 else None
        bluffs_enough = villain is None or villain.bluffiness >= 0.8
        if n == 1 and bluffs_enough:
            hero_pct = ranges[state.hero_id].percentile_of(to_ints(hero), to_ints(board))
            if hero_pct >= 1 - mdf:
                return Decision(Action.CALL, reason=f"{note}, MDF defend (top {mdf:.0%} of my range, I'm at {hero_pct:.2f})")
        return Decision(Action.FOLD, reason=f"{note}, pot odds {pot_odds:.2f}, MDF {mdf:.2f}")

    def _bluff_odds(self, state, ctx, hero, board, texture, street):
        d = draws(hero, board)
        strong_draw = d["flush_draw"] or d["straight_draw"] == "open_ended"
        aggressor = ctx.hero_preflop_aggressor
        overcards = all((c >> 2) > max(b >> 2 for b in to_ints(board)) for c in to_ints(hero))
        if street in (3, 4) and strong_draw:
            return (0.65 if street == 3 else 0.5), "semi-bluff"
        if street in (3, 4) and d["straight_draw"] == "gutshot":
            return 0.3, "gutshot semi-bluff"
        if street == 3 and aggressor:
            return (0.7 if texture == "dry" else 0.3), "range c-bet"
        if street == 4 and aggressor:
            return (0.3 if overcards else 0.15), "turn barrel"
        return 0.0, ""

    def _river(self, state, ctx, villain, ranges, eq, note, max_to, min_to):
        hero_id, vid = state.hero_id, villain.player_id
        if hero_id not in ctx.order or vid not in ctx.order:
            return None
        hero_is_oop = ctx.order.index(hero_id) < ctx.order.index(vid)
        river = [h for h in ctx.history if h[1] == "river"]
        to_call = state.amount_to_call
        if to_call == 0:
            node = "root" if hero_is_oop else "x"
            pot = state.pot
            bet = min(0.75 * pot, state.hero_stack, villain.stack or state.hero_stack)
        else:
            if any(h[0] == hero_id and h[2] in ("bet", "raise") for h in river):
                return None  # facing a raise: outside the solved tree
            node = "xb" if hero_is_oop else "b"
            bet = to_call
            pot = state.pot - to_call
        if bet <= 0:
            return None
        sol = solve_spot(to_ints(state.hero_cards), to_ints(state.board), ranges[hero_id], ranges[vid],
                         hero_is_oop, pot, bet, self.solver_iterations)
        probs = sol.probabilities(node)
        profile = ctx.profile(vid)
        weak = sol.hero_bucket < len(sol.oop_weights) // 2
        tag = f"{note}, river solver bucket {sol.hero_bucket}"
        if to_call == 0:
            p_bet = probs["bet"]
            if weak:
                p_bet = min(1.0, p_bet * ctx.fold_factor) if self.bluffing else 0.0
            if self.rng.random() < p_bet:
                size = min(max(min_to, round(state.hero_bet + bet)), max_to)
                kind = "bluff" if weak else "value"
                return Decision(Action.BET, size, f"{tag}, solver {kind} bet (p={p_bet:.2f})")
            return Decision(Action.CHECK, reason=f"{tag}, solver check (bet p={p_bet:.2f})")
        if eq >= 0.9 and max_to > state.hero_bet + to_call:
            size = min(max(min_to, round(state.hero_bet + to_call + state.pot)), max_to)
            return Decision(Action.RAISE, size, f"{tag}, value raise")
        p_call = probs["call"]
        if profile and profile.hands >= 30:
            pot_odds = to_call / (state.pot + to_call)
            p_call = 0.5 * p_call + 0.5 * (1.0 if eq >= pot_odds else 0.0)
        if self.rng.random() < p_call:
            return Decision(Action.CALL, reason=f"{tag}, solver call (p={p_call:.2f})")
        return Decision(Action.FOLD, reason=f"{tag}, solver fold (call p={p_call:.2f})")
