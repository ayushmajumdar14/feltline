import json
import sqlite3
import uuid
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (player_id TEXT PRIMARY KEY, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hands (hand_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, source TEXT NOT NULL, raw_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS actions (hand_id TEXT NOT NULL, seq INTEGER NOT NULL, player_id TEXT NOT NULL, street TEXT NOT NULL, position TEXT, action TEXT NOT NULL, amount REAL, pot_before REAL, PRIMARY KEY(hand_id,seq));
CREATE TABLE IF NOT EXISTS showdowns (hand_id TEXT NOT NULL, player_id TEXT NOT NULL, cards_json TEXT NOT NULL, PRIMARY KEY(hand_id,player_id));
CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, buy_in REAL NOT NULL, time_called_at TEXT, exit_deadline TEXT, exited_at TEXT);
CREATE TABLE IF NOT EXISTS hand_players (hand_id TEXT NOT NULL, player_id TEXT NOT NULL, seat INTEGER, stack REAL, won REAL, PRIMARY KEY(hand_id,player_id));
CREATE TABLE IF NOT EXISTS player_names (player_id TEXT NOT NULL, name TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY(player_id,name));
"""
MIGRATIONS = {
    "players": {"name": "TEXT", "is_account": "INTEGER"},
    "hands": {"game_id": "TEXT", "hand_number": "INTEGER", "table_id": "TEXT"},
    "actions": {"facing": "TEXT"},
}
HUD_SCHEMA = """
CREATE TABLE IF NOT EXISTS hud_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT DEFAULT 'local',
  nickname TEXT,
  buy_in REAL,
  small_blind REAL,
  big_blind REAL,
  strategy TEXT,
  default_mode TEXT,
  autoplay_confirmed_at TEXT,
  extension_connected INTEGER DEFAULT 0,
  display_name TEXT,
  pokernow_id TEXT,
  bio TEXT DEFAULT '',
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS hud_tables (
  id TEXT PRIMARY KEY,
  pokernow_url TEXT NOT NULL,
  game_id TEXT,
  nickname TEXT,
  is_demo INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle',
  last_seen_at TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS hud_suggestions (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  hand_id TEXT,
  street TEXT,
  suggested_action TEXT,
  size REAL,
  reason TEXT,
  confidence REAL,
  accepted TEXT DEFAULT 'pending',
  actual_action TEXT,
  actual_size REAL,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS opponent_notes (
  player_id TEXT PRIMARY KEY,
  notes TEXT DEFAULT ''
);
"""
POSTFLOP = ("flop", "turn", "river")


def _ratio(num, den):
    return round(num / den, 3) if den else None


class PlayerStore:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self.db.executescript(HUD_SCHEMA)
        for table, columns in MIGRATIONS.items():
            existing = {row[1] for row in self.db.execute(f"PRAGMA table_info({table})")}
            for column, kind in columns.items():
                if column not in existing:
                    self.db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {kind}")
        self.db.commit()

    def upsert_player(self, player_id, name=None, is_account=None, commit=True):
        now = datetime.now(timezone.utc).isoformat()
        self.db.execute(
            "INSERT INTO players(player_id,first_seen,last_seen,name,is_account) VALUES (?,?,?,?,?) "
            "ON CONFLICT(player_id) DO UPDATE SET last_seen=excluded.last_seen, "
            "name=COALESCE(excluded.name,players.name), is_account=COALESCE(excluded.is_account,players.is_account)",
            (player_id, now, now, name, None if is_account is None else int(is_account)))
        if name:
            self.db.execute("INSERT INTO player_names VALUES (?,?,?) ON CONFLICT(player_id,name) DO UPDATE SET last_seen=excluded.last_seen",
                            (player_id, name, now))
        if commit:
            self.db.commit()

    def add_hand(self, hand_id, payload, source="live"):
        self.db.execute("INSERT OR IGNORE INTO hands(hand_id,started_at,source,raw_json) VALUES (?,?,?,?)", (hand_id,datetime.now(timezone.utc).isoformat(),source,json.dumps(payload)))
        self.db.commit()

    def record_action(self, hand_id, seq, player_id, street, position, action, amount=None, pot_before=None, facing=None, commit=True):
        self.upsert_player(player_id, commit=False)
        self.db.execute("INSERT OR IGNORE INTO actions(hand_id,seq,player_id,street,position,action,amount,pot_before,facing) VALUES (?,?,?,?,?,?,?,?,?)",
                        (hand_id,seq,player_id,street,position,action,amount,pot_before,facing))
        if commit:
            self.db.commit()

    def record_showdown(self, hand_id, player_id, cards, commit=True):
        self.db.execute("INSERT OR REPLACE INTO showdowns VALUES (?,?,?)",(hand_id,player_id,json.dumps(cards)))
        if commit:
            self.db.commit()

    def has_hand(self, hand_id):
        return self.db.execute("SELECT 1 FROM hands WHERE hand_id=?", (hand_id,)).fetchone() is not None

    def last_hand_number(self, game_id):
        row = self.db.execute("SELECT MAX(hand_number) FROM hands WHERE game_id=?", (game_id,)).fetchone()
        return row[0] or 0

    def add_parsed_hand(self, game_id, hand):
        """Store a history.HandRecord: players, every action, showdowns and winnings."""
        if self.has_hand(hand.hand_id):
            return False
        payload = {"number": hand.number, "board": hand.board, "dealer": hand.dealer_id,
                   "showdowns": hand.showdowns, "winners": hand.winners}
        self.db.execute("INSERT INTO hands(hand_id,started_at,source,raw_json,game_id,hand_number) VALUES (?,?,?,?,?,?)",
                        (hand.hand_id, hand.started_at, "pokernow_log", json.dumps(payload), game_id, hand.number))
        self.db.execute("DELETE FROM actions WHERE hand_id=?", (hand.hand_id,))
        for pid, info in hand.players.items():
            self.upsert_player(pid, info.get("name"), commit=False)
            self.db.execute("INSERT OR REPLACE INTO hand_players VALUES (?,?,?,?,?)",
                            (hand.hand_id, pid, info.get("seat"), info.get("stack"), hand.winners.get(pid, 0)))
        for seq, a in enumerate(hand.actions):
            self.record_action(hand.hand_id, seq, a["player_id"], a["street"], None, a["action"],
                               a["amount"], None, a["facing"], commit=False)
        for pid, cards in hand.showdowns.items():
            self.record_showdown(hand.hand_id, pid, cards, commit=False)
        self.db.commit()
        return True

    def resolve_player(self, key):
        """Accept a player id or a (case-insensitive) display name."""
        if self.db.execute("SELECT 1 FROM players WHERE player_id=?", (key,)).fetchone():
            return key
        row = self.db.execute("SELECT player_id FROM player_names WHERE lower(name)=lower(?) ORDER BY last_seen DESC", (key,)).fetchone()
        return row[0] if row else key

    def list_players(self):
        rows = self.db.execute("SELECT player_id, name, is_account FROM players ORDER BY last_seen DESC").fetchall()
        return [{"player_id": pid, "name": name, "account": bool(acct) if acct is not None else None,
                 **{k: v for k, v in self.player_stats(pid).items() if k in ("observed_hands", "vpip", "pfr", "aggression_factor", "fold_to_bet")}}
                for pid, name, acct in rows]

    def player_stats(self, player_id):
        player_id = self.resolve_player(player_id)
        rows = self.db.execute("SELECT hand_id,street,action,facing FROM actions WHERE player_id=? ORDER BY hand_id,seq",(player_id,)).fetchall()
        hands = {}
        for hand, street, action, facing in rows:
            hands.setdefault(hand, []).append((street.lower(), action.lower(), facing))
        dealt = {r[0] for r in self.db.execute("SELECT hand_id FROM hand_players WHERE player_id=?", (player_id,))}
        n = len(dealt | set(hands))
        vpip = pfr = threebet = threebet_opps = 0
        bets = calls = folds_to_bet = faced_bets = 0
        saw_flop = cbet = cbet_opps = 0
        for hand, actions in hands.items():
            pre = [(a, f) for s, a, f in actions if s == "preflop"]
            vpip += any(a in ("call","bet","raise","3bet","allin") for a, _ in pre)
            pfr += any(a in ("raise","3bet") for a, _ in pre)
            threebet += any(a == "3bet" for a, _ in pre)
            threebet_opps += any(f == "raise" for _, f in pre)
            post = [(s, a, f) for s, a, f in actions if s in POSTFLOP]
            bets += sum(a in ("bet", "raise") for _, a, _ in post)
            calls += sum(a == "call" for _, a, _ in post)
            faced = [a for _, a, f in post if f == "bet"]
            faced_bets += len(faced)
            folds_to_bet += sum(a == "fold" for a in faced)
            flop = [(a, f) for s, a, f in post if s == "flop"]
            saw_flop += bool(flop)
            last_raiser = self.db.execute(
                "SELECT player_id FROM actions WHERE hand_id=? AND street='preflop' AND action IN ('raise','3bet') ORDER BY seq DESC LIMIT 1",
                (hand,)).fetchone()
            if flop and last_raiser and last_raiser[0] == player_id and flop[0][1] == "none":
                cbet_opps += 1
                cbet += flop[0][0] == "bet"
        shows = self.db.execute("SELECT s.hand_id, s.cards_json FROM showdowns s LEFT JOIN hands h ON h.hand_id=s.hand_id "
                                "WHERE s.player_id=? ORDER BY h.hand_number DESC LIMIT 10", (player_id,)).fetchall()
        showdown_count = self.db.execute("SELECT COUNT(*) FROM showdowns WHERE player_id=?", (player_id,)).fetchone()[0]
        won = self.db.execute("SELECT COALESCE(SUM(won),0) FROM hand_players WHERE player_id=?", (player_id,)).fetchone()[0]
        name = self.db.execute("SELECT name FROM players WHERE player_id=?", (player_id,)).fetchone()
        return {"player_id":player_id,"name":name[0] if name else None,"observed_hands":n,
                "vpip":_ratio(vpip, n) if n else None,"pfr":_ratio(pfr, n) if n else None,
                "threebet_per_hand":_ratio(threebet, n) if n else None,
                "threebet_rate":_ratio(threebet, threebet_opps),
                "aggression_factor":_ratio(bets, calls) if calls else (float(bets) if bets else None),
                "fold_to_bet":_ratio(folds_to_bet, faced_bets),
                "cbet":_ratio(cbet, cbet_opps),
                "went_to_showdown":_ratio(showdown_count, saw_flop) if saw_flop else None,
                "chips_collected":won,
                "recent_showdowns":[json.loads(c) for _, c in shows],
                "note":"threebet_per_hand uses all observed hands; threebet_rate uses hands where the player faced a preflop raise."}

    # ---- HUD (Feltline) ----------------------------------------------------
    def _now(self):
        return datetime.now(timezone.utc).isoformat()

    def ensure_settings(self, config):
        row = self.db.execute("SELECT * FROM hud_settings WHERE id=1").fetchone()
        if row:
            return dict(row)
        self.db.execute(
            "INSERT INTO hud_settings(id,user_id,nickname,buy_in,small_blind,big_blind,strategy,default_mode,"
            "display_name,pokernow_id,bio,updated_at) VALUES (1,'local',?,?,?,?,?,?,?,?,?,?)",
            (config.get("bot_nickname", "pokerbot"), config.get("buy_in", 1000),
             config.get("small_blind", 10), config.get("big_blind", 20),
             config.get("strategy", "theory"), "suggest",
             config.get("bot_nickname", "pokerbot"), config.get("hero_player_id") or "",
             "", self._now()))
        self.db.commit()
        return dict(self.db.execute("SELECT * FROM hud_settings WHERE id=1").fetchone())

    def settings_row(self):
        row = self.db.execute("SELECT * FROM hud_settings WHERE id=1").fetchone()
        return dict(row) if row else None

    def update_settings(self, patch: dict):
        allowed = {"nickname", "buy_in", "small_blind", "big_blind", "strategy", "default_mode",
                   "autoplay_confirmed_at", "extension_connected", "display_name", "pokernow_id", "bio"}
        fields, values = [], []
        for key, value in patch.items():
            if key not in allowed:
                continue
            if key == "extension_connected":
                value = 1 if value else 0
            fields.append(f"{key}=?")
            values.append(value)
        if not fields:
            return self.settings_row()
        fields.append("updated_at=?")
        values.append(self._now())
        self.db.execute(f"UPDATE hud_settings SET {', '.join(fields)} WHERE id=1", values)
        self.db.commit()
        return self.settings_row()

    def list_tables(self):
        return [dict(r) for r in self.db.execute("SELECT * FROM hud_tables ORDER BY created_at DESC")]

    def get_table(self, table_id):
        row = self.db.execute("SELECT * FROM hud_tables WHERE id=?", (table_id,)).fetchone()
        return dict(row) if row else None

    def table_by_game(self, game_id):
        row = self.db.execute("SELECT * FROM hud_tables WHERE game_id=?", (game_id,)).fetchone()
        return dict(row) if row else None

    def add_table(self, pokernow_url, game_id, nickname=None, is_demo=False, status="watching"):
        existing = self.table_by_game(game_id)
        if existing:
            return existing
        now = self._now()
        table_id = "demo-table" if is_demo else game_id
        self.db.execute(
            "INSERT INTO hud_tables(id,pokernow_url,game_id,nickname,is_demo,status,last_seen_at,created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (table_id, pokernow_url, game_id, nickname or game_id, int(is_demo), status, now, now))
        self.db.execute("UPDATE hands SET table_id=? WHERE game_id=? AND (table_id IS NULL OR table_id='')",
                        (table_id, game_id))
        self.db.commit()
        return self.get_table(table_id)

    def update_table(self, table_id, **patch):
        allowed = {"status", "nickname", "last_seen_at", "pokernow_url"}
        fields, values = [], []
        for key, value in patch.items():
            if key in allowed:
                fields.append(f"{key}=?")
                values.append(value)
        if not fields:
            return self.get_table(table_id)
        if "last_seen_at" not in patch:
            fields.append("last_seen_at=?")
            values.append(self._now())
        values.append(table_id)
        self.db.execute(f"UPDATE hud_tables SET {', '.join(fields)} WHERE id=?", values)
        self.db.commit()
        return self.get_table(table_id)

    def delete_tables(self):
        self.db.execute("DELETE FROM hud_suggestions")
        self.db.execute("DELETE FROM hud_tables")
        self.db.commit()

    def list_opponents(self, hero_id=None):
        notes = {r["player_id"]: r["notes"] for r in self.db.execute("SELECT * FROM opponent_notes")}
        rows = self.db.execute("SELECT player_id, name, is_account, first_seen, last_seen FROM players ORDER BY last_seen DESC").fetchall()
        out = []
        for r in rows:
            if r["player_id"] == "hero" or (hero_id and r["player_id"] == hero_id):
                continue
            out.append({
                "id": r["player_id"],
                "player_id": r["player_id"],
                "display_name": r["name"] or r["player_id"],
                "is_account": bool(r["is_account"]),
                "first_seen": r["first_seen"],
                "last_seen": r["last_seen"],
                "notes": notes.get(r["player_id"], ""),
                "user_id": "local",
            })
        return out

    def set_opponent_notes(self, player_id, notes):
        self.db.execute("INSERT INTO opponent_notes(player_id,notes) VALUES (?,?) ON CONFLICT(player_id) DO UPDATE SET notes=excluded.notes",
                        (player_id, notes))
        self.db.commit()

    def _hand_payload(self, row, hero_id=None):
        raw = json.loads(row["raw_json"] or "{}")
        board = raw.get("board") or []
        if isinstance(board, dict):
            board = list(board.values())
        table_id = row["table_id"] if "table_id" in row.keys() else None
        if not table_id:
            table = self.table_by_game(row["game_id"]) if row["game_id"] else None
            table_id = table["id"] if table else row["game_id"]
        winners = raw.get("winners") or {}
        hero_net = None
        if hero_id and hero_id in winners:
            hero_net = winners.get(hero_id)
        raw_out = {
            "hero_cards": raw.get("hero_cards") or [],
            "pot": raw.get("pot"),
            "live": raw.get("live", False),
            "street": raw.get("street"),
            "hero_stack": raw.get("hero_stack"),
            "hero_net": raw.get("hero_net", hero_net),
            **{k: v for k, v in raw.items() if k not in ("showdowns",)},
        }
        return {
            "id": row["hand_id"],
            "table_id": table_id,
            "hand_number": row["hand_number"] or 0,
            "board": board,
            "started_at": row["started_at"],
            "raw": raw_out,
            "user_id": "local",
        }

    def list_hands(self, hero_id=None):
        rows = self.db.execute("SELECT * FROM hands ORDER BY COALESCE(hand_number,0) DESC, started_at DESC").fetchall()
        return [self._hand_payload(r, hero_id) for r in rows]

    def get_hand(self, hand_id, hero_id=None):
        row = self.db.execute("SELECT * FROM hands WHERE hand_id=?", (hand_id,)).fetchone()
        return self._hand_payload(row, hero_id) if row else None

    def upsert_hand_raw(self, hand_id, table_id, game_id, hand_number, board, raw, source="hud"):
        payload = {**raw, "board": board, "number": hand_number}
        now = self._now()
        self.db.execute(
            "INSERT INTO hands(hand_id,started_at,source,raw_json,game_id,hand_number,table_id) VALUES (?,?,?,?,?,?,?) "
            "ON CONFLICT(hand_id) DO UPDATE SET raw_json=excluded.raw_json, hand_number=excluded.hand_number, "
            "table_id=excluded.table_id, game_id=excluded.game_id",
            (hand_id, now, source, json.dumps(payload), game_id, hand_number, table_id))
        self.db.commit()
        return self.get_hand(hand_id)

    def list_actions(self, hand_id=None, hero_id=None, limit=5000):
        if hand_id:
            rows = self.db.execute("SELECT rowid, * FROM actions WHERE hand_id=? ORDER BY seq", (hand_id,)).fetchall()
        else:
            rows = self.db.execute("SELECT rowid, * FROM actions ORDER BY hand_id, seq LIMIT ?", (limit,)).fetchall()
        out = []
        for r in rows:
            actor = "hero" if hero_id and r["player_id"] == hero_id else r["player_id"]
            out.append({
                "id": str(r["rowid"]),
                "hand_id": r["hand_id"],
                "seq": r["seq"],
                "actor": actor,
                "street": r["street"],
                "action": r["action"],
                "amount": r["amount"],
                "facing": r["facing"] or "none",
                "user_id": "local",
            })
        return out

    def list_hand_players(self, hand_id=None, hero_id=None):
        if hand_id:
            rows = self.db.execute("SELECT rowid, * FROM hand_players WHERE hand_id=?", (hand_id,)).fetchall()
        else:
            rows = self.db.execute("SELECT rowid, * FROM hand_players").fetchall()
        out = []
        for r in rows:
            if hero_id and r["player_id"] == hero_id:
                continue
            out.append({
                "id": str(r["rowid"]),
                "hand_id": r["hand_id"],
                "opponent_id": r["player_id"],
                "seat": r["seat"] or 0,
                "stack": r["stack"] or 0,
                "won": r["won"] or 0,
                "user_id": "local",
            })
        return out

    def list_showdowns(self, hand_id=None, opponent_id=None):
        q, args = "SELECT s.rowid, s.hand_id, s.player_id, s.cards_json, h.hand_number, h.raw_json FROM showdowns s LEFT JOIN hands h ON h.hand_id=s.hand_id", []
        where = []
        if hand_id:
            where.append("s.hand_id=?")
            args.append(hand_id)
        if opponent_id:
            where.append("s.player_id=?")
            args.append(opponent_id)
        if where:
            q += " WHERE " + " AND ".join(where)
        q += " ORDER BY h.hand_number DESC"
        out = []
        for r in self.db.execute(q, args).fetchall():
            raw = json.loads(r["raw_json"] or "{}")
            out.append({
                "id": str(r["rowid"]),
                "hand_id": r["hand_id"],
                "opponent_id": r["player_id"],
                "cards": json.loads(r["cards_json"]),
                "hands": {"hand_number": r["hand_number"], "board": raw.get("board") or []},
                "user_id": "local",
            })
        return out

    def book(self, hero_id=None):
        return {
            "hp": self.list_hand_players(hero_id=hero_id),
            "actions": self.list_actions(hero_id=hero_id),
            "sd": [{"hand_id": s["hand_id"], "opponent_id": s["opponent_id"], "cards": s["cards"]} for s in self.list_showdowns()],
        }

    def add_suggestion(self, table_id, hand_id, street, action, size, reason, confidence):
        sug_id = str(uuid.uuid4())
        now = self._now()
        self.db.execute(
            "INSERT INTO hud_suggestions(id,table_id,hand_id,street,suggested_action,size,reason,confidence,accepted,created_at) "
            "VALUES (?,?,?,?,?,?,?,?, 'pending', ?)",
            (sug_id, table_id, hand_id, street, action, size, reason, confidence, now))
        self.db.commit()
        return self.get_suggestion(sug_id)

    def get_suggestion(self, sug_id):
        row = self.db.execute("SELECT * FROM hud_suggestions WHERE id=?", (sug_id,)).fetchone()
        return dict(row) if row else None

    def list_suggestions(self, hand_id=None, table_id=None):
        q, args = "SELECT * FROM hud_suggestions", []
        where = []
        if hand_id:
            where.append("hand_id=?")
            args.append(hand_id)
        if table_id:
            where.append("table_id=?")
            args.append(table_id)
        if where:
            q += " WHERE " + " AND ".join(where)
        q += " ORDER BY created_at DESC"
        return [dict(r) for r in self.db.execute(q, args)]

    def resolve_suggestion(self, sug_id, accepted, actual_action=None, actual_size=None):
        self.db.execute(
            "UPDATE hud_suggestions SET accepted=?, actual_action=?, actual_size=? WHERE id=?",
            (accepted, actual_action, actual_size, sug_id))
        self.db.commit()
        return self.get_suggestion(sug_id)

    def pending_suggestion(self, table_id=None, hand_id=None):
        q, args = "SELECT * FROM hud_suggestions WHERE accepted='pending'", []
        if table_id:
            q += " AND table_id=?"
            args.append(table_id)
        if hand_id:
            q += " AND hand_id=?"
            args.append(hand_id)
        q += " ORDER BY created_at DESC LIMIT 1"
        row = self.db.execute(q, args).fetchone()
        return dict(row) if row else None

    def export_all(self, hero_id=None):
        return {
            "profiles": [self.profile_row()],
            "settings": [self.hud_settings_public()],
            "tables": [self.table_public(t) for t in self.list_tables()],
            "opponents": self.list_opponents(hero_id),
            "hands": self.list_hands(hero_id),
            "hand_players": self.list_hand_players(hero_id=hero_id),
            "actions": self.list_actions(hero_id=hero_id),
            "showdowns": self.list_showdowns(),
            "suggestions": self.list_suggestions(),
        }

    def profile_row(self):
        s = self.settings_row() or {}
        return {
            "id": "local",
            "display_name": s.get("display_name") or s.get("nickname"),
            "pokernow_id": s.get("pokernow_id") or None,
            "bio": s.get("bio") or "",
            "created_at": s.get("updated_at") or self._now(),
        }

    def hud_settings_public(self):
        s = self.settings_row()
        if not s:
            return None
        return {
            "user_id": s.get("user_id") or "local",
            "nickname": s.get("nickname") or "pokerbot",
            "buy_in": s.get("buy_in") or 0,
            "small_blind": s.get("small_blind") or 0,
            "big_blind": s.get("big_blind") or 0,
            "strategy": s.get("strategy") or "theory",
            "default_mode": s.get("default_mode") or "suggest",
            "autoplay_confirmed_at": s.get("autoplay_confirmed_at"),
            "extension_connected": bool(s.get("extension_connected")),
            "updated_at": s.get("updated_at") or self._now(),
        }

    def table_public(self, row):
        return {
            "id": row["id"],
            "user_id": "local",
            "pokernow_url": row["pokernow_url"],
            "game_id": row["game_id"],
            "nickname": row["nickname"],
            "is_demo": bool(row["is_demo"]),
            "status": row["status"],
            "last_seen_at": row["last_seen_at"],
            "created_at": row["created_at"],
        }
