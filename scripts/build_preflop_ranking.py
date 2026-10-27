"""Regenerate src/poker_agent/data/preflop_rank.json (169 starting hands, strongest first).

Hands are ordered by the average of their equity against one and against three random hands,
so suited and connected hands that play well multiway are not ranked purely by heads-up equity.
"""
import json
import random
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from poker_agent.cards import RANKS, equity

ITERATIONS = 6000


def classes():
    out = []
    for i, hi in enumerate(reversed(RANKS)):
        for lo in reversed(RANKS[:len(RANKS) - i]):
            if hi == lo:
                out.append(hi + lo)
            else:
                out.extend([hi + lo + "s", hi + lo + "o"])
    return out


def example(cls):
    if len(cls) == 2:
        return [cls[0] + "s", cls[1] + "h"]
    return [cls[0] + "s", cls[1] + ("s" if cls[2] == "s" else "h")]


def strength(cls):
    rng = random.Random(hash(cls) & 0xFFFF)
    hand = example(cls)
    return cls, (equity(hand, [], 1, ITERATIONS, rng) + equity(hand, [], 3, ITERATIONS, rng)) / 2


if __name__ == "__main__":
    with ProcessPoolExecutor() as pool:
        scored = list(pool.map(strength, classes()))
    ranking = [c for c, _ in sorted(scored, key=lambda kv: -kv[1])]
    out = Path(__file__).resolve().parents[1] / "src/poker_agent/data/preflop_rank.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(ranking))
    print(len(ranking), ranking[:20], ranking[-5:])
