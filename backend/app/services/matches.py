"""Match persistence and its end states, ported from MatchService.java."""

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Match, SolvedProblem, User
from app.services import heartbeat
from app.services.elo import rating_changes
from app.services.queue import remove_from_queue
from app.ws import push_match_result

logger = logging.getLogger("arena")

# `matches.winner` for a match nobody won: abandoned by both players.
ABANDONED = -1
# Both players silent this long and the purge abandons the match.
SILENCE_MS = 30_000
# MatchRepository.findUnfinishedMatches capped each sweep at the 50 oldest.
PURGE_BATCH = 50


def create_match(db: Session, p1: int, p2: int, problem_id: int) -> Match:
    match = Match(p1=p1, p2=p2, problem_id=problem_id)
    db.add(match)
    db.commit()
    db.refresh(match)
    # Being matched counts as a beat. Java started both players at "never seen",
    # so a sweep landing before their first heartbeat abandoned a match seconds
    # old, and a status poll in that gap reported the opponent dead.
    heartbeat.beat(match.id, p1)
    heartbeat.beat(match.id, p2)
    return match


def find_active_match(db: Session, user_id: int) -> Match | None:
    """MatchRepository.findActiveMatchByUser: the user's newest unfinished match."""
    return (
        db.query(Match)
        .filter((Match.p1 == user_id) | (Match.p2 == user_id), Match.winner.is_(None))
        .order_by(Match.id.desc())
        .first()
    )


def complete_match(db: Session, match_id: int, winner: int | None) -> Match:
    """End a match.

    With a winner, both ratings move, both players get a `solved_problems` row,
    and both are pushed the result. With `winner=None` the match is abandoned:
    no rating change and no push, as in Java.

    Idempotent. A match that already has a winner comes back untouched. The row
    lock makes that check hold under concurrency, where Java's read-then-write
    let two simultaneous completions both apply Elo.
    """
    match = db.execute(
        select(Match)
        .where(Match.id == match_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()
    if match.winner is not None:
        db.commit()
        return match

    if winner is None:
        match.winner = ABANDONED
        match.p1_elo_change = 0
        match.p2_elo_change = 0
    else:
        players = {
            user.id: user
            for user in db.query(User)
            .filter(User.id.in_((match.p1, match.p2)))
            .order_by(User.id)
            .with_for_update()
        }
        p1, p2 = players[match.p1], players[match.p2]
        p1_change, p2_change = rating_changes(p1.elo, p2.elo, p1_won=winner == match.p1)

        match.winner = winner
        match.p1_elo_change = p1_change
        match.p2_elo_change = p2_change
        p1.elo += p1_change
        p2.elo += p2_change

        # Both players, winner and loser: the daily leaderboard counts these.
        solved_at = datetime.now()
        db.add_all(
            SolvedProblem(user_id=user_id, problem_id=match.problem_id, solved_at=solved_at)
            for user_id in (match.p1, match.p2)
        )

    db.commit()
    remove_from_queue(match.p1, match.p2)
    if winner is not None:
        push_match_result(match.p1, match)
        push_match_result(match.p2, match)
    return match


def forfeit_match(db: Session, match: Match, user_id: int) -> Match:
    """The opponent of `user_id`, who must be one of the two players, wins."""
    opponent = match.p2 if match.p1 == user_id else match.p1
    return complete_match(db, match.id, opponent)


def purge_stale_matches(db: Session) -> None:
    """Abandon unfinished matches whose players have both gone silent."""
    # Evicted first so a sweep that fails partway still bounds the map.
    heartbeat.forget_older_than(SILENCE_MS)
    unfinished = (
        db.query(Match.id, Match.p1, Match.p2)
        .filter(Match.winner.is_(None))
        .order_by(Match.id)
        .limit(PURGE_BATCH)
        .all()
    )
    for match_id, p1, p2 in unfinished:
        if any(heartbeat.is_alive(match_id, p, SILENCE_MS) for p in (p1, p2)):
            continue
        logger.info("Purging stale match %s", match_id)
        complete_match(db, match_id, None)
