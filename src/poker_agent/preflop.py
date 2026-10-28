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


def effective_bb(hero_stack: float, stacks: list[float], big_blind: float) -> float:
    """Chips behind as big blinds vs the shortest opponent still in."""
    others = [s for s in stacks if s > 0]
    eff = min([hero_stack] + others) if others else hero_stack
    return max(eff, 0.0) / max(big_blind, 1e-9)


def stack_open_mult(stack_bb: float) -> float:
    """100bb charts: shove wider when short, tighten a bit when very deep."""
    if stack_bb <= 8:
        return 1.55
    if stack_bb <= 15:
        return 1.35
    if stack_bb <= 25:
        return 1.18
    if stack_bb <= 40:
        return 1.08
    if stack_bb >= 200:
        return 0.82
    if stack_bb >= 150:
        return 0.90
    return 1.0


def sized_open_share(seat: Seat, stack_bb: float = 100.0) -> float:
    base = seat.open_share
    if base <= 0:
        return 0.0
    cap = 0.92 if seat.players <= 2 else 0.55
    return min(cap, max(0.06, base * stack_open_mult(stack_bb)))


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
    opp_stacks = [p.stack for p in state.players if getattr(p, "player_id", None) != state.hero_id]
    stack_bb = effective_bb(state.hero_stack, opp_stacks, bb)
    note = f"chart {cls} {stack_bb:.0f}bb"

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
            share = sized_open_share(seat, stack_bb) if not seat.big_blind else 0.0
            if seat.big_blind:
                return passive("big blind checks")
            if _mixed(rng, in_top(cls, share)):
                size = 3 * bb if seat.small_blind and seat.players > 2 else 2.5 * bb
                if stack_bb <= 15 or size >= 0.35 * max_to:
                    return raise_to(max_to, f"open jam {stack_bb:.0f}bb")
                return raise_to(size, f"open {share:.0%} ({stack_bb:.0f}bb)")
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
            if stack_bb <= 25 or size >= 0.4 * max_to:
                return raise_to(max_to, f"value 3-bet jam {stack_bb:.0f}bb")
            return raise_to(size, "value 3-bet")
        if _suited(cls) and _mixed(rng, band_weight(cls, b_lo, b_hi) * 0.6):
            if stack_bb <= 20:
                return raise_to(max_to, "3-bet jam bluff")
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


def _jammed(stack_bb: float, raise_to_bb: float | None) -> bool:
    if stack_bb <= 15:
        return True
    return raise_to_bb is not None and raise_to_bb >= 0.7 * max(stack_bb, 1.0)


def preflop_range_for(action_kind: str, seat: Seat, profile=None, stack_bb: float = 100.0,
                      raise_to_bb: float | None = None, facing_bb: float | None = None) -> Range:
    """Range after this player's preflop line, sized by stack depth and the raise they made or faced."""
    vpip = profile.looseness if profile else None
    pfr = profile.raising if profile else None
    open_w = sized_open_share(seat, stack_bb) or 0.12
    if pfr and profile and profile.hands >= 15:
        open_w = min(0.85, max(0.06, pfr * stack_open_mult(stack_bb)))
    jammed = _jammed(stack_bb, raise_to_bb)

    if action_kind == "open":
        if jammed:
            width = min(0.40, open_w * (1.15 if stack_bb <= 10 else 0.85))
            return Range.top(width, floor=0.0)
        if raise_to_bb is not None and raise_to_bb <= 2.2:
            return Range.top(min(0.55, open_w * 1.15), floor=0.0)
        return Range.top(open_w, floor=0.0)
    if action_kind == "3bet":
        if jammed:
            return Range.top(min(0.18, 0.11 if stack_bb <= 12 else 0.08))
        value, bluff_hi = (0.05, 0.16) if (raise_to_bb and raise_to_bb >= 9) else (0.06, 0.20)
        return Range.top(value).add(Range.band(0.10, bluff_hi).scale(0.25))
    if action_kind == "4bet":
        return Range.top(0.05 if jammed else 0.03)
    if action_kind == "call_raise":
        width = vpip if vpip and profile and profile.hands >= 15 else (0.45 if seat.big_blind else 0.18)
        if facing_bb and facing_bb >= 8:
            width = min(width, 0.10)
        elif facing_bb and facing_bb >= 4:
            width *= 0.7
        elif facing_bb and facing_bb <= 2.2:
            width = min(0.50, width * 1.15)
        if stack_bb <= 20:
            width = min(width, 0.12)
        return Range.band(0.04, max(width, 0.06), top_weight=0.3)
    if action_kind == "limp":
        width = vpip if vpip else 0.35
        return Range.band(0.08, max(width, 0.1), top_weight=0.25)
    return Range.top(1.0)
