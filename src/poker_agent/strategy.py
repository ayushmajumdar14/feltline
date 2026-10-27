import random
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from .cards import draws, equity
from .models import GameState, Decision, Action

POPULATION_FOLD_TO_BET = 0.45
POPULATION_VPIP = 0.35
POPULATION_PFR = 0.18
POPULATION_AF = 1.5
PRIOR_HANDS = 20


@dataclass
class OpponentProfile:
    """Observed tendencies, shrunk toward population averages until enough hands are seen."""
    player_id: str = ""
    hands: int = 0
    vpip: float | None = None
    fold_to_bet: float | None = None
    aggression: float | None = None
    pfr: float | None = None

    @classmethod
    def from_stats(cls, stats: dict):
        return cls(stats.get("player_id", ""), stats.get("observed_hands") or 0, stats.get("vpip"),
                   stats.get("fold_to_bet"), stats.get("aggression_factor"), stats.get("pfr"))

    def _shrink(self, observed, prior):
        if observed is None:
            return prior
        weight = self.hands / (self.hands + PRIOR_HANDS)
        return weight * observed + (1 - weight) * prior

    @property
    def folds(self) -> float:
        return self._shrink(self.fold_to_bet, POPULATION_FOLD_TO_BET)

    @property
    def looseness(self) -> float:
        return self._shrink(self.vpip, POPULATION_VPIP)

    @property
    def raising(self) -> float:
        return self._shrink(self.pfr, POPULATION_PFR)

    @property
    def bluffiness(self) -> float:
        """Multiplier on how often this player bets weak hands (1 = average)."""
        af = self._shrink(self.aggression, POPULATION_AF)
        return max(0.3, min(2.5, af / POPULATION_AF))


@dataclass
class HandContext:
    hero_preflop_aggressor: bool = False
    hero_late_position: bool = False
    opponents: list[OpponentProfile] = field(default_factory=list)
    # (player_id, street, action, amount) for this hand in order; blinds excluded.
    history: list[tuple] = field(default_factory=list)
    seat: object = None                              # preflop.Seat for the hero
    seats: dict = field(default_factory=dict)        # player_id -> preflop.Seat
    raiser_seat: object = None                       # Seat of the first preflop raiser
    order: list = field(default_factory=list)        # postflop acting order of player ids

    def profile(self, player_id):
        return next((p for p in self.opponents if p.player_id == player_id), None)

    @property
    def fold_factor(self) -> float:
        """>1 when opponents fold to bets more than average, <1 against calling stations."""
        if not self.opponents:
            return 1.0
        folds = min(p.folds for p in self.opponents)
        return max(0.3, min(1.7, folds / POPULATION_FOLD_TO_BET))

    @property
    def looseness(self) -> float:
        if not self.opponents:
            return POPULATION_VPIP
        return sum(p.looseness for p in self.opponents) / len(self.opponents)


class Strategy(ABC):
    @abstractmethod
    def decide(self, state: GameState, context: HandContext | None = None) -> Decision: ...

class ConservativeFallback(Strategy):
    """NOT GTO. Safe demo baseline only; no automatic wagering on uncertain states."""
    def decide(self, state: GameState, context: HandContext | None = None) -> Decision:
        state.validate()
        if not state.hero_turn or state.parse_confidence < 0.99 or len(state.hero_cards) != 2:
            raise ValueError("State insufficiently verified for action")
        if state.amount_to_call == 0:
            return Decision(Action.CHECK, reason="Non-wagering fallback, NOT GTO")
        return Decision(Action.FOLD, reason="Conservative fallback, NOT GTO")

class EquityStrategy(Strategy):
    """NOT GTO. Monte Carlo equity vs pot odds, plus mixed-frequency bluffs and opponent adjustments.

    Bluffs use the same bet size as value bets so sizing does not reveal hand strength.
    Decision.amount for BET/RAISE is the total "raise to" amount for this street.
    """
    def __init__(self, iterations=800, rng=None, bluffing=True):
        self.iterations=iterations
        self.rng=rng or random.Random()
        self.bluffing=bluffing

    def _bet(self, state, min_to, max_to, fraction=0.66):
        size=max(min_to, round(state.hero_bet + state.amount_to_call + state.pot * fraction))
        return min(size, max_to)

    def _bluff_chance(self, state, ctx, eq, opponents):
        street=len(state.board)
        d=draws(state.hero_cards, state.board)
        strong_draw=d["flush_draw"] or d["straight_draw"] == "open_ended"
        if street in (3, 4) and strong_draw:
            chance, kind = (0.6 if street == 3 else 0.45), "semi-bluff"
        elif street == 3 and ctx.hero_preflop_aggressor:
            chance, kind = 0.55, "c-bet"
        elif street == 4 and ctx.hero_preflop_aggressor and eq < 0.4:
            chance, kind = 0.25, "barrel"
        elif street == 5 and eq < 0.3:
            chance, kind = 0.18, "river bluff"
        else:
            return 0.0, ""
        if opponents >= 3:
            return 0.0, ""
        if opponents == 2:
            chance *= 0.4
        return min(0.9, chance * ctx.fold_factor), kind

    def _preflop(self, state, ctx, eq, opponents, min_to, max_to, note):
        bb=state.big_blind
        highest=state.hero_bet + state.amount_to_call
        baseline=1 / (opponents + 1)
        unraised=highest <= bb
        pot_odds=state.amount_to_call / (state.pot + state.amount_to_call) if state.amount_to_call else 0
        if unraised:
            limpers=max(0, round((state.pot - 1.5 * bb) / bb))
            open_to=min(max(min_to, round(2.5 * bb + limpers * bb)), max_to)
            if eq >= baseline * 1.25:
                return Decision(Action.RAISE if state.amount_to_call else Action.BET, open_to, f"{note}, open raise")
            if self.bluffing and ctx.hero_late_position and limpers == 0 and eq >= baseline * 1.05 \
                    and self.rng.random() < 0.7 * ctx.fold_factor:
                return Decision(Action.RAISE if state.amount_to_call else Action.BET, open_to, f"{note}, steal (bluff)")
            if state.amount_to_call == 0:
                return Decision(Action.CHECK, reason=note)
            if eq >= pot_odds + 0.05:
                return Decision(Action.CALL, reason=f"{note}, pot odds {pot_odds:.2f}")
            return Decision(Action.FOLD, reason=f"{note}, pot odds {pot_odds:.2f}")
        reraise_to=min(max(min_to, round(highest * 3)), max_to)
        if eq >= baseline * 1.5 and max_to > highest:
            return Decision(Action.RAISE, reraise_to, f"{note}, value 3-bet")
        if self.bluffing and opponents == 1 and 0.45 <= eq < 0.6 and max_to > highest \
                and highest <= 4 * bb and self.rng.random() < 0.08 * ctx.fold_factor:
            return Decision(Action.RAISE, reraise_to, f"{note}, light 3-bet (bluff)")
        # A raiser's range is stronger than a random hand.
        if eq - 0.04 >= pot_odds + 0.05:
            return Decision(Action.CALL, reason=f"{note}, pot odds {pot_odds:.2f}")
        return Decision(Action.FOLD, reason=f"{note}, pot odds {pot_odds:.2f}")

    def decide(self, state: GameState, context: HandContext | None = None) -> Decision:
        state.validate()
        if not state.hero_turn or state.parse_confidence < 0.99 or len(state.hero_cards) != 2:
            raise ValueError("State insufficiently verified for action")
        ctx=context or HandContext()
        opponents=max(1, len([p for p in state.players if p.player_id != state.hero_id]))
        eq=equity(state.hero_cards, state.board, opponents, self.iterations, self.rng)
        strong=0.5 + 0.25/opponents
        to_call=state.amount_to_call
        max_to=state.hero_bet + state.hero_stack
        min_to=state.min_raise_to or (state.hero_bet + to_call + state.big_blind)
        note=f"equity {eq:.2f} vs {opponents} opp, fold factor {ctx.fold_factor:.2f}, NOT GTO"
        if not state.board:
            return self._preflop(state, ctx, eq, opponents, min_to, max_to, note)
        # Loose players continue with weaker hands, so value-bet thinner against them.
        strong -= max(-0.05, min(0.05, (ctx.looseness - POPULATION_VPIP) * 0.25))
        if to_call == 0:
            if eq >= strong and state.hero_stack > 0:
                if opponents == 1 and eq >= 0.85 and len(state.board) == 3 and self.rng.random() < 0.15:
                    return Decision(Action.CHECK, reason=f"{note}, slow-play")
                return Decision(Action.BET, self._bet(state, min_to, max_to), f"{note}, value bet")
            if self.bluffing and state.hero_stack > 0:
                chance, kind = self._bluff_chance(state, ctx, eq, opponents)
                if chance and self.rng.random() < chance:
                    return Decision(Action.BET, self._bet(state, min_to, max_to), f"{note}, {kind} (bluff, p={chance:.2f})")
            return Decision(Action.CHECK, reason=note)
        pot_odds=to_call / (state.pot + to_call)
        # Tight players bet stronger ranges than random hands, so discount equity when facing them.
        eq_vs_bet=eq - max(0.0, (POPULATION_VPIP - ctx.looseness) * 0.3)
        can_raise=max_to > state.hero_bet + to_call
        if eq_vs_bet >= strong + 0.1 and can_raise:
            return Decision(Action.RAISE, self._bet(state, min_to, max_to, 1.0), f"{note}, value raise")
        if self.bluffing and can_raise and opponents == 1 and len(state.board) == 3:
            d=draws(state.hero_cards, state.board)
            if (d["flush_draw"] or d["straight_draw"] == "open_ended") and self.rng.random() < 0.2 * ctx.fold_factor:
                return Decision(Action.RAISE, self._bet(state, min_to, max_to, 1.0), f"{note}, semi-bluff raise")
        if eq_vs_bet >= pot_odds + 0.05:
            return Decision(Action.CALL, reason=f"{note}, pot odds {pot_odds:.2f}")
        return Decision(Action.FOLD, reason=f"{note}, pot odds {pot_odds:.2f}")

class SolverLookup(Strategy):
    """Interface for licensed/precomputed 9-max NLH solver tables, not included."""
    def __init__(self, lookup): self.lookup=lookup
    def decide(self, state, context=None):
        state.validate()
        if state.parse_confidence < .99: raise ValueError("Unverified state")
        decision=self.lookup(state)
        if not isinstance(decision, Decision): raise ValueError("Solver returned invalid decision")
        return decision
