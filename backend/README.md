# Arena backend (FastAPI)

The REST + WebSocket API for the Arena 1v1 coding platform. It replaces the
Spring Boot backend kept at `legacy/`, serving the same contract on `:8080/api`.

## Requirements

- Python 3.11+ (developed on 3.13)
- PostgreSQL 16 and Redis 7, both reachable from the host
- Piston on `:2000` for code execution (only needed by `/api/judge`)

The infrastructure containers:

```
docker run -d --name arena-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=arena \
  -p 5432:5432 -v arena-pgdata:/var/lib/postgresql/data postgres:16
docker run -d --name arena-redis -p 6379:6379 redis:7-alpine
```

## Setup

```
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1        # PowerShell; use source .venv/bin/activate elsewhere
pip install -r requirements.txt
copy .env.example .env             # cp on non-Windows
```

`.env` is git-ignored. `.env.example` carries working local defaults, so the
copy needs no edits for a local run.

## Run

```
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Run **a single worker** (no `--workers`, no gunicorn pool). Match heartbeats
live in process memory, the same limitation the Java backend had. With two
workers each sees only the beats it received, so a live opponent reads as
disconnected and the stale-match sweep abandons matches still being played.

On startup the app creates any missing tables, seeds the problem set when
`problems` is empty, and verifies the Redis connection. Every 60 seconds a
background sweep marks a match abandoned (`winner = -1`) once both players have
sent no heartbeat for 30 seconds. Interactive API docs are
at <http://localhost:8080/docs>.

## Layout

| Path | Holds |
|---|---|
| `app/main.py` | app factory, CORS, lifespan, router wiring |
| `app/config.py` | settings read from `.env` |
| `app/database.py` | SQLAlchemy engine, session factory, `get_db` dependency |
| `app/redis_client.py` | shared Redis client |
| `app/models.py` | ORM models for the six tables |
| `app/schemas.py` | request/response models, with the JSON keys the frontend reads |
| `app/errors.py` | the `{"error": "<message>"}` contract |
| `app/routers/` | one module per `/api` path prefix |
| `app/services/` | matchmaking, match completion and Elo, heartbeats, the judge proxy |
| `app/ws.py` | the `/ws` socket registry and its threadsafe push helpers |

## Conventions

- **Errors** always leave as `{"error": "<message>"}`. Raise
  `HTTPException(status_code, detail="...")` and the handler in `app/errors.py`
  reshapes it; validation failures become `400 {"error": "field: message"}` and
  a missing query parameter becomes `400 {"error": "Missing parameter: name"}`,
  matching the Java `GlobalExceptionHandler`. The frontend logs the user out on
  any `403`, so reserve that status for auth and ownership failures.
- **Column names** are Hibernate's, so `legacy/` still works against the same
  database. Map a clean Python attribute onto an awkward column rather than
  renaming it - see `Match.p1_elo_change` in `app/models.py`.
- **Routers** declare their own full prefix (`/api/visits`) and mount their root
  route as `@router.post("")`, so the path has no trailing slash to redirect to.
