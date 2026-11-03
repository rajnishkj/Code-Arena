"""Match persistence. Ticket 10 adds completion, forfeit and the stale purge."""

from sqlalchemy.orm import Session

from app.models import Match


def create_match(db: Session, p1: int, p2: int, problem_id: int) -> Match:
    match = Match(p1=p1, p2=p2, problem_id=problem_id)
    db.add(match)
    db.commit()
    db.refresh(match)
    return match


def find_active_match(db: Session, user_id: int) -> Match | None:
    """MatchRepository.findActiveMatchByUser: the user's newest unfinished match."""
    return (
        db.query(Match)
        .filter((Match.p1 == user_id) | (Match.p2 == user_id), Match.winner.is_(None))
        .order_by(Match.id.desc())
        .first()
    )
