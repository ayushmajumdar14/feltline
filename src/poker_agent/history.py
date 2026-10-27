"""Poker Now hand-history import from the table's per-hand log (`/api/games/<id>/log_v3`)."""
import asyncio
import re
from dataclasses import dataclass, field

SUITS = {"♠": "s", "♥": "h", "♦": "d", "♣": "c"}
PLAYER = r'"(?P<name>.+?) @ (?P<pid>[^"]+)"'
START = re.compile(r'-- starting hand #(?P<num>\d+) \(id: (?P<hid>\w+)\)\s*(?P<game>.*?)(?: \(dealer: "(?P<dname>.+?) @ (?P<did>[^"]+)"\))? --')
STACK = re.compile(r'#(?P<seat>\d+) "(?P<name>.+?) @ (?P<pid>[^"]+)" \((?P<stack>[\d.]+)\)')
ACTION = re.compile(PLAYER + r' (?P<verb>posts a .+? of|folds|checks|calls|bets|raises to)(?: (?P<amt>[\d.]+))?(?P<allin> and go all in)?')
SHOWS = re.compile(PLAYER + r' shows a (?P<cards>.+?)\.?$')
COLLECT = re.compile(PLAYER + r' collected (?P<amt>[\d.]+) from pot')
STREET = re.compile(r'^(?P<street>Flop|Turn|River)(?P<run> \(second run\))?:')
CARD = re.compile(r'(10|[2-9JQKA])([♠♥♦♣])')


def card_code(text: str) -> list[str]:
    return [("T" if r == "10" else r) + SUITS[s] for r, s in CARD.findall(text)]


@dataclass
class HandRecord:
    number: int
    hand_id: str
    started_at: str = ""
    dealer_id: str | None = None
    complete: bool = False
    players: dict = field(default_factory=dict)      # pid -> {"name", "seat", "stack"}
    actions: list = field(default_factory=list)      # dicts: player_id, street, action, amount, facing, all_in
    board: list = field(default_factory=list)
    showdowns: dict = field(default_factory=dict)    # pid -> [cards]
    winners: dict = field(default_factory=dict)      # pid -> amount


def parse_hand_log(entries) -> HandRecord | None:
    """Parse one hand's log entries (any order) into a HandRecord."""
    ordered = sorted(entries, key=lambda e: int(e.get("createdAt") or 0))
    hand = None
    street, highest, contrib, preflop_raises = "preflop", 0.0, {}, 0
    for entry in ordered:
        msg = entry.get("msg", "")
        if m := START.match(msg):
            hand = HandRecord(int(m["num"]), m["hid"], entry.get("createdAt", ""), m["did"])
            continue
        if hand is None:
            continue
        if msg.startswith("-- ending hand"):
            hand.complete = True
        elif msg.startswith("Player stacks:"):
            for s in STACK.finditer(msg):
                hand.players[s["pid"]] = {"name": s["name"], "seat": int(s["seat"]), "stack": float(s["stack"])}
        elif m := STREET.match(msg):
            if m["run"]:
                continue
            street = m["street"].lower()
            hand.board = card_code(msg)
            highest, contrib = 0.0, {}
        elif m := SHOWS.match(msg):
            hand.showdowns[m["pid"]] = card_code(m["cards"])
        elif m := COLLECT.match(msg):
            hand.winners[m["pid"]] = hand.winners.get(m["pid"], 0) + float(m["amt"])
        elif m := ACTION.match(msg):
            pid, verb = m["pid"], m["verb"]
            amount = float(m["amt"]) if m["amt"] else None
            hand.players.setdefault(pid, {"name": m["name"], "seat": None, "stack": None})
            if verb.startswith("posts"):
                contrib[pid] = amount or 0
                highest = max(highest, amount or 0)
                continue
            if street == "preflop":
                facing = "raise" if preflop_raises else "blind"
            else:
                facing = "bet" if highest > contrib.get(pid, 0) else "none"
            action = {"folds": "fold", "checks": "check", "calls": "call", "bets": "bet", "raises to": "raise"}[verb]
            if street == "preflop" and action in ("raise", "bet"):
                action = "3bet" if preflop_raises else "raise"
                preflop_raises += 1
            if amount is not None and action != "fold":
                contrib[pid] = amount
                if action in ("bet", "raise", "3bet"):
                    highest = max(highest, amount)
            hand.actions.append({"player_id": pid, "street": street, "action": action,
                                 "amount": amount, "facing": facing, "all_in": bool(m["allin"])})
    return hand


async def fetch_hand(request, game_id: str, number: int, base="https://www.pokernow.com", retries=5):
    """Fetch one hand log; backs off on HTTP 429 rate limiting."""
    delay = 5.0
    for _ in range(retries):
        response = await request.get(f"{base}/api/games/{game_id}/log_v3?hand_number={number}")
        if response.status == 429:
            await asyncio.sleep(delay)
            delay *= 2
            continue
        if response.status != 200:
            raise RuntimeError(f"log_v3 hand {number}: HTTP {response.status}")
        return await response.json()
    raise RuntimeError(f"log_v3 hand {number}: still rate limited")


async def import_game_history(request, store, game_id: str, start: int | None = None,
                              stop: int | None = None, pause=1.5, on_hand=None) -> int:
    """Import finished hands from `start` (default: after the last imported one) until the log runs out."""
    number = start or store.last_hand_number(game_id) + 1
    imported = 0
    while stop is None or number <= stop:
        entries = await fetch_hand(request, game_id, number)
        hand = parse_hand_log(entries) if entries else None
        if hand is None or not hand.complete:
            break
        store.add_parsed_hand(game_id, hand)
        imported += 1
        if on_hand:
            on_hand(hand)
        number += 1
        await asyncio.sleep(pause)
    return imported
