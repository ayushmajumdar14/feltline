"""Local Feltline API: REST + WebSocket in front of PlayerStore and LiveTable."""
import asyncio
import json
from pathlib import Path

from aiohttp import web

from .database import PlayerStore
from .hud import HudBridge, advance_demo, deal_live_demo, live_snapshot, seed_demo
from .live import LiveTable


def _json(data, status=200):
    return web.json_response(data, status=status)


def _hero(store, config):
    settings = store.settings_row() or {}
    return settings.get("pokernow_id") or config.get("hero_player_id") or None


def create_app(config, bridge: HudBridge):
    store = bridge.store
    app = web.Application()
    dist = Path(__file__).resolve().parents[2] / "web" / "dist"

    def hero():
        if bridge.session and bridge.session.tracker.me:
            return bridge.session.tracker.me
        return _hero(store, config)

    async def health(_):
        return _json({"ok": True, "connected": bridge.connected, "table_id": bridge.table_id})

    async def get_settings(_):
        store.ensure_settings(config)
        return _json(store.hud_settings_public())

    async def patch_settings(request):
        patch = await request.json()
        bridge.apply_settings(patch)
        return _json(store.hud_settings_public())

    async def get_profile(_):
        store.ensure_settings(config)
        return _json(store.profile_row())

    async def patch_profile(request):
        patch = await request.json()
        store.update_settings({k: patch[k] for k in ("display_name", "pokernow_id", "bio") if k in patch})
        return _json(store.profile_row())

    async def get_tables(_):
        return _json([store.table_public(t) for t in store.list_tables()])

    async def post_table(request):
        body = await request.json()
        url = (body.get("pokernow_url") or "").strip()
        game_id = body.get("game_id") or url.rstrip("/").split("/")[-1]
        table = store.add_table(url, game_id, body.get("nickname"), status="watching")
        return _json(store.table_public(table))

    async def patch_table(request):
        table_id = request.match_info["id"]
        body = await request.json()
        if body.get("status") == "autoplay" and not store.settings_row().get("autoplay_confirmed_at"):
            return _json({"error": "Auto-play is locked until the consent checklist is complete."}, 400)
        table = store.update_table(table_id, **{k: body[k] for k in ("status", "nickname") if k in body})
        if not table:
            return _json({"error": "not found"}, 404)
        if body.get("status") == "autoplay":
            await bridge.broadcast({"source": "table-coach", "type": "user.autoplay", "enabled": True})
        elif body.get("status"):
            await bridge.broadcast({"source": "table-coach", "type": "user.autoplay", "enabled": False})
        return _json(store.table_public(table))

    async def get_opponents(_):
        return _json(store.list_opponents(hero()))

    async def patch_opponent(request):
        pid = request.match_info["id"]
        body = await request.json()
        store.set_opponent_notes(pid, body.get("notes") or "")
        return _json({"ok": True})

    async def get_hands(_):
        return _json(store.list_hands(hero()))

    async def get_hand(request):
        hid = request.match_info["id"]
        hand = store.get_hand(hid, hero())
        if not hand:
            return _json({"error": "not found"}, 404)
        return _json({
            "hand": hand,
            "actions": store.list_actions(hid, hero()),
            "sugs": store.list_suggestions(hand_id=hid),
            "sd": store.list_showdowns(hand_id=hid),
        })

    async def get_suggestions(_):
        return _json(store.list_suggestions())

    async def get_book(_):
        return _json(store.book(hero()))

    async def get_showdowns(request):
        return _json(store.list_showdowns(opponent_id=request.match_info["id"]))

    async def get_live(request):
        table_id = request.match_info["id"]
        table = store.get_table(table_id)
        if not table:
            return _json({"error": "not found"}, 404)
        if bridge.session and bridge.table_id == table_id and bridge.snapshot:
            return _json(bridge.snapshot)
        hands = [h for h in store.list_hands(hero()) if h["table_id"] == table_id]
        if not hands:
            return _json(None)
        hand = hands[0]
        return _json({
            "hand": hand,
            "players": store.list_hand_players(hand["id"], hero()),
            "actions": store.list_actions(hand["id"], hero()),
            "suggestions": store.list_suggestions(hand_id=hand["id"]),
        })

    async def post_decide(request):
        table_id = request.match_info["id"]
        body = await request.json()
        kind = body.get("kind")
        action = body.get("action")
        size = body.get("size")
        sug_id = body.get("id")
        table = store.get_table(table_id)
        if table and table.get("is_demo"):
            hands = [h for h in store.list_hands() if h["table_id"] == table_id]
            live = next((h for h in hands if (h["raw"] or {}).get("live")), hands[0] if hands else None)
            if live and kind != "ignored":
                advance_demo(store, table_id, live, action or "check", size)
            elif live and kind == "ignored":
                if sug_id:
                    store.resolve_suggestion(sug_id, "ignored")
            return _json({"ok": True, "demo": True})
        if sug_id or bridge.pending_id:
            if not sug_id:
                sug = store.get_suggestion(bridge.pending_id)
                if kind == "taken" and sug:
                    action = sug["suggested_action"]
                    size = sug["size"]
            bridge.resolve(kind, action, size, sug_id)
            await bridge.broadcast({
                "source": "table-coach", "type": "user.decision",
                "decision": {"taken": "take", "overridden": "override", "ignored": "ignore"}.get(kind, kind),
                "action": action, "size": size,
            })
        return _json({"ok": True})

    async def post_connect(request):
        table_id = request.match_info["id"]
        body = await request.json() if request.can_read_body else {}
        table = store.get_table(table_id)
        if not table:
            return _json({"error": "not found"}, 404)
        if table.get("is_demo"):
            return _json({"ok": True, "demo": True})
        if not config.get("private_bot_game_confirmed"):
            return _json({"error": "private_bot_game_confirmed must be true in config.json"}, 400)
        if bridge.task and not bridge.task.done():
            if body.get("sit") and bridge.session:
                try:
                    bridge.session.allow_resit = True
                    await bridge.session.request_seat()
                    return _json({"ok": True, "already": True, "sit": True})
                except Exception as exc:
                    return _json({"ok": True, "already": True, "sit_error": str(exc)})
            return _json({"ok": True, "already": True})
        config["table_url"] = table["pokernow_url"]
        sit = bool(body.get("sit"))
        mode = "play" if table["status"] == "autoplay" else "observe"
        session = LiveTable(config, mode, bridge=bridge)
        bridge.session = session
        bridge.table_id = table_id
        store.update_table(table_id, status="suggesting" if mode == "observe" else "autoplay")
        bridge.task = asyncio.create_task(session.run(sit=sit))
        return _json({"ok": True})

    async def post_sit(request):
        table_id = request.match_info["id"]
        table = store.get_table(table_id)
        if not table:
            return _json({"error": "not found"}, 404)
        if not bridge.session:
            return _json({"error": "bot is not connected to a table"}, 400)
        try:
            bridge.session.allow_resit = True
            await bridge.session.request_seat()
            return _json({"ok": True, "buy_in": config.get("buy_in")})
        except Exception as exc:
            return _json({"error": str(exc)}, 400)

    async def post_stop(request):
        if bridge.session:
            bridge.session.stop = True
        return _json({"ok": True})

    async def post_demo_deal(request):
        body = await request.json() if request.can_read_body else {}
        n = int(body.get("hand_number") or 112)
        deal_live_demo(store, n)
        return _json({"ok": True})

    async def post_demo_reset(_):
        store.db.execute("DELETE FROM hud_suggestions WHERE table_id='demo-table'")
        store.db.execute("DELETE FROM hands WHERE table_id='demo-table' OR game_id='demo-table'")
        store.db.execute("DELETE FROM hud_tables WHERE id='demo-table'")
        store.db.commit()
        seed_demo(store)
        return _json({"ok": True})

    async def export(_):
        return _json(store.export_all(hero()))

    async def ws_handler(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        bridge.subscribers.add(ws)
        store.update_settings({"extension_connected": True})
        try:
            if bridge.snapshot and bridge.snapshot.get("state"):
                await ws.send_json({"source": "table-coach", **bridge.snapshot["state"]})
            async for _ in ws:
                pass
        finally:
            bridge.subscribers.discard(ws)
            if not bridge.subscribers:
                store.update_settings({"extension_connected": False})
        return ws

    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }

    @web.middleware
    async def cors_mw(request, handler):
        if request.method == "OPTIONS":
            return web.Response(headers=cors)
        resp = await handler(request)
        resp.headers.update(cors)
        return resp

    app.middlewares.append(cors_mw)
    app.add_routes([
        web.get("/api/health", health),
        web.get("/api/settings", get_settings),
        web.patch("/api/settings", patch_settings),
        web.get("/api/profile", get_profile),
        web.patch("/api/profile", patch_profile),
        web.get("/api/tables", get_tables),
        web.post("/api/tables", post_table),
        web.patch("/api/tables/{id}", patch_table),
        web.get("/api/opponents", get_opponents),
        web.patch("/api/opponents/{id}", patch_opponent),
        web.get("/api/hands", get_hands),
        web.get("/api/hands/{id}", get_hand),
        web.get("/api/suggestions", get_suggestions),
        web.get("/api/book", get_book),
        web.get("/api/showdowns/{id}", get_showdowns),
        web.get("/api/live/{id}", get_live),
        web.post("/api/live/{id}/decide", post_decide),
        web.post("/api/tables/{id}/connect", post_connect),
        web.post("/api/tables/{id}/sit", post_sit),
        web.post("/api/tables/{id}/stop", post_stop),
        web.post("/api/demo/deal", post_demo_deal),
        web.post("/api/demo/reset", post_demo_reset),
        web.get("/api/export", export),
        web.get("/ws", ws_handler),
    ])
    if dist.is_dir():
        app.router.add_static("/", dist, show_index=True)
    return app


async def serve(config, host="127.0.0.1", port=8765):
    store = PlayerStore(config["database_path"])
    store.ensure_settings(config)
    seed_demo(store)
    url = config.get("table_url") or ""
    if "pokernow." in url and "/games/" in url:
        game_id = url.rstrip("/").split("/")[-1]
        store.add_table(url, game_id, config.get("bot_nickname") or game_id, status="watching")
    bridge = HudBridge(store, config)
    app = create_app(config, bridge)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    print(f"Feltline API on http://{host}:{port}  (UI: cd web && npm run dev)")
    try:
        while True:
            await asyncio.sleep(3600)
    finally:
        if bridge.session:
            bridge.session.stop = True
        await runner.cleanup()
