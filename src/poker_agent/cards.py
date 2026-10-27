"""Card parsing, 7-card hand ranking and Monte Carlo equity."""
import random
from collections import Counter

RANKS = "23456789TJQKA"
SUITS = "cdhs"
RANK_VALUE = {r: i + 2 for i, r in enumerate(RANKS)}
DECK = tuple(r + s for r in RANKS for s in SUITS)


def normalize_card(card: str) -> str:
    """Accept Poker Now card codes such as 'Tc', '10c', 'ah' and return 'Tc'."""
    card = card.strip()
    if len(card) == 3 and card[:2] == "10":
        card = "T" + card[2]
    if len(card) != 2:
        raise ValueError(f"Unrecognized card {card!r}")
    rank, suit = card[0].upper(), card[1].lower()
    if rank not in RANK_VALUE or suit not in SUITS:
        raise ValueError(f"Unrecognized card {card!r}")
    return rank + suit


def _straight_high(values: set[int]) -> int:
    if 14 in values:
        values = values | {1}
    run = 0
    for v in range(14, 0, -1):
        run = run + 1 if v in values else 0
        if run == 5:
            return v + 4
    return 0


def rank_hand(cards) -> tuple:
    """Rank 5-7 cards; larger tuples are stronger hands."""
    values = [RANK_VALUE[c[0]] for c in cards]
    by_suit: dict[str, list[int]] = {}
    for c, v in zip(cards, values):
        by_suit.setdefault(c[1], []).append(v)
    flush = next((sorted(vs, reverse=True) for vs in by_suit.values() if len(vs) >= 5), None)
    if flush:
        sf = _straight_high(set(flush))
        if sf:
            return (8, sf)
    counts = Counter(values)
    groups = sorted(counts.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
    if groups[0][1] == 4:
        quad = groups[0][0]
        return (7, quad, max(v for v in values if v != quad))
    trips = [v for v, n in groups if n >= 3]
    pairs = [v for v, n in groups if n >= 2]
    if trips and len(pairs) >= 2:
        t = trips[0]
        return (6, t, max(p for p in pairs if p != t))
    if flush:
        return (5, *flush[:5])
    straight = _straight_high(set(values))
    if straight:
        return (4, straight)
    kickers = sorted(set(values), reverse=True)
    if trips:
        t = trips[0]
        return (3, t, *[v for v in kickers if v != t][:2])
    if len(pairs) >= 2:
        hi, lo = pairs[0], pairs[1]
        return (2, hi, lo, max(v for v in values if v not in (hi, lo)))
    if pairs:
        p = pairs[0]
        return (1, p, *[v for v in kickers if v != p][:3])
    return (0, *kickers[:5])


CARD_INDEX = {c: RANKS.index(c[0]) * 4 + SUITS.index(c[1]) for c in DECK}


def _straight_table():
    table = [0] * 8192
    for mask in range(8192):
        # Shift ranks up one so the ace can also sit below the deuce (wheel).
        bits = mask << 1 | (1 if mask & (1 << 12) else 0)
        for high in range(13, 3, -1):
            window = 0b11111 << (high - 4)
            if bits & window == window:
                table[mask] = high
                break
    return table


STRAIGHT = _straight_table()


def _top(mask: int, n: int) -> int:
    while mask.bit_count() > n:
        mask &= mask - 1
    return mask


def score(cards) -> int:
    """Fast rank for 5-7 integer cards (rank*4+suit); larger is stronger."""
    counts = [0] * 13
    suits = [0, 0, 0, 0]
    ranks = 0
    for c in cards:
        r = c >> 2
        counts[r] += 1
        suits[c & 3] |= 1 << r
        ranks |= 1 << r
    for sm in suits:
        if sm.bit_count() >= 5:
            high = STRAIGHT[sm]
            return (8 << 40 | high << 26) if high else (5 << 40 | _top(sm, 5))
    quad = trip = trip2 = pair = pair2 = -1
    for r in range(12, -1, -1):
        n = counts[r]
        if n == 4:
            quad = r
        elif n == 3:
            if trip < 0:
                trip = r
            elif trip2 < 0:
                trip2 = r
        elif n == 2:
            if pair < 0:
                pair = r
            elif pair2 < 0:
                pair2 = r
    if quad >= 0:
        return 7 << 40 | quad << 26 | _top(ranks & ~(1 << quad), 1)
    if trip >= 0 and (pair >= 0 or trip2 >= 0):
        return 6 << 40 | trip << 26 | max(pair, trip2) << 13
    high = STRAIGHT[ranks]
    if high:
        return 4 << 40 | high << 26
    if trip >= 0:
        return 3 << 40 | trip << 26 | _top(ranks & ~(1 << trip), 2)
    if pair2 >= 0:
        return 2 << 40 | pair << 26 | pair2 << 13 | _top(ranks & ~(1 << pair) & ~(1 << pair2), 1)
    if pair >= 0:
        return 1 << 40 | pair << 26 | _top(ranks & ~(1 << pair), 3)
    return _top(ranks, 5)


def to_ints(cards) -> list[int]:
    return [CARD_INDEX[c] for c in cards]


def draws(hero, board) -> dict:
    """Flush and straight draws that use at least one hole card (flop/turn only)."""
    result = {"flush_draw": False, "straight_draw": None}
    if len(board) not in (3, 4):
        return result
    cards = list(hero) + list(board)
    suits = Counter(c[1] for c in cards)
    result["flush_draw"] = any(n == 4 and any(h[1] == s for h in hero) for s, n in suits.items())
    values = {RANK_VALUE[c[0]] for c in cards}
    hero_values = {RANK_VALUE[c[0]] for c in hero}
    if 14 in values:
        values.add(1)
    if 14 in hero_values:
        hero_values.add(1)
    if _straight_high(values):
        return result
    for low in range(1, 11):
        window = set(range(low, low + 5))
        have = window & values
        if len(have) == 4 and have & hero_values:
            missing = (window - have).pop()
            edge = missing in (low, low + 4) and low not in (1, 10)
            if edge:
                result["straight_draw"] = "open_ended"
                break
            result["straight_draw"] = result["straight_draw"] or "gutshot"
    return result


def equity(hero, board, opponents: int, iterations: int = 800, rng=None) -> float:
    """Share of pots won (ties split) against random opponent hands."""
    rng = rng or random.Random()
    hero, board = to_ints(hero), to_ints(board)
    opponents = max(1, opponents)
    dead = set(hero) | set(board)
    deck = [c for c in range(52) if c not in dead]
    need = 5 - len(board)
    won = 0.0
    for _ in range(iterations):
        draw = rng.sample(deck, need + 2 * opponents)
        full_board = board + draw[:need]
        mine = score(hero + full_board)
        best, tied = True, 1
        for i in range(opponents):
            theirs = score(draw[need + 2 * i: need + 2 * i + 2] + full_board)
            if theirs > mine:
                best = False
                break
            if theirs == mine:
                tied += 1
        if best:
            won += 1 / tied
    return won / iterations
