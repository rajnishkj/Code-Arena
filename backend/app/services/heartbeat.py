"""Per-match player liveness, ported from HeartbeatTracker.java.

The state lives in this process. Run a single uvicorn worker: a second worker
would not see the beats the first one took, and would call live players dead.
"""

import threading
import time

STALE_MS = 6_000

_last_beat: dict[tuple[int, int], float] = {}
_lock = threading.Lock()


def _now_ms() -> float:
    return time.monotonic() * 1000


def beat(match_id: int, user_id: int) -> None:
    with _lock:
        _last_beat[(match_id, user_id)] = _now_ms()


def is_alive(match_id: int, user_id: int, within_ms: float = STALE_MS) -> bool:
    """False for a player who has never beaten in this match."""
    with _lock:
        last = _last_beat.get((match_id, user_id))
    return last is not None and _now_ms() - last < within_ms


def forget_older_than(ms: float) -> None:
    """Java never evicted, so its map grew by two entries per match for the life
    of the process. Dropping an entry only turns a long-silent player into a
    never-seen one, which every caller already treats as dead.
    """
    cutoff = _now_ms() - ms
    with _lock:
        for key in [key for key, last in _last_beat.items() if last < cutoff]:
            del _last_beat[key]
