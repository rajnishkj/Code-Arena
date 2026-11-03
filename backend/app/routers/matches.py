"""Create, end and watch a match. Parameters are query strings, as the Java
controller's `@RequestParam`s were.

Every route takes a token. Completing, forfeiting and beating also require the
caller to be one of the two players. Java never checked, so any user could win
any match. A non-player gets the same 404 as a missing match, not a 403, because
the frontend logs the user out on any 403.
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


def _not_found() -> HTTPException:
    # Java threw "Match not found" into its 500 handler; 404 is the honest code.
    return HTTPException(status_code=404, detail="Match not found")


def _played_match(
    match_id: int = Query(alias="matchId"),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> Match:
    match = db.get(Match, match_id)
    if match is None or user_id not in (match.p1, match.p2):
        raise _not_found()
    return match


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
    match: Match = Depends(_played_match),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """The caller wins, unless the match already ended another way: then 409,
    which `Match.jsx` reads as "opponent was faster". Java answered 200 with the
    finished match, and the page showed the late player a win screen. The winner
    repeating the call still gets 200.
    """
    finished = complete_match(db, match.id, user_id)
    if finished.winner != user_id:
        raise HTTPException(status_code=409, detail="Match already finished")
    return match_payload(finished)


@router.post("/forfeit")
def forfeit(
    match: Match = Depends(_played_match),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return match_payload(forfeit_match(db, match, user_id))


@router.post("/heartbeat")
def beat(
    match: Match = Depends(_played_match),
    user_id: int = Depends(get_current_user_id),
) -> dict[str, bool]:
    heartbeat.beat(match.id, user_id)
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
        raise _not_found()
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
