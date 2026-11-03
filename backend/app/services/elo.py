"""Rating changes for a decided match, ported from MatchService.completeMatch."""

import math

K = 32


def expected_score(rating: int, opponent: int) -> float:
    return 1 / (1 + 10 ** ((opponent - rating) / 400))


def _java_round(x: float) -> int:
    """`Math.round` rounds halves up; Python's `round` rounds them to even."""
    return math.floor(x + 0.5)


def rating_changes(p1_elo: int, p2_elo: int, p1_won: bool) -> tuple[int, int]:
    """The (p1, p2) deltas. Each is rounded on its own, as Java did, so the two
    need not sum to zero.
    """
    expected_p1 = expected_score(p1_elo, p2_elo)
    actual_p1 = 1.0 if p1_won else 0.0
    return (
        _java_round(K * (actual_p1 - expected_p1)),
        _java_round(K * ((1 - actual_p1) - (1 - expected_p1))),
    )
