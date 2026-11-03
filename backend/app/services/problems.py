from sqlalchemy.orm import Session

from app.models import Problem

# ProblemService.getProblemsByEloRange: abs(rating - elo) <= 200.
ELO_BAND = 200


def problems_for_elo(db: Session, elo: int) -> list[Problem]:
    """Filtered in SQL rather than Java's `findAll().stream().filter(...)`; the
    band is the same and matchmaking calls this on every match it makes.
    """
    return (
        db.query(Problem)
        .filter(Problem.rating.between(elo - ELO_BAND, elo + ELO_BAND))
        .all()
    )
