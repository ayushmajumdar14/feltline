"""Live Poker Now play loop: socket state in, verified UI clicks out."""
import asyncio
import json
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from playwright.async_api import async_playwright
from .database import PlayerStore
from .history import import_game_history
from .models import Action
from .pokernow_state import TableTracker
from .preflop import Seat
from .strategy import EquityStrategy, HandContext, OpponentProfile
from .theory import TheoryStrategy

STREETS = {0: "preflop", 3: "flop", 4: "turn", 5: "river"}


class LiveTable:
    def __init__(self, config, mode, log_path="bot_log.jsonl", bridge=None):
        self.config = config
        self.mode = mode
        self.bridge = bridge
        self.stop = False
        self.sel = json.loads(Path(config["selectors_path"]).read_text())
        self.tracker = TableTracker()
        self.strategy = TheoryStrategy() if config.get("strategy", "theory") == "theory" else EquityStrategy()
        self.store = bridge.store if bridge else PlayerStore(config["database_path"])
        self.log_file = open(log_path, "a")
        self.page = None
        self.attempts = {}
        self.hands_played = set()
        self.game_id = config["table_url"].rstrip("/").split("/")[-1]
        self.history_task = None
        self.synced_through = -1
        self.allow_resit = False
        self._last_sit_at = 0.0

    def context(self, state):
        opponents = [OpponentProfile.from_stats(self.store.player_stats(p.player_id))
                     for p in state.players if p.player_id != state.hero_id]
        order = self.tracker.dealt_order()
        n = len(order)
        seats = {}
        for idx, pid in enumerate(order):
            small = (idx == n - 1) if n == 2 else idx == 0
            big = (idx == 0) if n == 2 else idx == 1
            seats[pid] = Seat(distance=n - 1 - idx, small_blind=small, big_blind=big, players=n)
        history = list(self.tracker.history)
        first_raiser = next((h[0] for h in history if h[1] == "preflop" and h[2] in ("bet", "raise")), None)
        return HandContext(hero_preflop_aggressor=self.tracker.preflop_raiser == state.hero_id,
                           hero_late_position=self.tracker.hero_late_position(),
                           opponents=opponents, history=history, seat=seats.get(state.hero_id),
                           seats=seats, raiser_seat=seats.get(first_raiser), order=order)

    def record_seen_players(self):
        for pid, (name, is_account) in self.tracker.seen_players().items():
            self.store.upsert_player(pid, name, is_account, commit=False)
        self.store.db.commit()

    async def sync_history(self):
        try:
            count = await import_game_history(self.page.request, self.store, self.game_id)
            if count:
                self.log("history_imported", hands=count, through=self.store.last_hand_number(self.game_id))
        except Exception as exc:
            self.log("history_error", error=str(exc))

    def maybe_sync_history(self):
        if self.tracker.finished_hands == self.synced_through:
            return
        if self.history_task and not self.history_task.done():
            return
        self.synced_through = self.tracker.finished_hands
        self.record_seen_players()
        self.history_task = asyncio.create_task(self.sync_history())

    def log(self, kind, **data):
        entry = {"ts": datetime.now(timezone.utc).isoformat(), "kind": kind, **data}
        self.log_file.write(json.dumps(entry, default=str) + "\n")
        self.log_file.flush()
        print(f"[{kind}] " + ", ".join(f"{k}={v}" for k, v in data.items()), flush=True)

    def _on_websocket(self, ws):
        if "socket.io" not in ws.url:
            return
        ws.on("framereceived", lambda f: self.tracker.feed(f) if isinstance(f, str) else None)

    async def dismiss_popups(self):
        for sel in self.sel["dismiss_buttons"]:
            loc = self.page.locator(sel)
            if await loc.count() and await loc.first.is_visible():
                await loc.first.click()

    def seated(self):
        return any(pid == self.tracker.me for _, pid in self.tracker.raw.get("seats", []))

    async def request_seat(self):
        await self.dismiss_popups()
        seats = self.page.locator(self.sel["seat_button"])
        if not await seats.count():
            raise RuntimeError("No free seat at the table")
        await seats.first.click()
        await self.page.locator(self.sel["nickname_input"]).fill(self.config.get("bot_nickname", "pokerbot"))
        await self.page.locator(self.sel["stack_input"]).fill(str(int(self.config["buy_in"])))
        await self.page.locator(self.sel["request_seat_button"]).click()
        self._last_sit_at = time.monotonic()
        self.log("seat_requested", nickname=self.config.get("bot_nickname", "pokerbot"),
                 buy_in=self.config.get("buy_in"))

    async def maybe_resit(self):
        """After a bust the seat is empty; request the configured buy-in again."""
        if self.seated() or not self.allow_resit:
            return
        if time.monotonic() - self._last_sit_at < 15:
            return
        try:
            await self.request_seat()
            self.log("resit_requested", reason="not seated (likely bust)")
        except Exception as exc:
            self._last_sit_at = time.monotonic()
            self.log("resit_error", error=str(exc))

    async def _click(self, name):
        loc = self.page.locator(f"{self.sel[name]}:not([disabled])")
        if await loc.count() != 1:
            raise RuntimeError(f"Control {name} not uniquely available")
        await loc.click(timeout=4000)

    async def ensure_action_bar(self):
        back = self.page.locator(self.sel["raise_back"])
        if await back.count() and await back.first.is_visible():
            await back.first.click(timeout=3000)
        await self.page.locator(self.sel["fold_button"]).wait_for(state="visible", timeout=4000)

    async def execute(self, decision, state):
        await self.ensure_action_bar()
        action = decision.action
        if action == Action.FOLD and state.amount_to_call == 0:
            action = Action.CHECK
        if action in (Action.BET, Action.RAISE):
            raise_btn = self.page.locator(f"{self.sel['raise_button']}:not([disabled])")
            if not await raise_btn.count():
                action = Action.CALL if state.amount_to_call > 0 else Action.CHECK
            else:
                await raise_btn.click(timeout=4000)
                box = self.page.locator(self.sel["raise_input"])
                await box.wait_for(timeout=4000)
                await box.fill(str(int(decision.amount)))
                await self._click("raise_submit")
                return action
        name = {Action.FOLD: "fold_button", Action.CHECK: "check_button", Action.CALL: "call_button"}[action]
        await self._click(name)
        return action

    async def wait_for_turn_to_pass(self, key, timeout=6.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if not self.tracker.hero_turn or self.tracker.hand_key() != key:
                return True
            await asyncio.sleep(0.1)
        return False

    async def take_turn(self):
        key = self.tracker.hand_key()
        if self.attempts.get(key, 0) >= 3:
            return
        self.attempts[key] = self.attempts.get(key, 0) + 1
        state = self.tracker.game_state()
        street = STREETS.get(len(state.board), "unknown")
        try:
            context = self.context(state)
            decision = self.strategy.decide(state, context)
        except ValueError as exc:
            self.attempts[key] = 3
            self.log("skip", reason=str(exc), hand=state.hand_id)
            return
        self.log("decision", hand=state.hand_id, street=street, cards=" ".join(state.hero_cards),
                 board=" ".join(state.board), pot=state.pot, to_call=state.amount_to_call,
                 stack=state.hero_stack, action=decision.action.value, amount=decision.amount,
                 reason=decision.reason, opponents=[(o.player_id, o.hands) for o in context.opponents])
        autoplay = self.mode == "play" or (self.bridge and self.bridge.autoplay)
        if self.bridge:
            await self.bridge.offer(self, state, decision, street)
            if not autoplay:
                user = await self.bridge.wait_decision()
                if not user or user["kind"] == "ignored":
                    self.log("hud_ignored", hand=state.hand_id)
                    self.attempts[key] = 3
                    self.hands_played.add(state.hand_id)
                    return
                if user["kind"] == "overridden" and user.get("action"):
                    try:
                        decision = type(decision)(Action(user["action"]), user.get("size"), "hud override")
                    except ValueError:
                        pass
                elif user["kind"] == "taken":
                    pass
            else:
                await asyncio.sleep(random.uniform(0.8, 1.6))
        elif self.mode != "play":
            self.attempts[key] = 3
            self.hands_played.add(state.hand_id)
            return
        else:
            await asyncio.sleep(random.uniform(0.8, 1.6))
        if not self.tracker.hero_turn or self.tracker.hand_key() != key:
            self.log("stale", hand=state.hand_id, still_turn=self.tracker.hero_turn,
                     before=key, after=self.tracker.hand_key(), status=self.tracker.raw.get("sNA"))
            return
        try:
            done = await self.execute(decision, state)
        except Exception as exc:
            self.log("action_error", hand=state.hand_id, error=str(exc))
            await self.page.screenshot(path="bot_error.png")
            return
        accepted = await self.wait_for_turn_to_pass(key)
        self.log("acted" if accepted else "not_accepted", hand=state.hand_id, action=done.value,
                 amount=decision.amount if done in (Action.BET, Action.RAISE) else None)
        if accepted:
            self.attempts[key] = 3
            self.hands_played.add(state.hand_id)

    async def run(self, sit=False, max_hands=None):
        async with async_playwright() as p:
            ctx = await p.chromium.launch_persistent_context(
                self.config.get("profile_dir", ".bot-profile"),
                headless=self.config.get("headless", False),
                viewport={"width": 1280, "height": 800})
            self.page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            self.page.on("websocket", self._on_websocket)
            try:
                await self.page.goto(self.config["table_url"])
                while self.tracker.me is None:
                    await asyncio.sleep(0.2)
                await asyncio.sleep(1.5)
                await self.dismiss_popups()
                self.log("connected", player_id=self.tracker.me, seated=self.seated(), mode=self.mode)
                self.allow_resit = sit or self.seated()
                if not self.seated():
                    if not sit:
                        raise RuntimeError("Bot is not seated; rerun with --sit to request a seat")
                    await self.request_seat()
                    while not self.seated():
                        await asyncio.sleep(0.5)
                    self.log("seated", player_id=self.tracker.me)
                while not self.stop and (max_hands is None or len(self.hands_played) < max_hands):
                    if self.bridge:
                        await self.bridge.publish_state(self)
                    if not self.seated():
                        await self.maybe_resit()
                    elif self.tracker.hero_turn:
                        await self.take_turn()
                    else:
                        self.maybe_sync_history()
                    await asyncio.sleep(0.15)
                self.log("stopped", hands=len(self.hands_played))
            finally:
                if self.history_task and not self.history_task.done():
                    self.history_task.cancel()
                await ctx.close()
