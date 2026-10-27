import json
from pathlib import Path
from playwright.async_api import async_playwright
from .models import Action

class PokerNowBrowser:
    """UI adapter. Selectors are intentionally unverified and must be configured."""
    def __init__(self, selectors_path, headless=False):
        self.selectors=json.loads(Path(selectors_path).read_text())
        self.headless=headless
        self.playwright=None
        self.browser=None
        self.page=None
    async def start(self, url):
        self.playwright=await async_playwright().start()
        self.browser=await self.playwright.chromium.launch(headless=self.headless)
        self.page=await self.browser.new_page()
        await self.page.goto(url)
    def selector(self, name):
        value=self.selectors.get(name)
        if not value: raise RuntimeError(f"PokerNow selector '{name}' not verified/configured")
        return value
    async def text(self, name):
        return await self.page.locator(self.selector(name)).inner_text(timeout=4000)
    async def click(self, name):
        locator=self.page.locator(self.selector(name))
        if await locator.count()!=1: raise RuntimeError(f"Ambiguous/missing UI control: {name}")
        await locator.click(timeout=4000)
    async def send_chat(self, message):
        if message != "Time": raise ValueError("Only configured session Time message supported")
        await self.page.locator(self.selector("chat_input")).fill(message)
        await self.click("chat_send_button")
    async def execute(self, decision):
        mapping={Action.FOLD:"fold_button",Action.CHECK:"check_button",Action.CALL:"call_button",Action.BET:"raise_button",Action.RAISE:"raise_button"}
        if decision.action in (Action.BET,Action.RAISE):
            if decision.amount is None or decision.amount <= 0: raise ValueError("Invalid raise amount")
            await self.page.locator(self.selector("raise_input")).fill(str(decision.amount))
        await self.click(mapping[decision.action])
    async def leave_seat(self):
        await self.click("leave_seat_button")
    async def close(self):
        if self.browser: await self.browser.close()
        if self.playwright: await self.playwright.stop()
