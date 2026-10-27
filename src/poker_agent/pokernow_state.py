"""Poker Now socket.io game-state tracking.

The table sends one full `registered` snapshot on connect, then `gC` diffs that
are deep-merged into it; the string "<D>" marks a deleted key.
"""
import json
from .cards import normalize_card
from .models import GameState, Player

DELETE = "<D>"


def apply_diff(state: dict, diff: dict) -> dict:
    for key, value in diff.items():
        if value == DELETE:
            state.pop(key, None)
        elif isinstance(value, dict) and isinstance(state.get(key), dict):
            apply_diff(state[key], value)
        else:
            state[key] = value
    return state


def parse_frame(frame: str):
    """Return (event, payload) for a socket.io event frame, else None."""
    if not frame.startswith("42"):
        return None
    try:
        message = json.loads(frame[2:])
    except json.JSONDecodeError:
        return None
    if not isinstance(message, list) or not message:
        return None
    return message[0], (message[1] if len(message) > 1 else None)


def _chips(value) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


class TableTracker:
    def __init__(self):
        self.me: str | None = None
        self.raw: dict = {}
        self.preflop_raiser: str | None = None
        self.finished_hands = 0
        self.history: list[tuple] = []   # (player_id, street, action, amount) this hand

    def _highest_bet(self) -> float:
        return max([_chips(self.raw.get("cHB"))] + [_chips(v) for v in self.raw.get("tB", {}).values()])

    def feed(self, frame: str) -> str | None:
        parsed = parse_frame(frame)
        if parsed is None:
            return None
        event, payload = parsed
        if event == "registered" and isinstance(payload, dict):
            self.me = payload.get("currentPlayer", {}).get("id")
            self.raw = payload.get("gameState") or {}
            self.preflop_raiser = None
        elif event == "gC" and isinstance(payload, dict):
            hand_before, highest_before = self.raw.get("hI"), self._highest_bet()
            bets_before = dict(self.raw.get("tB", {}))
            apply_diff(self.raw, payload)
            if self.raw.get("hI") != hand_before:
                self.preflop_raiser = None
                self.history = []
                if hand_before:
                    self.finished_hands += 1
            elif "oTC" not in payload:
                self._record_actions(payload, bets_before, highest_before)
        return event

    def _record_actions(self, payload, bets_before, highest_before):
        street = {0: "preflop", 3: "flop", 4: "turn", 5: "river"}.get(len(self._board()), "river")
        big_blind = _chips(self.raw.get("bigBlind"))
        for pid, status in (payload.get("pGS") or {}).items():
            if status == "fold":
                self.history.append((pid, street, "fold", None))
        for pid, bet in (payload.get("tB") or {}).items():
            if bet == DELETE:
                continue
            if isinstance(bet, str):
                if "check" in bet.lower():
                    self.history.append((pid, street, "check", None))
                continue
            amount = _chips(bet)
            if amount <= _chips(bets_before.get(pid)):
                continue
            floor = big_blind if street == "preflop" else 0.0
            if amount > max(highest_before, floor):
                kind = "bet" if street != "preflop" and highest_before == 0 else "raise"
                if street == "preflop":
                    self.preflop_raiser = pid
            else:
                kind = "call"
            self.history.append((pid, street, kind, amount))

    def dealt_order(self) -> list:
        """Player ids dealt into this hand, in seat order starting left of the button."""
        dealt = set(self.raw.get("pC", {}))
        seats = sorted((seat, pid) for seat, pid in self.raw.get("seats", []) if pid in dealt)
        if not seats:
            return []
        dealer_seat = self.raw.get("dealerSeat")
        start = next((k for k, (seat, _) in enumerate(seats) if seat > (dealer_seat or 0)), 0)
        return [pid for _, pid in seats[start:] + seats[:start]]

    def hero_late_position(self) -> bool:
        return self.me is not None and self.me in (self.raw.get("dealerID"), self.raw.get("sBPI"))

    def seen_players(self) -> dict:
        """pid -> (name, has Poker Now account) for everyone the table reports."""
        return {pid: (p.get("name"), p.get("isNetworkPlayer")) for pid, p in self.raw.get("players", {}).items()}

    @property
    def hero_turn(self) -> bool:
        # After an action the server keeps cPI on the actor while sNA moves to NSAA/NSAF.
        return bool(self.me) and self.raw.get("cPI") == self.me and self.raw.get("sNA") == "FCPFS"

    def hand_key(self) -> tuple:
        """Identifies one decision point so the bot acts at most once per spot."""
        bets = self.raw.get("tB", {})
        return (self.raw.get("gN"), len(self._board()), self.raw.get("cHB"),
                json.dumps(bets, sort_keys=True, default=str))

    def _board(self) -> list:
        runs = self.raw.get("oTC") or {}
        return list(runs.get("1") or [])

    def _seat_of(self, player_id):
        return next((seat for seat, pid in self.raw.get("seats", []) if pid == player_id), None)

    def game_state(self) -> GameState:
        raw, me = self.raw, self.me
        players = raw.get("players", {})
        bets = raw.get("tB", {})
        statuses = raw.get("pGS", {})
        hero = players.get(me, {})
        hero_cards = []
        confidence = 1.0
        try:
            hero_cards = [normalize_card(c["value"]) for c in raw.get("pC", {}).get(me, {}).get("cards", []) if c.get("value")]
            board = [normalize_card(c) for c in self._board()]
        except (ValueError, TypeError, KeyError):
            board, confidence = [], 0.0
        if len(hero_cards) != 2 or "stack" not in hero:
            confidence = 0.0
        my_bet = _chips(bets.get(me))
        highest = max([_chips(raw.get("cHB"))] + [_chips(v) for v in bets.values()])
        street_bets = sum(_chips(v) for v in bets.values())
        stack = _chips(hero.get("stack"))
        in_hand = [pid for pid, status in statuses.items() if status not in ("fold",) and pid in raw.get("pC", {})]
        return GameState(
            hand_id=str(raw.get("hI") or raw.get("gN") or ""),
            hero_id=me or "",
            hero_stack=stack,
            hero_cards=tuple(hero_cards),
            board=tuple(board),
            pot=_chips(raw.get("pot")) + street_bets,
            amount_to_call=min(max(highest - my_bet, 0.0), stack),
            min_raise_to=_chips(raw.get("mR")) or None,
            big_blind=_chips(raw.get("bigBlind")) or 2,
            hero_position=str(self._seat_of(me) or ""),
            hero_turn=self.hero_turn,
            players=[Player(pid, self._seat_of(pid) or 0, _chips(players.get(pid, {}).get("stack")))
                     for pid in in_hand],
            parse_confidence=confidence,
            hero_bet=my_bet,
        )
