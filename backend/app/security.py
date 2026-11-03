"""Password hashing, JWT issue/verify, and the auth dependencies.

`legacy/src/main/java/com/raj/arena/util/JwtUtil.java` is the only surviving
authority on the token format, since the database was destroyed and no JDK is
installed to mint a legacy token to test against. Read from that file: HS256
over the raw UTF-8 bytes of the shared secret, `sub` carrying the user id as a
*string*, a `username` claim, plus `iat` and a 24h `exp`. The principal is a
bare user id - there is no role claim, and `require_admin` below checks the
`users.is_admin` column instead, exactly as the Java app did.

Hashing uses the `bcrypt` bindings directly rather than the `passlib` wrapper:
passlib 1.7.4 (unmaintained since 2020) probes its bcrypt backend with an
over-length password on import, which bcrypt >= 4.1 rejects outright, so
`CryptContext(schemes=["bcrypt"])` raises before it can hash anything. Nothing is lost - there are no stored hashes to stay compatible
with, and the output is the same `$2b$` format Spring's BCryptPasswordEncoder
verifies.
"""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User

ALGORITHM = "HS256"

# bcrypt only ever consults the first 72 bytes of a password. Java's
# BCryptPasswordEncoder truncates silently; the Python bindings raise instead,
# so truncate here to keep the two behaving identically.
BCRYPT_MAX_BYTES = 72

# auto_error=False so a missing header reaches us and leaves as the {"error":...}
# shape every other failure uses, rather than FastAPI's {"detail":...}.
_bearer = HTTPBearer(auto_error=False)


def _password_bytes(raw: str) -> bytes:
    return raw.encode("utf-8")[:BCRYPT_MAX_BYTES]


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(_password_bytes(raw), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(_password_bytes(raw), hashed.encode("utf-8"))
    except ValueError:
        # Stored value is not a bcrypt hash at all; treat as a failed match
        # rather than a 500.
        return False


def create_token(user_id: int, username: str | None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": now,
        "exp": now + timedelta(hours=settings.jwt_expire_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_user_id(token: str) -> int | None:
    """The user id carried by a valid token, or None if it is invalid, expired
    or malformed - mirroring JwtUtil.isTokenValid swallowing every JwtException.
    """
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        return int(claims["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> int:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    user_id = decode_user_id(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    return user_id


def require_admin(
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> int:
    """Admin is a flag on the user row, never a token claim, so it costs a read."""
    user = db.get(User, user_id)
    if user is None or not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user_id
