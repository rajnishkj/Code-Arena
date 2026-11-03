"""Pairing players off the matchmaking queue, ported from MatchmakingService.java.

An entry's wait time is `now - score`; see `services/queue.py` for the set itself.
"""

import logging
import random
import time

from sqlalchemy.orm import Session

from app.models import User
from app.redis_client import redis_client
from app.services.matches import create_match, find_active_match
from app.services.problems import problems_for_elo
from app.services.queue import QUEUE
from app.ws import push_match

logger = logging.getLogger("arena")

TTL_MS = 60_000
BROADEN_WAIT_MS = 15_000
ELO_WINDOW = 100
ELO_WINDOW_BROAD = 300
FALLBACK_PROBLEM_ID = 1


def _now_ms() -> int:
    return int(time.time() * 1000)


def _pick_problem_id(db: Session, elo: int) -> int:
    eligible = problems_for_elo(db, elo)
    return random.choice(eligible).id if eligible else FALLBACK_PROBLEM_ID


def join_and_match(db: Session, user_id: int) -> None:
    """Pair the user with the longest-waiting eligible opponent, or queue them.

    An opponent is eligible when they still exist, have no unfinished match, and
    sit within ELO_WINDOW of the user, widened to ELO_WINDOW_BROAD once they have
    waited past BROADEN_WAIT_MS. The new match puts the opponent in p1.
    """
    now = _now_ms()
    redis_client.zremrangebyscore(QUEUE, 0, now - TTL_MS)

    user = db.get(User, user_id)
    if user is None:
        logger.info("User %s not found, cannot join queue", user_id)
        return

    for member, score in redis_client.zrange(QUEUE, 0, -1, withscores=True):
        opponent_id = int(member)
        if opponent_id == user_id:
            continue

        opponent = db.get(User, opponent_id)
        if opponent is None:
            logger.info("Skipping stale queue entry %s", opponent_id)
            continue
        if find_active_match(db, opponent_id) is not None:
            continue

        window = ELO_WINDOW_BROAD if now - score > BROADEN_WAIT_MS else ELO_WINDOW
        if abs(user.elo - opponent.elo) > window:
            continue

        # Java removed the opponent without checking, so two simultaneous joins
        # could both claim the same waiting player. ZREM reports whether this
        # call is the one that took them; a lost race moves on to the next entry.
        if not redis_client.zrem(QUEUE, member):
            continue

        match = create_match(db, opponent_id, user_id, _pick_problem_id(db, user.elo))
        logger.info(
            "Match %s created: %s (elo %s) vs %s (elo %s)",
            match.id, opponent_id, opponent.elo, user_id, user.elo,
        )
        push_match(opponent_id, match)
        push_match(user_id, match)
        return

    redis_client.zadd(QUEUE, {str(user_id): now})
    logger.info("No opponent within Elo range; %s added to queue", user_id)
