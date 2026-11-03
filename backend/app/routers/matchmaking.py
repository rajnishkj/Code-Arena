"""Join, poll and leave the matchmaking queue.

`/join` and `/leave` answer in plain text, as Spring did for a bare String
body. The frontend ignores both bodies, but the shape is kept whole.
"""

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.security import get_current_user_id
from app.services.matches import find_active_match
from app.services.matchmaking import join_and_match
from app.services.queue import remove_from_queue
from app.ws import match_payload

router = APIRouter(prefix="/api/matchmaking", tags=["matchmaking"])


@router.post("/join", response_class=PlainTextResponse)
def join(
    user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)
) -> str:
    join_and_match(db, user_id)
    return "Searching"


@router.get("/status")
def status(
    user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)
) -> dict[str, Any]:
    """The active match, keyed as Jackson serialised the entity, or the
    not-matched marker. `Lobby.jsx` polls this and navigates once `id` appears.
    """
    match = find_active_match(db, user_id)
    return match_payload(match) if match is not None else {"matched": False}


@router.post("/leave", response_class=PlainTextResponse)
def leave(user_id: int = Depends(get_current_user_id)) -> str:
    remove_from_queue(user_id)
    return "Removed from queue"
