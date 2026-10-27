from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

@dataclass
class SessionManager:
    buy_in: float
    minutes_after_time: float
    time_called_at: datetime | None = None
    exit_deadline: datetime | None = None
    exit_requested: bool = False

    def update(self, stack: float, now: datetime | None = None) -> str | None:
        now = now or datetime.now(timezone.utc)
        if self.time_called_at is None and stack >= self.buy_in * 1.5:
            self.time_called_at = now
            self.exit_deadline = now + timedelta(minutes=self.minutes_after_time)
            return "send_time"
        if self.exit_deadline is not None and now >= self.exit_deadline and not self.exit_requested:
            self.exit_requested = True
            return "exit_when_safe"
        return None
