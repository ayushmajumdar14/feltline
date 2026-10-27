from poker_agent.database import PlayerStore
from poker_agent.hud import advance_demo, seed_demo, suggestion_confidence


def test_suggestion_confidence_from_equity():
    assert suggestion_confidence("range equity 0.80 vs 1 opp") >= 70
    assert 40 <= suggestion_confidence("just a note") <= 70


def test_demo_seed_and_advance(tmp_path):
    store = PlayerStore(tmp_path / "hud.db")
    store.ensure_settings({"bot_nickname": "pokerbot", "buy_in": 1000, "small_blind": 10, "big_blind": 20, "strategy": "theory"})
    table = seed_demo(store)
    assert table["id"] == "demo-table"
    assert store.get_table("demo-table")
    opps = store.list_opponents()
    names = {o["display_name"] for o in opps}
    assert {"Ayush", "helo", "riverboat"} <= names
    live = next(h for h in store.list_hands() if (h["raw"] or {}).get("live"))
    pending = store.pending_suggestion("demo-table", live["id"])
    assert pending and pending["suggested_action"] == "bet"
    result = advance_demo(store, "demo-table", live, "bet", 13)
    assert result["done"] is False
    again = store.get_hand(live["id"])
    assert again["raw"]["street"] == "turn"
    assert store.pending_suggestion("demo-table", live["id"])


def test_settings_and_tables(tmp_path):
    store = PlayerStore(tmp_path / "hud.db")
    store.ensure_settings({"bot_nickname": "felt", "buy_in": 200, "small_blind": 1, "big_blind": 2, "strategy": "equity"})
    pub = store.hud_settings_public()
    assert pub["nickname"] == "felt"
    assert pub["strategy"] == "equity"
    store.update_settings({"strategy": "theory", "autoplay_confirmed_at": "2026-01-01T00:00:00+00:00"})
    assert store.hud_settings_public()["strategy"] == "theory"
    table = store.add_table("https://www.pokernow.com/games/abc", "abc", "Home game")
    assert table["id"] == "abc"
    store.update_table("abc", status="suggesting")
    assert store.get_table("abc")["status"] == "suggesting"
    sug = store.add_suggestion("abc", "hand-1", "flop", "check", None, "pot odds", 61)
    store.resolve_suggestion(sug["id"], "taken", "check", None)
    assert store.get_suggestion(sug["id"])["accepted"] == "taken"
