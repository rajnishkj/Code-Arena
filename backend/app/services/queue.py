"""The matchmaking queue's Redis key, shared by pairing and match completion.

A sorted set of user ids scored by enqueue time in epoch milliseconds, so
ascending score order is longest-waiting first.
"""

from app.redis_client import redis_client

QUEUE = "matchmaking_queue"


def remove_from_queue(*user_ids: int) -> None:
    redis_client.zrem(QUEUE, *(str(user_id) for user_id in user_ids))
