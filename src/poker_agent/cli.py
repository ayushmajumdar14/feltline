import argparse
import asyncio
import json
from pathlib import Path
from .browser import PokerNowBrowser
from .database import PlayerStore
from .replay import import_replay_json
from .diagnostics import inspect_page, propose_selectors
from .live import LiveTable

async def open_browser(config):
    if not config.get("private_bot_game_confirmed"):
        raise RuntimeError("Explicit private bot-game permission confirmation required")
    browser=PokerNowBrowser(config["selectors_path"],config.get("headless",False))
    try:
        await browser.start(config["table_url"])
        print("Browser opened. This is a UI integration scaffold, NOT an autonomous verified bot.")
        print("PokerNow-specific selectors and state parsing require validation before enabling actions.")
        await asyncio.to_thread(input,"Press Enter to close... ")
    finally:
        await browser.close()

async def play_live(config, mode, sit, hands):
    if not config.get("private_bot_game_confirmed"):
        raise RuntimeError("Explicit private bot-game permission confirmation required")
    if mode not in ("observe", "play"):
        raise ValueError("mode must be 'observe' or 'play'")
    await LiveTable(config, mode).run(sit=sit, max_hands=hands)

async def import_table_log(config, game, start, stop):
    from playwright.async_api import async_playwright
    from .history import import_game_history
    game_id=game or config["table_url"].rstrip("/").split("/")[-1]
    store=PlayerStore(config["database_path"])
    async with async_playwright() as p:
        request=await p.request.new_context()
        try:
            count=await import_game_history(request, store, game_id, start, stop,
                                            on_hand=lambda h: print(f"hand #{h.number} ({len(h.actions)} actions, {len(h.showdowns)} shown)"))
        finally:
            await request.dispose()
    print(f"Imported {count} hands from {game_id}; latest stored hand #{store.last_hand_number(game_id)}")

async def inspect_browser(config, output):
    if not config.get("private_bot_game_confirmed"):
        raise RuntimeError("Private bot-game permission confirmation required")
    browser=PokerNowBrowser(config["selectors_path"], False)
    try:
        await browser.start(config["table_url"])
        print("Log in / join your permitted table, then press Enter to capture a read-only UI snapshot.")
        await asyncio.to_thread(input)
        snapshot=await inspect_page(browser.page, output)
        print(json.dumps(propose_selectors(snapshot),indent=2))
        print(f"Saved diagnostic screenshot and control inventory in {output}")
    finally:
        await browser.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--config",default="config.json")
    sub=parser.add_subparsers(dest="command",required=True)
    sub.add_parser("open-browser")
    inspect=sub.add_parser("inspect-ui"); inspect.add_argument("--output",default="diagnostics")
    play=sub.add_parser("play")
    play.add_argument("--mode",choices=["observe","play"],help="overrides config mode")
    play.add_argument("--sit",action="store_true",help="request a seat if the bot is not seated")
    play.add_argument("--hands",type=int,help="stop after acting in this many hands")
    imp=sub.add_parser("import-replay"); imp.add_argument("path")
    log=sub.add_parser("import-log",help="import finished hands from a Poker Now table's hand log")
    log.add_argument("--game",help="game id or URL (default: config table_url)")
    log.add_argument("--from",dest="start",type=int,help="first hand number (default: after last imported)")
    log.add_argument("--to",dest="stop",type=int,help="last hand number")
    stats=sub.add_parser("player-stats"); stats.add_argument("player_id",help="Poker Now player id or display name")
    sub.add_parser("players",help="list tracked players with headline stats")
    sim=sub.add_parser("simulate",help="duplicate-match strategies offline and report bb/100")
    sim.add_argument("strategies",nargs="+",help="theory, equity, station, nit, maniac (one per seat)")
    sim.add_argument("--deals",type=int,default=2000)
    sim.add_argument("--seed",type=int,default=1)
    sim.add_argument("--workers",type=int,default=8)
    hud=sub.add_parser("serve",help="run the Feltline HUD API for the local UI")
    hud.add_argument("--host",default="127.0.0.1")
    hud.add_argument("--port",type=int,default=8765)
    args=parser.parse_args()
    if args.command=="serve":
        from .server import serve
        config=json.loads(Path(args.config).read_text())
        asyncio.run(serve(config, args.host, args.port))
        return
    if args.command=="simulate":
        from .sim import simulate
        result=simulate(args.strategies,args.deals,args.seed,args.workers)
        for pid,(bb100,se,hands) in sorted(result.items(),key=lambda kv:-kv[1][0]):
            print(f"{pid:12s} {bb100:+8.1f} bb/100  ±{se:.1f} (1 s.e.)  over {hands} seat-hands")
        return
    config=json.loads(Path(args.config).read_text())
    if args.command=="open-browser": asyncio.run(open_browser(config))
    elif args.command=="inspect-ui": asyncio.run(inspect_browser(config,args.output))
    elif args.command=="play": asyncio.run(play_live(config,args.mode or config.get("mode","observe"),args.sit,args.hands))
    elif args.command=="import-log":
        game=args.game.rstrip("/").split("/")[-1] if args.game else None
        asyncio.run(import_table_log(config,game,args.start,args.stop))
    else:
        store=PlayerStore(config["database_path"])
        if args.command=="import-replay": print("Imported",import_replay_json(args.path,store),"hands")
        elif args.command=="players": print(json.dumps(store.list_players(),indent=2))
        else: print(json.dumps(store.player_stats(args.player_id),indent=2))

if __name__=="__main__": main()
