"""Position-based preflop charts expressed as shares of the 1326 combos.

Widths approximate common solver-derived 100bb cash-game charts; boundary hands play mixed
frequencies. Re-raising ranges are polarized: strong hands for value plus suited hands just
outside the calling range as bluffs.
"""
from dataclasses import dataclass
from .models import Action, Decision
from .ranges import Range, class_of, in_top, band_weight

# Opening share by distance from the button: 0=BTN, 1=CO, 2=HJ, 3=LJ, 4+=earlier seats.
OPEN_BY_DISTANCE = [0.43, 0.27, 0.21, 0.17, 0.14, 0.12, 0.11, 0.10, 0.09]
SB_OPEN = 0.40
HEADS_UP_BUTTON_OPEN = 0.80
PREMIUM = 0.025


@dataclass
class Seat:
    distance: int = 0      # seats from the button counting backwards (0 = button)
    small_blind: bool = False
    big_blind: bool = False
    players: int = 2       # players dealt in

    @property
    def open_share(self) -> float:
        if self.players <= 2:
            return HEADS_UP_BUTTON_OPEN if self.small_blind or self.distance == 0 else 0.0
        if self.small_blind:
            return SB_OPEN
        if self.big_blind:
            return 0.0
        return OPEN_BY_DISTANCE[min(self.distance, len(OPEN_BY_DISTANCE) - 1)]


def opening_range(seat: Seat) -> Range:
    return Range.top(seat.open_share or 0.15)


def three_bet_shares(opener: Seat, hero: Seat):
    """(value share, bluff band (lo, hi), calling share) facing a single open."""
    width = max(opener.open_share, 0.10)
    value = min(0.10, max(PREMIUM, width * 0.25))
    if hero.big_blind:
        call = min(0.65, width * 1.4 + 0.12)
    elif hero.small_blind:
        call = value  # small blind plays mostly 3-bet or fold
    else:
        call = min(0.25, width * 0.7)
    bluff_lo = max(call, value)
    return value, (bluff_lo, bluff_lo + width * 0.35), call


def _mixed(rng, share: float) -> bool:
    return share >= 1 or (share > 0 and rng.random() < share)


def _suited(cls: str) -> bool:
    return cls.endswith("s")


def preflop_decision(state, ctx, rng) -> Decision:
    """Chart-based preflop action. Amounts are total 'raise to' sizes."""
    bb = state.big_blind
    cls = class_of(state.hero_cards)
    seat = ctx.seat or Seat(players=len(state.players) or 2)
    history = [h for h in ctx.history if h[1] == "preflop" and h[0] != state.hero_id]
    raises = [h for h in ctx.history if h[1] == "preflop" and h[2] in ("bet", "raise")]
    highest = state.hero_bet + state.amount_to_call
    max_to = state.hero_bet + state.hero_stack
    min_to = state.min_raise_to or highest + bb
    callers = sum(1 for h in history if h[2] == "call")
    note = f"chart {cls}"

    def raise_to(amount, why):
        amount = min(max(min_to, round(amount)), max_to)
        if amount <= highest:
            return Decision(Action.CALL, reason=f"{note}, {why} (capped)")
        return Decision(Action.RAISE if state.amount_to_call else Action.BET, amount, f"{note}, {why}")

    def passive(why):
        if state.amount_to_call == 0:
            return Decision(Action.CHECK, reason=f"{note}, {why}")
        return Decision(Action.FOLD, reason=f"{note}, {why}")

    if not raises:
        limpers = sum(1 for h in history if h[2] == "call")
        if limpers == 0:
            share = seat.open_share if not seat.big_blind else 0.0
            if seat.big_blind:
                return passive("big blind checks")
            if _mixed(rng, in_top(cls, share)):
                size = 3 * bb if seat.small_blind and seat.players > 2 else 2.5 * bb
                return raise_to(size, f"open {share:.0%}")
            return passive(f"outside {share:.0%} open")
        iso = (seat.open_share or 0.15) * 0.6 if not seat.big_blind else 0.15
        if _mixed(rng, in_top(cls, iso)):
            return raise_to((3 + limpers) * bb, f"isolate {limpers} limper(s)")
        if state.amount_to_call == 0:
            return Decision(Action.CHECK, reason=f"{note}, check behind limps")
        if _mixed(rng, in_top(cls, min(0.35, iso * 2))) and state.amount_to_call <= bb:
            return Decision(Action.CALL, reason=f"{note}, over-limp")
        return passive("fold to limps")

    opener = ctx.raiser_seat or Seat(players=seat.players)
    if len(raises) == 1:
        value, (b_lo, b_hi), call = three_bet_shares(opener, seat)
        if callers:
            value, b_hi = value * 0.8, b_lo + (b_hi - b_lo) * 0.4
            call *= 0.6
        size = highest * (3 if not (seat.small_blind or seat.big_blind) else 4) + callers * highest
        if _mixed(rng, in_top(cls, value)):
            return raise_to(size, "value 3-bet")
        if _suited(cls) and _mixed(rng, band_weight(cls, b_lo, b_hi) * 0.6):
            return raise_to(size, "3-bet bluff")
        if _mixed(rng, band_weight(cls, value, call) + in_top(cls, value)):
            return Decision(Action.CALL, reason=f"{note}, flat {call:.0%}")
        return passive(f"outside {call:.0%} continue")

    if len(raises) == 2:
        hero_opened = raises[0][0] == state.hero_id
        if _mixed(rng, in_top(cls, PREMIUM)):
            return raise_to(highest * 2.4, "value 4-bet")
        if hero_opened and cls in ("A5s", "A4s", "A3s", "A2s") and rng.random() < 0.35:
            return raise_to(highest * 2.4, "4-bet bluff (ace blocker)")
        if _mixed(rng, band_weight(cls, PREMIUM, 0.07 if hero_opened else 0.04)):
            return Decision(Action.CALL, reason=f"{note}, call 3-bet")
        return passive("fold to 3-bet")

    if _mixed(rng, in_top(cls, 0.02)):
        return raise_to(max_to, "5-bet jam")
    if _mixed(rng, in_top(cls, 0.03)):
        return Decision(Action.CALL, reason=f"{note}, call 4-bet+")
    return passive("fold to 4-bet+")


def preflop_range_for(action_kind: str, seat: Seat, profile=None) -> Range:
    """Range a player is likely to hold after their preflop line."""
    vpip = profile.looseness if profile else None
    pfr = profile.raising if profile else None
    if action_kind == "open":
        return Range.top(pfr if pfr and profile.hands >= 15 else max(seat.open_share, 0.12), floor=0.0)
    if action_kind == "3bet":
        return Range.top(0.06).add(Range.band(0.10, 0.20).scale(0.25))
    if action_kind == "4bet":
        return Range.top(0.03)
    if action_kind == "call_raise":
        width = vpip if vpip and profile.hands >= 15 else (0.45 if seat.big_blind else 0.18)
        return Range.band(0.04, max(width, 0.06), top_weight=0.3)
    if action_kind == "limp":
        width = vpip if vpip else 0.35
        return Range.band(0.08, max(width, 0.1), top_weight=0.25)
    return Range.top(1.0)
