"""Feltline HUD: live snapshots, suggestions, and the demo table seed."""
import asyncio
import json
import re
import uuid
from datetime import datetime, timezone, timedelta

from .models import Action, Decision
from .pokernow_state import TableTracker

STREETS = {0: "preflop", 3: "flop", 4: "turn", 5: "river"}

DEMO_OPPONENTS = (
    ("pn_ayush", "Ayush", True, "Calls down light. Value bet thinner, bluff less."),
    ("pn_helo", "helo", True, "Very tight. Respect raises."),
    ("guest_riverboat", "riverboat", False, "Guest. Raises wide, barrels often."),
)
DEMO_BOARDS = [
    ["Ks", "7d", "2c", "9h", "4s"], ["Qh", "Jh", "5c", "2d", "8s"], ["Ad", "8c", "3s", "3h", "Tc"],
    ["9s", "6s", "2h", "Kd", "Qc"], ["Tc", "Td", "4h", "7s", "Ac"], ["Jc", "8d", "6h", "5s", "2s"],
    ["As", "Kc", "7h", "7c", "3d"], ["5d", "4d", "3c", "Jh", "9c"], ["Qs", "9d", "2s", "6c", "Kh"],
    ["8h", "7c", "2d", "Ah", "Js"], ["Kh", "Td", "6s", "3c", "5h"],
]
DEMO_HEROS = [
    ["Ah", "Kd"], ["Tc", "Ts"], ["Kh", "Qh"], ["Ac", "5c"], ["9d", "9c"], ["As", "Jd"],
    ["Qc", "Qd"], ["6h", "6d"], ["Ah", "Qc"], ["Kc", "Jc"], ["Ad", "Td"],
]
DEMO_LIVE = {
    "board": ["Qs", "8d", "3c"],
    "hero": ["As", "Qd"],
    "reason": "Range c-bet on a dry flop. Bet 66% pot — Ayush calls wide, riverboat folds this texture often.",
}


def suggestion_confidence(reason: str) -> int:
    match = re.search(r"equity ([0-9.]+)", reason or "")
    if match:
        equity = float(match.group(1))
        return max(40, min(92, int(50 + abs(equity - 0.5) * 90)))
    if "MDF" in (reason or ""):
        return 62
    if "stack-off" in (reason or ""):
        return 70
    return 58


def street_name(board) -> str:
    return STREETS.get(len(board or []), "preflop")


def seed_demo(store):
    """Seed the clickable demo table once, so the HUD works without Poker Now."""
    if store.get_table("demo-table"):
        return store.get_table("demo-table")
    now = datetime.now(timezone.utc)
    table = store.add_table("https://www.pokernow.club/games/demo-table", "demo-table", "Demo table",
                            is_demo=True, status="suggesting")
    for pid, name, account, notes in DEMO_OPPONENTS:
        store.upsert_player(pid, name, account, commit=False)
        store.set_opponent_notes(pid, notes)
    for i, (board, hero) in enumerate(zip(DEMO_BOARDS, DEMO_HEROS), start=1):
        hid = f"demo-hand-{100 + i}"
        net = -18 if i % 3 == 0 else 24 if i % 2 == 0 else 11
        started = (now - timedelta(minutes=6 * (12 - i))).isoformat()
        store.db.execute(
            "INSERT OR IGNORE INTO hands(hand_id,started_at,source,raw_json,game_id,hand_number,table_id) VALUES (?,?,?,?,?,?,?)",
            (hid, started, "demo", json.dumps({
                "board": board, "number": 100 + i, "hero_cards": hero, "hero_net": net,
                "pot": 40 + i * 3, "live": False, "street": "river", "hero_stack": 200 + net,
            }), "demo-table", 100 + i, "demo-table"))
        for pid, seat, stack, won in (
            ("pn_ayush", 2, 200 - i * 2, 30 if i % 3 == 0 else 0),
            ("pn_helo", 4, 210 + i, 22 if i == 5 else 0),
            ("guest_riverboat", 6, 180 + (i % 4) * 15, 26 if i % 4 == 0 else 0),
        ):
            store.db.execute("INSERT OR REPLACE INTO hand_players VALUES (?,?,?,?,?)", (hid, pid, seat, stack, won))
        seq = 0
        def act(pid, street, action, amount, facing):
            nonlocal seq
            seq += 1
            store.record_action(hid, seq, pid, street, None, action, amount, None, facing, commit=False)
        act("hero", "preflop", "raise", 6, "blind")
        act("pn_ayush", "preflop", "call", 6, "raise")
        act("pn_helo", "preflop", "call" if i == 5 else "fold", 6 if i == 5 else None, "raise")
        act("guest_riverboat", "preflop", "call", 6, "raise")
        act("hero", "flop", "bet", 12, "none")
        act("pn_ayush", "flop", "call", 12, "bet")
        accepted = ("taken", "overridden", "ignored")[i % 3]
        store.db.execute(
            "INSERT INTO hud_suggestions(id,table_id,hand_id,street,suggested_action,size,reason,confidence,accepted,actual_action,actual_size,created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), "demo-table", hid, "flop", "bet", 12,
             "Range c-bet, dry board. Bet 66% pot.", 60 + i, accepted,
             "check" if accepted == "overridden" else ("bet" if accepted != "ignored" else None),
             None if accepted != "taken" else 12, started))
    store.db.commit()
    deal_live_demo(store, 112)
    return table


def deal_live_demo(store, hand_number=112):
    hid = f"demo-hand-{hand_number}"
    board, hero = DEMO_LIVE["board"], DEMO_LIVE["hero"]
    store.upsert_hand_raw(hid, "demo-table", "demo-table", hand_number, board, {
        "hero_cards": hero, "pot": 20, "live": True, "street": "flop", "hero_stack": 194, "hero_net": 0, "river_in": True,
    }, source="demo")
    store.db.execute("DELETE FROM hand_players WHERE hand_id=?", (hid,))
    for pid, seat, stack in (("pn_ayush", 2, 198), ("pn_helo", 4, 200), ("guest_riverboat", 6, 194)):
        store.db.execute("INSERT OR REPLACE INTO hand_players VALUES (?,?,?,?,?)", (hid, pid, seat, stack, 0))
    store.db.execute("DELETE FROM actions WHERE hand_id=?", (hid,))
    store.record_action(hid, 1, "hero", "preflop", None, "raise", 6, None, "blind", commit=False)
    store.record_action(hid, 2, "pn_ayush", "preflop", None, "call", 6, None, "raise", commit=False)
    store.record_action(hid, 3, "pn_helo", "preflop", None, "fold", None, None, "raise", commit=False)
    store.record_action(hid, 4, "guest_riverboat", "preflop", None, "call", 6, None, "raise", commit=False)
    store.db.commit()
    if not store.pending_suggestion("demo-table", hid):
        store.add_suggestion("demo-table", hid, "flop", "bet", 13, DEMO_LIVE["reason"], 71)
    return hid


def live_snapshot(tracker: TableTracker, store, table_id, hero_id=None):
    """Build the coach payload from the live socket tracker."""
    hero_id = hero_id or tracker.me
    table = store.get_table(table_id)
    if not tracker.me or not tracker.raw:
        return None
    try:
        state = tracker.game_state()
    except Exception:
        return None
    street = street_name(state.board)
    raw = tracker.raw
    players = raw.get("players", {})
    seats = {pid: seat for seat, pid in raw.get("seats", [])}
    statuses = raw.get("pGS", {})
    hand_number = raw.get("gN") or 0
    hand_id = str(state.hand_id or f"live-{hand_number}")
    store.upsert_hand_raw(hand_id, table_id, table["game_id"] if table else table_id, hand_number, list(state.board), {
        "hero_cards": list(state.hero_cards), "pot": state.pot, "live": True, "street": street,
        "hero_stack": state.hero_stack, "hero_net": 0,
    }, source="live")
    store.db.execute("DELETE FROM hand_players WHERE hand_id=?", (hand_id,))
    for pid, info in players.items():
        if pid == hero_id:
            continue
        if statuses.get(pid) == "fold" and pid not in raw.get("pC", {}):
            continue
        store.db.execute("INSERT OR REPLACE INTO hand_players VALUES (?,?,?,?,?)",
                         (hand_id, pid, seats.get(pid, 0), info.get("stack") or 0, 0))
    store.db.execute("DELETE FROM actions WHERE hand_id=?", (hand_id,))
    for seq, (pid, st, action, amount) in enumerate(tracker.history):
        actor = "hero" if pid == hero_id else pid
        store.record_action(hand_id, seq, actor, st, None, action, amount, None, "none", commit=False)
    store.db.commit()
    pending = store.pending_suggestion(table_id, hand_id)
    return {
        "hand": store.get_hand(hand_id, hero_id),
        "players": store.list_hand_players(hand_id, hero_id),
        "actions": store.list_actions(hand_id, hero_id),
        "suggestions": store.list_suggestions(hand_id=hand_id),
        "pending": pending,
        "state": {
            "type": "table.state",
            "game_id": table["game_id"] if table else table_id,
            "hand_number": hand_number,
            "street": street,
            "pot": state.pot,
            "board": list(state.board),
            "hero_cards": list(state.hero_cards),
            "seats": [
                {"seat": seats.get(pid, 0), "player_id": pid, "name": (players.get(pid) or {}).get("name") or pid,
                 "stack": (players.get(pid) or {}).get("stack") or 0,
                 "in_hand": statuses.get(pid) != "fold"}
                for pid in players if pid != hero_id
            ],
            "to_act": "hero" if tracker.hero_turn else (raw.get("cPI") or ""),
        },
    }


class HudBridge:
    """Pushes table.state / table.suggestion to the HUD and waits for user.decision."""

    def __init__(self, store, config):
        self.store = store
        self.config = config
        self.subscribers: set = set()
        self.session = None
        self.task = None
        self.table_id = None
        self.decision_event = asyncio.Event()
        self.decision = None
        self.pending_id = None
        self.snapshot = None

    @property
    def autoplay(self) -> bool:
        table = self.store.get_table(self.table_id) if self.table_id else None
        return bool(table and table["status"] == "autoplay")

    @property
    def connected(self) -> bool:
        return bool(self.session and self.session.tracker.me)

    async def broadcast(self, event: dict):
        dead = []
        for ws in list(self.subscribers):
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.subscribers.discard(ws)

    async def publish_state(self, table):
        if not self.table_id:
            return
        snap = live_snapshot(table.tracker, self.store, self.table_id, table.tracker.me)
        self.snapshot = snap
        if snap and snap.get("state"):
            await self.broadcast({"source": "table-coach", **snap["state"]})

    async def offer(self, table, state, decision: Decision, street: str):
        size = decision.amount if decision.action in (Action.BET, Action.RAISE) else None
        sug = self.store.add_suggestion(
            self.table_id, state.hand_id, street, decision.action.value, size,
            decision.reason, suggestion_confidence(decision.reason))
        self.pending_id = sug["id"]
        self.decision = None
        self.decision_event = asyncio.Event()
        await self.publish_state(table)
        await self.broadcast({
            "source": "table-coach", "type": "table.suggestion",
            "action": decision.action.value, "size": size,
            "reason": decision.reason, "confidence": sug["confidence"],
            "id": sug["id"],
        })
        return sug

    async def wait_decision(self, timeout=180):
        try:
            await asyncio.wait_for(self.decision_event.wait(), timeout)
        except asyncio.TimeoutError:
            return None
        return self.decision

    def resolve(self, kind, action=None, size=None, suggestion_id=None):
        sug_id = suggestion_id or self.pending_id
        if sug_id:
            self.store.resolve_suggestion(sug_id, kind, action, size)
        self.decision = {"kind": kind, "action": action, "size": size, "id": sug_id}
        self.decision_event.set()
        return self.decision

    def apply_settings(self, patch):
        row = self.store.update_settings(patch)
        if self.session and "strategy" in patch:
            from .strategy import EquityStrategy
            from .theory import TheoryStrategy
            name = patch["strategy"]
            self.session.strategy = TheoryStrategy() if name == "theory" else EquityStrategy()
            self.config["strategy"] = name
        if "nickname" in patch:
            self.config["bot_nickname"] = patch["nickname"]
        for key in ("buy_in", "small_blind", "big_blind"):
            if key in patch:
                self.config[key] = patch[key]
        return row


DEMO_NEXT = [
    ("turn", "5s", "bet", 0.6, "Blank turn. Ayush rarely folds to bets, so keep betting for value with top pair.", 64),
    ("river", "9d", "bet", 0.5, "Thin value on a quiet river; Ayush calls down with weaker kings and sevens.", 58),
]


def advance_demo(store, table_id, hand, hero_action, hero_size):
    raw = dict(hand["raw"] or {})
    street = raw.get("street") or "flop"
    hid = hand["id"]
    pot = float(raw.get("pot") or 0)
    hero_stack = float(raw.get("hero_stack") or 200)
    seq = max([a["seq"] for a in store.list_actions(hid)] or [0])

    def push(actor, action, amount, facing):
        nonlocal seq
        seq += 1
        store.record_action(hid, seq, actor, street, None, action, amount, None, facing, commit=False)

    push("hero", hero_action, hero_size, "none")
    aggressive = hero_action in ("bet", "raise")
    if aggressive and hero_size:
        pot += hero_size
        hero_stack -= hero_size
    if aggressive:
        push("pn_ayush", "call", hero_size, "bet")
        pot += hero_size or 0
        push("guest_riverboat", "fold", None, "bet")
    else:
        push("pn_ayush", "check", None, "none")
        push("guest_riverboat", "check", None, "none")
    store.db.commit()
    if hero_action == "fold":
        raw.update({"live": False, "pot": pot, "hero_stack": hero_stack, "hero_net": -(200 - hero_stack)})
        store.upsert_hand_raw(hid, table_id, "demo-table", hand["hand_number"], hand["board"], raw, source="demo")
        return {"done": True}
    nxt = {"flop": 0, "turn": 1}.get(street)
    if nxt is None:
        store.record_showdown(hid, "pn_ayush", ["Kh", "8h"], commit=True)
        raw.update({"live": False, "pot": pot, "hero_stack": hero_stack + pot, "hero_net": pot - (200 - hero_stack)})
        store.upsert_hand_raw(hid, table_id, "demo-table", hand["hand_number"], hand["board"], raw, source="demo")
        return {"done": True}
    nstreet, card, action, pct, reason, conf = DEMO_NEXT[nxt]
    board = list(hand["board"]) + ([card] if card else [])
    raw.update({"street": nstreet, "pot": pot, "hero_stack": hero_stack, "live": True})
    store.upsert_hand_raw(hid, table_id, "demo-table", hand["hand_number"], board, raw, source="demo")
    store.add_suggestion(table_id, hid, nstreet, action, max(2, round(pot * pct)), reason, conf)
    return {"done": False}
