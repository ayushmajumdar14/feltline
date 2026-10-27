"""Heads-up river solver: CFR+ over hand-strength buckets.

Game: out-of-position player (OOP) checks or bets B; in-position player (IP) checks back or
bets B after a check; whoever faces a bet folds or calls. Hands are grouped into buckets by
showdown strength; card removal between the two ranges is ignored.
"""
from dataclasses import dataclass
import numpy as np
from .cards import score
from .ranges import COMBOS, Range

NODES = {"root": (0, ("check", "bet")), "x": (1, ("check", "bet")),
         "xb": (0, ("fold", "call")), "b": (1, ("fold", "call"))}


@dataclass
class RiverSolution:
    strategy: dict          # node -> array [buckets, actions] of average action probabilities
    hero_bucket: int
    oop_weights: np.ndarray
    ip_weights: np.ndarray

    def probabilities(self, node: str) -> dict:
        _, actions = NODES[node]
        return dict(zip(actions, self.strategy[node][self.hero_bucket]))


def bucketize(hero_hand, board, oop: Range, ip: Range, hero_is_oop: bool, buckets: int = 16):
    """Bucket both ranges (and the hero's actual hand) by showdown strength on the full board."""
    dead = set(board) | set(hero_hand)
    entries = []
    for i, (a, b) in enumerate(COMBOS):
        if a in board or b in board:
            continue
        s = score([a, b] + board)
        if oop.w[i] > 0:
            entries.append((s, 0, oop.w[i] if not (hero_is_oop is False and (a in dead or b in dead)) else 0.0))
        if ip.w[i] > 0:
            entries.append((s, 1, ip.w[i] if not (hero_is_oop and (a in dead or b in dead)) else 0.0))
    hero_score = score(list(hero_hand) + board)
    entries.sort()
    total = sum(e[2] for e in entries) or 1.0
    w = np.zeros((2, buckets))
    edges = []
    acc = 0.0
    for s, player, weight in entries:
        k = min(buckets - 1, int(acc / total * buckets))
        w[player, k] += weight
        acc += weight
        edges.append((s, k))
    hero_bucket = next((k for s, k in reversed(edges) if s <= hero_score), 0)
    return w[0] / (w[0].sum() or 1), w[1] / (w[1].sum() or 1), hero_bucket


def _regret_match(regret):
    pos = np.maximum(regret, 0)
    total = pos.sum(axis=1, keepdims=True)
    uniform = np.full_like(pos, 1.0 / pos.shape[1])
    return np.where(total > 0, pos / np.where(total > 0, total, 1), uniform)


def solve(oop_w, ip_w, pot: float, bet: float, iterations: int = 400) -> dict:
    """Return average strategies per node (CFR+ with linear averaging)."""
    n = len(oop_w)
    idx = np.arange(n)
    win = (idx[:, None] > idx[None, :]).astype(float) + 0.5 * (idx[:, None] == idx[None, :])
    regret = {k: np.zeros((n, 2)) for k in NODES}
    avg = {k: np.zeros((n, 2)) for k in NODES}

    def showdown(size, invest, r0, r1):
        v0 = size * (win @ r1) - invest * r1.sum()
        v1 = size * ((1 - win).T @ r0) - invest * r0.sum()
        return v0, v1

    def walk(node, r0, r1, t):
        if node == "xx":
            return showdown(pot, 0, r0, r1)
        if node in ("xbc", "bc"):
            return showdown(pot + 2 * bet, bet, r0, r1)
        if node == "xbf":
            return np.zeros(n), pot * np.full(n, r0.sum())
        if node == "bf":
            return pot * np.full(n, r1.sum()), np.zeros(n)
        player, _ = NODES[node]
        sigma = _regret_match(regret[node])
        children = {"root": ("x", "b"), "x": ("xx", "xb"), "xb": ("xbf", "xbc"), "b": ("bf", "bc")}[node]
        values = []
        for a, child in enumerate(children):
            if player == 0:
                values.append(walk(child, r0 * sigma[:, a], r1, t))
            else:
                values.append(walk(child, r0, r1 * sigma[:, a], t))
        mine = np.stack([v[player] for v in values], axis=1)
        node_value = (sigma * mine).sum(axis=1)
        regret[node] = np.maximum(regret[node] + mine - node_value[:, None], 0)
        reach = r0 if player == 0 else r1
        avg[node] += t * reach[:, None] * sigma
        other = sum(v[1 - player] for v in values)
        return (node_value, other) if player == 0 else (other, node_value)

    for t in range(1, iterations + 1):
        walk("root", oop_w.copy(), ip_w.copy(), t)
    out = {}
    for k, s in avg.items():
        total = s.sum(axis=1, keepdims=True)
        out[k] = np.where(total > 0, s / np.where(total > 0, total, 1), 0.5)
    return out


def solve_spot(hero_hand, board, hero_range: Range, villain_range: Range, hero_is_oop: bool,
               pot: float, bet: float, iterations: int = 400, buckets: int = 16) -> RiverSolution:
    oop, ip = (hero_range, villain_range) if hero_is_oop else (villain_range, hero_range)
    oop_w, ip_w, hero_bucket = bucketize(list(hero_hand), list(board), oop, ip, hero_is_oop, buckets)
    return RiverSolution(solve(oop_w, ip_w, pot, bet, iterations), hero_bucket, oop_w, ip_w)
