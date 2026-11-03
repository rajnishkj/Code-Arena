"""Create, end and watch a match. Parameters are query strings, as the Java
controller's `@RequestParam`s were.

Every route takes a token, and none checks that the caller plays in the match:
any user can complete, forfeit or beat for any match. That is Java's behaviour,
ported as it stands.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Match, User
from app.schemas import MatchDetailsResponse
from app.security import get_current_user_id
from app.services import heartbeat
from app.services.matches import complete_match, create_match, forfeit_match
from app.ws import match_payload

router = APIRouter(prefix="/api/matches", tags=["matches"])


def _found(match: Match | None) -> dict[str, Any]:
    # Java threw "Match not found" into its 500 handler; 404 is the honest code.
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return match_payload(match)


@router.post("/create")
def create(
    p1: int,
    p2: int,
    problem_id: int = Query(alias="problemId"),
    _user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return match_payload(create_match(db, p1, p2, problem_id))


@router.post("/complete")
def complete(
    match_id: int = Query(alias="matchId"),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """The caller wins. A second call returns the finished match as it stands,
    so a player who lost the race gets a 200 naming the opponent as winner.
    """
    return _found(complete_match(db, match_id, user_id))


@router.post("/forfeit")
def forfeit(
    match_id: int = Query(alias="matchId"),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return _found(forfeit_match(db, match_id, user_id))


@router.post("/heartbeat")
def beat(
    match_id: int = Query(alias="matchId"),
    user_id: int = Depends(get_current_user_id),
) -> dict[str, bool]:
    heartbeat.beat(match_id, user_id)
    return {"ok": True}


@router.get("/heartbeat/status")
def heartbeat_status(
    match_id: int = Query(alias="matchId"),
    opponent_id: int = Query(alias="opponentId"),
    _user_id: int = Depends(get_current_user_id),
) -> dict[str, bool]:
    return {"opponentAlive": heartbeat.is_alive(match_id, opponent_id)}


@router.get("/{match_id}", response_model=MatchDetailsResponse)
def details(
    match_id: int,
    _user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> MatchDetailsResponse:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return MatchDetailsResponse(
        match_id=match.id,
        p1_id=match.p1,
        p2_id=match.p2,
        p1_username=_username(db, match.p1),
        p2_username=_username(db, match.p2),
        problem_id=match.problem_id,
    )


def _username(db: Session, user_id: int) -> str | None:
    # Java's getUserById threw for a missing player, 500ing the whole lookup.
    user = db.get(User, user_id)
    return user.username if user is not None else None
