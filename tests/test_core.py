from datetime import datetime, timezone, timedelta
import pytest
from poker_agent.session import SessionManager
from poker_agent.database import PlayerStore
from poker_agent.models import GameState
from poker_agent.strategy import ConservativeFallback

def test_session_threshold_and_deadline():
    s=SessionManager(100,30)
    t=datetime(2026,1,1,tzinfo=timezone.utc)
    assert s.update(149.99,t) is None
    assert s.update(150,t)=="send_time"
    assert s.update(200,t+timedelta(minutes=1)) is None
    assert s.update(100,t+timedelta(minutes=30))=="exit_when_safe"
    assert s.update(100,t+timedelta(minutes=31)) is None

def test_player_stats(tmp_path):
    s=PlayerStore(tmp_path/"test.db")
    s.record_action("h1",0,"alice","preflop","BTN","raise",6)
    s.record_action("h2",0,"alice","preflop","BB","check")
    stats=s.player_stats("alice")
    assert stats["observed_hands"]==2
    assert stats["vpip"]==.5 and stats["pfr"]==.5

def test_fallback_is_not_gto():
    state=GameState("h","hero",100,("As","Kh"),(),hero_turn=True,parse_confidence=1)
    assert ConservativeFallback().decide(state).action.value=="check"
    state.amount_to_call=2
    assert ConservativeFallback().decide(state).action.value=="fold"
    state.parse_confidence=.5
    with pytest.raises(ValueError): ConservativeFallback().decide(state)
