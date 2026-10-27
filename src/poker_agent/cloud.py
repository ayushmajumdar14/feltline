"""Push live HUD snapshots to a Feltline Supabase workspace (the public Vercel site)."""
from __future__ import annotations

import os
import uuid
from typing import Any

import aiohttp


def _cfg(config: dict) -> dict:
    cloud = dict(config.get("cloud") or {})
    return {
        "url": (cloud.get("url") or os.environ.get("FELTLINE_CLOUD_URL") or os.environ.get("VITE_SUPABASE_URL") or "").rstrip("/"),
        "key": cloud.get("publishable_key") or os.environ.get("FELTLINE_CLOUD_KEY") or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY") or "",
        "email": cloud.get("email") or os.environ.get("FELTLINE_CLOUD_EMAIL") or "",
        "password": cloud.get("password") or os.environ.get("FELTLINE_CLOUD_PASSWORD") or "",
    }


class CloudHud:
    def __init__(self, config: dict):
        self.config = config
        self.settings = _cfg(config)
        self.access_token = ""
        self.user_id = ""
        self._session: aiohttp.ClientSession | None = None
        self._opp: dict[str, str] = {}
        self._hands: dict[str, str] = {}

    @property
    def enabled(self) -> bool:
        s = self.settings
        return bool(s["url"] and s["key"] and s["email"] and s["password"])

    async def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    def _headers(self, extra: dict | None = None) -> dict:
        h = {
            "apikey": self.settings["key"],
            "Authorization": f"Bearer {self.access_token or self.settings['key']}",
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def login(self):
        if not self.enabled:
            raise RuntimeError(
                "Cloud companion needs cloud.url, cloud.publishable_key, cloud.email and cloud.password "
                "(or FELTLINE_CLOUD_* env vars). Use the same email you signed up with on feltline-ten.vercel.app."
            )
        http = await self._http()
        url = f"{self.settings['url']}/auth/v1/token?grant_type=password"
        async with http.post(
            url,
            headers={"apikey": self.settings["key"], "Content-Type": "application/json"},
            json={"email": self.settings["email"], "password": self.settings["password"]},
        ) as resp:
            body = await resp.json()
            if resp.status >= 400:
                raise RuntimeError(body.get("error_description") or body.get("msg") or body.get("error") or str(body))
        self.access_token = body["access_token"]
        self.user_id = (body.get("user") or {}).get("id") or ""
        if not self.user_id:
            raise RuntimeError("Supabase login succeeded but no user id came back")
        print(f"Cloud companion signed in as {self.settings['email']}")

    async def _req(self, method: str, path: str, *, json: Any = None, params: str = "", extra_headers: dict | None = None):
        http = await self._http()
        url = f"{self.settings['url']}/rest/v1/{path}{params}"
        async with http.request(method, url, headers=self._headers(extra_headers), json=json) as resp:
            text = await resp.text()
            if resp.status == 401:
                await self.login()
                async with http.request(method, url, headers=self._headers(extra_headers), json=json) as retry:
                    text = await retry.text()
                    if retry.status >= 400:
                        raise RuntimeError(f"{method} {path}: {retry.status} {text[:400]}")
                    if not text:
                        return None
                    return await retry.json(content_type=None) if text.startswith("[") or text.startswith("{") else text
            if resp.status >= 400:
                raise RuntimeError(f"{method} {path}: {resp.status} {text[:400]}")
            if not text:
                return None
            if text.startswith("[") or text.startswith("{"):
                import json as _json
                return _json.loads(text)
            return text

    async def list_tables(self) -> list[dict]:
        rows = await self._req("GET", "tables", params="?select=*&order=created_at.desc")
        return rows or []

    async def set_connected(self, connected: bool):
        await self._req(
            "PATCH",
            "settings",
            params="?user_id=eq." + self.user_id,
            json={"extension_connected": connected},
        )

    async def touch_table(self, table_id: str, status: str | None = None):
        patch: dict[str, Any] = {"last_seen_at": _now()}
        if status:
            patch["status"] = status
        await self._req("PATCH", "tables", params=f"?id=eq.{table_id}", json=patch)

    def _hid(self, local_id: str) -> str:
        if local_id in self._hands:
            return self._hands[local_id]
        try:
            uuid.UUID(str(local_id))
            hid = str(local_id)
        except ValueError:
            hid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"feltline:{self.user_id}:{local_id}"))
        self._hands[local_id] = hid
        return hid

    async def _opponent(self, player_id: str, name: str) -> str:
        if player_id in self._opp:
            return self._opp[player_id]
        rows = await self._req(
            "POST",
            "opponents",
            params="?on_conflict=user_id,player_id&select=id,player_id",
            extra_headers={"Prefer": "resolution=merge-duplicates,return=representation"},
            json={
                "user_id": self.user_id,
                "player_id": player_id,
                "display_name": name or player_id,
                "is_account": not str(player_id).startswith("guest"),
                "last_seen": _now(),
            },
        )
        row = rows[0] if isinstance(rows, list) and rows else rows
        oid = row["id"]
        self._opp[player_id] = oid
        return oid

    async def push_snapshot(self, table_id: str, snap: dict, hero_id: str | None):
        if not snap or not snap.get("hand"):
            return
        hand = snap["hand"]
        local_id = hand["id"]
        hid = self._hid(local_id)
        raw = dict(hand.get("raw") or {})
        await self._req(
            "POST",
            "hands",
            params="?on_conflict=id&select=id",
            extra_headers={"Prefer": "resolution=merge-duplicates,return=representation"},
            json={
                "id": hid,
                "user_id": self.user_id,
                "table_id": table_id,
                "hand_number": hand.get("hand_number") or 0,
                "board": hand.get("board") or [],
                "raw": raw,
            },
        )
        names = {}
        for seat in (snap.get("state") or {}).get("seats") or []:
            names[seat.get("player_id")] = seat.get("name") or seat.get("player_id")
        opp_ids = {}
        players = []
        for p in snap.get("players") or []:
            pid = p.get("opponent_id") or p.get("player_id")
            if not pid or pid == hero_id:
                continue
            oid = await self._opponent(pid, names.get(pid) or pid)
            opp_ids[pid] = oid
            players.append({
                "user_id": self.user_id,
                "hand_id": hid,
                "opponent_id": oid,
                "seat": int(p.get("seat") or 0),
                "stack": float(p.get("stack") or 0),
                "won": float(p.get("won") or 0),
            })
        await self._req("DELETE", "hand_players", params=f"?hand_id=eq.{hid}")
        if players:
            await self._req("POST", "hand_players", json=players)
        allowed_act = {"fold", "check", "call", "bet", "raise"}
        allowed_st = {"preflop", "flop", "turn", "river"}
        allowed_face = {"blind", "raise", "bet", "none"}
        acts = []
        for a in snap.get("actions") or []:
            act = a.get("action") or "check"
            if act not in allowed_act:
                continue
            street = a.get("street") if a.get("street") in allowed_st else "preflop"
            facing = a.get("facing") if a.get("facing") in allowed_face else "none"
            actor = a.get("actor")
            if actor and actor != "hero":
                actor = opp_ids.get(actor) or await self._opponent(actor, names.get(actor) or actor)
                opp_ids[a.get("actor")] = actor
            acts.append({
                "user_id": self.user_id,
                "hand_id": hid,
                "seq": int(a.get("seq") or 0),
                "actor": actor or "hero",
                "street": street,
                "action": act,
                "amount": a.get("amount"),
                "facing": facing,
            })
        await self._req("DELETE", "actions", params=f"?hand_id=eq.{hid}")
        if acts:
            await self._req("POST", "actions", json=acts)
        await self.touch_table(table_id)

    async def push_suggestion(self, table_id: str, local_hand_id: str, street: str, action: str,
                              size, reason: str, confidence: int) -> dict:
        hid = self._hid(local_hand_id)
        rows = await self._req(
            "POST",
            "suggestions",
            params="?select=*",
            extra_headers={"Prefer": "return=representation"},
            json={
                "user_id": self.user_id,
                "table_id": table_id,
                "hand_id": hid,
                "street": street,
                "suggested_action": action,
                "size": size,
                "reason": reason,
                "confidence": confidence,
                "accepted": "pending",
            },
        )
        row = rows[0] if isinstance(rows, list) else rows
        return row

    async def get_suggestion(self, sug_id: str) -> dict | None:
        rows = await self._req("GET", "suggestions", params=f"?id=eq.{sug_id}&select=*")
        if not rows:
            return None
        return rows[0]


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
