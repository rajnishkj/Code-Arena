"""Registration, login, current user, lookup, leaderboards and profile update.

Tokens issued here are the only credential the rest of the API accepts.

Route order is significant below. `GET /{username}` is a catch-all over a single
path segment, so every literal route - `/me`, `/leaderboard`, `/id/{id}` - has to
be declared before it or FastAPI, which matches in declaration order, hands them
to the username lookup instead.
"""

from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SolvedProblem, User
from app.schemas import (
    DEFAULT_ELO,
    AuthResponse,
    DailyLeaderboardEntry,
    LoginRequest,
    MeResponse,
    PublicUserResponse,
    RegisterRequest,
    UpdateUserRequest,
)
from app.security import create_token, get_current_user_id, hash_password, verify_password

router = APIRouter(prefix="/api/users", tags=["users"])


def _auth_response(user: User) -> AuthResponse:
    return AuthResponse(
        token=create_token(user.id, user.username),
        user_id=user.id,
        username=user.username,
        elo=user.elo,
    )


@router.post("/register", response_model=AuthResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> AuthResponse:
    """Public. `username` has no unique constraint - the Java app never had one,
    so two accounts can share a name and login then resolves to whichever row
    comes back first. Preserved deliberately; it is a real gap, not an omission.
    """
    user = User(
        name=payload.name,
        username=payload.username,
        email=payload.email,
        elo=payload.elo or DEFAULT_ELO,
        encrypted_password=hash_password(payload.password),
        is_guest=payload.is_guest,
        # created_at is left NULL: nothing on the Java registration path ever
        # set it, and nothing reads it.
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _auth_response(user)


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    """Public. One message for both a missing user and a wrong password, so the
    response does not disclose which usernames exist.
    """
    user = db.query(User).filter(User.username == payload.username).first()
    if user is None or not verify_password(payload.password, user.encrypted_password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return _auth_response(user)


@router.get("/me", response_model=MeResponse)
def me(
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> MeResponse:
    user = db.get(User, user_id)
    if user is None:
        # Only reachable with a token for a since-deleted user. Java's
        # getUserById threw, which the global handler turned into a 500; 404 is
        # the honest code and matches the plan's status mapping.
        raise HTTPException(status_code=404, detail="User not found")
    return MeResponse(
        user_id=user.id,
        username=user.username,
        elo=user.elo,
        name=user.name or "",
        email=user.email or "",
    )


@router.get("/leaderboard", response_model=list[PublicUserResponse])
def leaderboard(db: Session = Depends(get_db)) -> list[User]:
    """Public, matching the Java app rather than the migration plan's public list.

    `SecurityConfig` permits `/api/users/{username}`, and Spring's path matcher
    happily binds `leaderboard` to that `{username}` variable, so the route was
    reachable without a token. That is not a detail to tidy up: `App.js` puts
    `/leaderboard` behind no auth guard at all, so a logged-out visitor opening
    the page would start seeing an empty table the moment this required a token.

    Declared before `/{username}` so the literal segment wins the match - FastAPI
    resolves routes in declaration order, where Spring preferred the more
    specific pattern regardless.
    """
    return (
        db.query(User)
        .filter(User.is_guest.is_(False))
        .order_by(User.elo.desc())
        .all()
    )


@router.get("/leaderboard/daily", response_model=list[DailyLeaderboardEntry])
def daily_leaderboard(
    db: Session = Depends(get_db),
    _user_id: int = Depends(get_current_user_id),
) -> list[DailyLeaderboardEntry]:
    """Counts *matches played today*, not wins, and the name is the only thing
    wrong with it: `complete_match` writes a `solved_problems` row for both
    players, so the loser is counted too. Ported as it behaves.

    Local midnight, not UTC - `LocalDate.now()` read the server's zone.

    Two segments, so this one never matched the permitAll `{username}` pattern
    and did require a token.
    """
    start_of_day = datetime.combine(date.today(), time.min)
    rows = (
        db.query(
            SolvedProblem.user_id,
            func.count(SolvedProblem.id).label("solve_count"),
            User.username,
        )
        .join(User, User.id == SolvedProblem.user_id)
        .filter(SolvedProblem.solved_at >= start_of_day)
        .filter(User.is_guest.is_(False))
        .group_by(SolvedProblem.user_id, User.username)
        .order_by(func.count(SolvedProblem.id).desc())
        .all()
    )
    # The join drops rows whose user_id no longer resolves, which is what Java's
    # `findById(userId).ifPresent(...)` did one lookup at a time.
    return [
        DailyLeaderboardEntry(username=username, solve_count=count)
        for _user_id_row, count, username in rows
    ]


@router.get("/id/{user_id}", response_model=PublicUserResponse)
def get_user_by_id(
    user_id: int,
    db: Session = Depends(get_db),
    _caller_id: int = Depends(get_current_user_id),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/{user_id}", response_model=PublicUserResponse)
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    caller_id: int = Depends(get_current_user_id),
) -> User:
    """403 is expensive here: the frontend's response interceptor clears
    localStorage and redirects to /login on *any* 403, so this check firing
    spuriously logs the user out. It compares the authenticated principal
    against the path id and nothing else, exactly as Java's
    `!authedUser.equals(id)` did.
    """
    if caller_id != user_id:
        raise HTTPException(
            status_code=403, detail="Cannot update another user's profile"
        )
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.name is not None:
        user.name = payload.name
    if payload.email is not None:
        user.email = payload.email
    db.commit()
    db.refresh(user)
    return user


@router.get("/{username}", response_model=PublicUserResponse)
def get_user_by_username(username: str, db: Session = Depends(get_db)) -> User:
    """Public, and declared last so the literal routes above are not swallowed.

    The 404 is load-bearing: `Auth.jsx` probes this endpoint before registering
    and reads a 404 as "username free". Anything else on the failure path turns
    every signup into "Could not verify username."
    """
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
