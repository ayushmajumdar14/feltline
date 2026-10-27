"""Weighted hand ranges over the 1326 hole-card combos, and equity against them."""
import json
import random
from itertools import combinations
from pathlib import Path
from .cards import RANKS, SUITS, score, to_ints

RANKING = json.loads((Path(__file__).parent / "data" / "preflop_rank.json").read_text())
CLASS_INDEX = {c: i for i, c in enumerate(RANKING)}
COMBOS = list(combinations(range(52), 2))


def combo_class(a: int, b: int) -> str:
    ra, rb = a >> 2, b >> 2
    hi, lo = max(ra, rb), min(ra, rb)
    if hi == lo:
        return RANKS[hi] * 2
    return RANKS[hi] + RANKS[lo] + ("s" if a & 3 == b & 3 else "o")


COMBO_CLASS = [combo_class(a, b) for a, b in COMBOS]
_CLASS_COMBOS = {c: [] for c in RANKING}
for _i, _c in enumerate(COMBO_CLASS):
    _CLASS_COMBOS[_c].append(_i)
# Preflop strength band of each class as a share of all 1326 combos: (start, end), 0 = strongest.
CLASS_BAND = {}
_done = 0
for _c in RANKING:
    CLASS_BAND[_c] = (_done / 1326, (_done + len(_CLASS_COMBOS[_c])) / 1326)
    _done += len(_CLASS_COMBOS[_c])


def class_of(cards) -> str:
    a, b = to_ints(cards)
    return combo_class(a, b)


def in_top(cls: str, pct: float) -> float:
    """Fraction of this class inside the strongest `pct` of combos (mixed at the boundary)."""
    lo, hi = CLASS_BAND[cls]
    if pct <= lo:
        return 0.0
    if pct >= hi:
        return 1.0
    return (pct - lo) / (hi - lo)


def band_weight(cls: str, lo_pct: float, hi_pct: float) -> float:
    return max(0.0, in_top(cls, hi_pct) - in_top(cls, lo_pct))


def _ace_low(mask: int) -> int:
    return mask << 1 | (1 if mask & (1 << 12) else 0)


def _has_draw(cards: list[int]) -> bool:
    suits = [0, 0, 0, 0]
    mask = 0
    for c in cards:
        suits[c & 3] += 1
        mask |= 1 << (c >> 2)
    if 4 in suits:
        return True
    m = _ace_low(mask)
    for k in range(1, 10):
        if (m >> k) & 0b1111 == 0b1111:
            return True
    return False


class Range:
    def __init__(self, weights=None):
        self.w = list(weights) if weights is not None else [1.0] * 1326

    @classmethod
    def from_classes(cls, fn):
        return cls([fn(c) for c in COMBO_CLASS])

    @classmethod
    def top(cls, pct: float, floor: float = 0.0):
        return cls.from_classes(lambda c: max(floor, in_top(c, pct)))

    @classmethod
    def band(cls, lo: float, hi: float, top_weight: float = 0.0, floor: float = 0.0):
        """Hands between the lo and hi strength percentiles; hands stronger than lo keep top_weight."""
        return cls.from_classes(lambda c: max(floor, band_weight(c, lo, hi) + top_weight * in_top(c, lo)))

    def copy(self):
        return Range(self.w)

    def scale(self, factor: float) -> "Range":
        self.w = [w * factor for w in self.w]
        return self

    def add(self, other: "Range") -> "Range":
        self.w = [min(1.0, a + b) for a, b in zip(self.w, other.w)]
        return self

    def remove(self, dead) -> "Range":
        dead = set(dead)
        for i, (a, b) in enumerate(COMBOS):
            if a in dead or b in dead:
                self.w[i] = 0.0
        return self

    def total(self) -> float:
        return sum(self.w)

    def strengths(self, board: list[int]) -> dict:
        """combo index -> (strength percentile within this range on the board, has_draw)."""
        dead = set(board)
        scored = [(score([a, b] + board), i) for i, (a, b) in enumerate(COMBOS)
                  if self.w[i] > 0 and a not in dead and b not in dead]
        scored.sort()
        total = sum(self.w[i] for _, i in scored) or 1.0
        out, below, k = {}, 0.0, 0
        while k < len(scored):
            j = k
            while j < len(scored) and scored[j][0] == scored[k][0]:
                j += 1
            tie = sum(self.w[i] for _, i in scored[k:j])
            pct = (below + tie / 2) / total
            for _, i in scored[k:j]:
                a, b = COMBOS[i]
                out[i] = (pct, len(board) < 5 and _has_draw([a, b] + board) and not _has_draw(board))
            below += tie
            k = j
        return out

    def percentile_of(self, hand: list[int], board: list[int]) -> float:
        """Where `hand` would sit within this range on the board (1 = strongest)."""
        mine = score(hand + board)
        dead = set(board) | set(hand)
        below = tie = total = 0.0
        for i, (a, b) in enumerate(COMBOS):
            w = self.w[i]
            if w <= 0 or a in dead or b in dead:
                continue
            s = score([a, b] + board)
            total += w
            if s < mine:
                below += w
            elif s == mine:
                tie += w
        return (below + tie / 2) / total if total else 0.5

    def narrow(self, action: str, board: list[int], aggression: float = 1.0) -> "Range":
        """Reweight by how likely each hand is to take `action` on this board.

        aggression > 1 means the player bluffs more than average (wider betting ranges).
        """
        if action in ("fold",):
            return self
        info = self.strengths(board)
        bluff = max(0.03, min(0.45, 0.15 * aggression))
        # Hyper-aggressive players bet regardless of strength, so their bets say less.
        blur = max(0.0, min(0.85, (aggression - 1.0) / 1.5)) if action in ("bet", "raise") else 0.0
        for i in range(1326):
            if self.w[i] <= 0:
                continue
            if i not in info:
                self.w[i] = 0.0
                continue
            p, draw = info[i]
            if action == "bet":
                f = 1.0 if p >= 0.7 else 0.65 if draw else 0.3 if p >= 0.45 else bluff
            elif action == "raise":
                f = 1.0 if p >= 0.85 else 0.45 if p >= 0.7 else 0.35 if draw else bluff / 3
            elif action == "call":
                f = 0.55 if p >= 0.92 else 1.0 if p >= 0.35 else 0.9 if draw else 0.12
            elif action == "check":
                f = 0.45 if p >= 0.85 else 1.0
            else:
                f = 1.0
            self.w[i] *= f + (1.0 - f) * blur
        return self


def equity_vs_ranges(hero, board, ranges: list[Range], iterations: int = 500, rng=None) -> float:
    """Share of pots won (ties split) when each opponent holds a hand drawn from their range."""
    rng = rng or random.Random()
    hero, board = to_ints(hero), to_ints(board)
    dead = set(hero) | set(board)
    pools = []
    for r in ranges:
        idx = [i for i, (a, b) in enumerate(COMBOS) if r.w[i] > 0 and a not in dead and b not in dead]
        if not idx:
            idx = [i for i, (a, b) in enumerate(COMBOS) if a not in dead and b not in dead]
            weights = [1.0] * len(idx)
        else:
            weights = [r.w[i] for i in idx]
        cum, acc = [], 0.0
        for w in weights:
            acc += w
            cum.append(acc)
        pools.append(([COMBOS[i] for i in idx], cum))
    need = 5 - len(board)
    deck = [c for c in range(52) if c not in dead]
    won = 0.0
    done = 0
    for _ in range(iterations):
        used = set()
        hands = []
        ok = True
        for combos, cum in pools:
            for _try in range(20):
                a, b = rng.choices(combos, cum_weights=cum)[0]
                if a not in used and b not in used:
                    break
            else:
                ok = False
                break
            used.add(a), used.add(b)
            hands.append([a, b])
        if not ok:
            continue
        rest = [c for c in deck if c not in used] if used else deck
        full = board + rng.sample(rest, need)
        mine = score(hero + full)
        best, tied = True, 1
        for h in hands:
            theirs = score(h + full)
            if theirs > mine:
                best = False
                break
            if theirs == mine:
                tied += 1
        done += 1
        if best:
            won += 1 / tied
    return won / done if done else 0.0
