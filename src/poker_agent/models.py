from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

class Action(str, Enum):
    FOLD="fold"
    CHECK="check"
    CALL="call"
    BET="bet"
    RAISE="raise"

@dataclass(frozen=True)
class Decision:
    action: Action
    amount: Optional[float] = None
    reason: str = ""

@dataclass
class Player:
    player_id: str
    seat: int
    stack: float
    position: str = ""

@dataclass
class GameState:
    hand_id: str
    hero_id: str
    hero_stack: float
    hero_cards: tuple[str, ...] = ()
    board: tuple[str, ...] = ()
    pot: float = 0
    amount_to_call: float = 0
    min_raise_to: Optional[float] = None
    big_blind: float = 2
    hero_position: str = ""
    hero_turn: bool = False
    players: list[Player] = field(default_factory=list)
    parse_confidence: float = 0.0
    hero_bet: float = 0

    def validate(self):
        if self.hero_stack < 0 or self.pot < 0 or self.amount_to_call < 0 or self.big_blind <= 0:
            raise ValueError("Invalid chip quantities")
        if len(self.players) > 10:
            raise ValueError("More than ten players")
        if len(self.hero_cards) not in (0, 2) or len(self.board) not in (0, 3, 4, 5):
            raise ValueError("Invalid card count")
        cards = self.hero_cards + self.board
        if len(set(cards)) != len(cards):
            raise ValueError("Duplicate cards")
        if not 0 <= self.parse_confidence <= 1:
            raise ValueError("Invalid confidence")
