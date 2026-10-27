import json
from pathlib import Path
from .database import PlayerStore

def import_replay_json(path: str, store: PlayerStore) -> int:
    """Import normalized replay exports. Not a claim that PokerNow offers JSON exports."""
    data=json.loads(Path(path).read_text())
    count=0
    for hand in data.get("hands",[]):
        hand_id=str(hand["hand_id"])
        store.add_hand(hand_id,hand,source="replay")
        for seq,action in enumerate(hand.get("actions",[])):
            store.record_action(hand_id,seq,str(action["player_id"]),action["street"],action.get("position"),action["action"],action.get("amount"),action.get("pot_before"))
        for showdown in hand.get("showdowns",[]):
            store.record_showdown(hand_id,str(showdown["player_id"]),showdown["cards"])
        count+=1
    return count
