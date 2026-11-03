# Code Arena


Real-time 1v1 competitive coding platform. Face real opponents, solve problems under pressure, climb the Elo ladder.

<!-- ![Code Arena Screenshot](path/to/screenshot.png) -->
![Home](image.png)![Live Match](image-4.png) ![Matchmaking](image-6.png) ![Result](image-7.png)![Leaderboard](image-1.png)

---

## Overview

Code Arena is a live-coding duel platform where two players receive the same problem and race to submit a correct solution. Built as a portfolio project for SDE fresher roles. Full-stack monorepo with a FastAPI backend, React frontend, PostgreSQL database, Redis matchmaking queue, and Piston code execution engine.

---

## Architecture

```
Browser ──── HTTP ──── FastAPI ──── PostgreSQL
    │                   │   │
    │             Redis │   └── Piston (Docker)
    │                   │
    └──── WebSocket ────┘
```

- The frontend calls the REST API under `http://localhost:8080/api` and opens one native WebSocket at `ws://localhost:8080/ws?userId=<id>`. The socket is push-only: the server sends `{"type": "match" | "match-result", "payload": <match>}` and ignores anything the browser sends.
- The backend is one FastAPI process. Routers in `backend/app/routers/` handle HTTP, and services in `backend/app/services/` hold matchmaking, match completion, Elo, heartbeats, and the judge proxy.
- SQLAlchemy creates the six tables on startup, and the seeder loads 5 problems with 10 test cases each when the `problems` table is empty.
- The matchmaking queue is a Redis sorted set.
- Code runs in Piston, a Docker container on port 2000. The backend proxies each run to it.
- Match heartbeats live in process memory, so the backend must run as a single worker.

The Spring Boot backend this replaces is kept locally under `legacy/` and is not tracked in git. The routes and JSON shapes are unchanged, so the frontend's only changes are the WebSocket client and its dependency list. See [`backend/README.md`](backend/README.md) for the backend's layout and conventions.

---

## Tech Stack
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker)

| Layer | Technology |
|---|---|
| Backend | FastAPI, Python 3.11+, Uvicorn, SQLAlchemy 2 |
| Real-time | Native WebSocket (FastAPI `/ws`, browser `WebSocket`) |
| Auth | JWT (PyJWT, HS256), bcrypt |
| Database | PostgreSQL 16 (psycopg 3) |
| Queue | Redis 7 (sorted sets) |
| Code Execution | Piston API (Docker, privileged mode), proxied with httpx |
| Frontend | React 19, React Router, Monaco Editor |
| Animations | GSAP, HLS.js (video backgrounds) |
| UI | Lucide React icons, glassmorphism CSS |
| Build | Create React App (react-scripts) |

---

## Features

- **1v1 coding duels** — real opponents, real pressure
- **Elo matchmaking** — ±100 Elo band, expands to ±300 after 15s wait
- **6 languages** — Python, JavaScript, Java, C++, Go, Rust
- **Piston execution** — per-case pass/fail with sample-only dry-run
- **WebSocket live updates** — instant match result delivery
- **Heartbeat disconnect detection** — auto-complete if opponent disconnects
- **Ranked leaderboard** — Elo-based, gold/silver/bronze styling
- **Admin problem management** — create, update, bulk create via API
- **Responsive dark UI** — HLS video backgrounds, glassmorphism cards, code-editor aesthetic
- **Character trail** — mouse-following code symbols

---

## Match Flow

1. User enters Lobby, clicks "Find Match"
2. Backend scans Redis queue for opponent within ±100 Elo
3. Match found → both players assigned same problem (selected by Elo range)
4. Both see Monaco editor with problem statement and test cases
5. Player writes code, can Run against sample cases or Submit against all cases
6. First correct submission wins. A later `/complete` from the other player gets `409 {"error": "Match already finished"}`
7. Elo updated (K=32), a solved-problem row written for each player, result pushed via WebSocket
8. Both players redirected to result overlay

If one player's tab dies, the other tab sees the opponent's heartbeat go stale and claims the win within about 10 seconds of the opponent's last heartbeat. If both players stay silent for 30 seconds, the next run of a background sweep marks the match abandoned (`winner = -1`) with no rating change. The sweep runs every 60 seconds, so this takes 30 to 90 seconds.

---

## Code Execution

Piston is a Docker-based code execution engine running on port 2000.

| Language | Version |
|---|---|
| Python | 3.12.0 |
| JavaScript | 18.15.0 |
| Java | 15.0.2 |
| C++ | 10.2.0 |
| Go | 1.16.2 |
| Rust | 1.68.2 |

These are the versions `frontend/src/pages/Match.jsx` requests, so Piston must have exactly these runtimes installed. JavaScript and C++ install under the Piston package names `node` and `gcc`.

**Run vs Submit:**
- **Run** — executes against sample test cases only (`isSample=true`). No match completion.
- **Submit** — executes against all test cases. First correct submission wins the match.

---

## Matchmaking Algorithm

- Redis sorted set key: `matchmaking_queue`
- Score: enqueue time (epoch millis)
- On join: scan all entries for opponent within ±100 Elo
- If no match found within 15s of opponent wait time → expand band to ±300
- Skip opponents with active matches (DB check) or deleted/stale users
- Successful match → remove both from queue, create Match in DB
- No match → insert self into queue
- Entries older than 60s purged on each join attempt

---

## Authentication

- JWT tokens (HS256) with 24h expiry. `sub` is the user id and a `username` claim rides along. There are no roles.
- Passwords hashed with bcrypt
- Public endpoints: `POST /api/users/login`, `POST /api/users/register`, `GET /api/users/{username}`, `GET /api/users/leaderboard`, `POST /api/visits`, `/ws`
- All other endpoints require `Authorization: Bearer <token>`. A missing or invalid token gets `401`.
- Admin is the `users.is_admin` flag, checked per request. A non-admin gets `403 {"error": "Admin access required"}`.
- Errors always have the shape `{"error": "<message>"}`
- CORS allows `http://localhost:3000` (set `CORS_ORIGINS` in `backend/.env` to change it)

---

## API Endpoints

### User
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| POST | `/api/users/register` | No | Register account |
| POST | `/api/users/login` | No | Login, returns JWT |
| GET | `/api/users/me` | Yes | Current user profile |
| GET | `/api/users/leaderboard` | No | Elo-ranked user list, guests excluded |
| GET | `/api/users/leaderboard/daily` | Yes | Matches played since local midnight, per user |
| GET | `/api/users/id/{id}` | Yes | User by id |
| PUT | `/api/users/{id}` | Yes | Update name and email (own account only) |
| GET | `/api/users/{username}` | No | Public profile lookup |

### Matchmaking
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| POST | `/api/matchmaking/join` | Yes | Enter queue |
| POST | `/api/matchmaking/leave` | Yes | Leave queue |
| GET | `/api/matchmaking/status` | Yes | Check queue/match status |

### Match
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| POST | `/api/matches/create?p1&p2&problemId` | Yes | Create a match directly |
| GET | `/api/matches/{id}` | Yes | Match details (players, problem) |
| POST | `/api/matches/complete?matchId` | Players | Claim the win; `409` if someone else already won or the match was abandoned |
| POST | `/api/matches/forfeit?matchId` | Players | Concede match |
| POST | `/api/matches/heartbeat?matchId` | Players | Ping server (2s interval) |
| GET | `/api/matches/heartbeat/status?matchId&opponentId` | Yes | Check opponent alive status |

"Players" means the caller must be `p1` or `p2`. Anyone else gets `404 {"error": "Match not found"}`.

### Problems
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| POST | `/api/problems/create` | Admin | Create problem |
| PUT | `/api/problems/{id}` | Admin | Update problem |
| POST | `/api/problems/bulk` | Admin | Bulk create problems |
| GET | `/api/problems/{id}` | Yes | Problem with its test cases |
| GET | `/api/problems/for-elo/{elo}` | Yes | Problems rated within 200 of `elo` |

### Code Execution
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| POST | `/api/judge/execute?language&version&stdin` | Yes | Run the raw request body as source; returns the output as plain text |

The frontend runs and submits by calling `/api/judge/execute` once per test case: sample cases for **Run**, all cases for **Submit**.

### Visit Counter
| Method | URL | Auth | Description |
|--------|-----|------|-------------|
| POST | `/api/visits` | No | Increment visit count |

---

## Database Schema

The backend creates these tables on startup (`backend/app/models.py`). Column names follow Hibernate's naming from the original Java entities, so `legacy/` still works against the same database. Every `id` is a `bigint` identity primary key. The only foreign key is `test_cases.problem_id`. The player and problem columns in `matches` and `solved_problems` are plain `bigint` values with no constraint.

### users
| Column | Type | Notes |
|--------|------|-------|
| id | BIGINT | PK |
| name | VARCHAR(255) | Display name, nullable |
| username | VARCHAR(255) | Nullable. **Not unique**: registration does not stop duplicates |
| email | VARCHAR(255) | Nullable, UNIQUE |
| elo | INTEGER | NOT NULL. 800 unless the registration body sets `elo` |
| encrypted_password | VARCHAR(255) | bcrypt hash |
| is_guest | BOOLEAN | NOT NULL |
| is_admin | BOOLEAN | NOT NULL, default false |
| created_at | TIMESTAMP(6) | |

### problems

The API rejects a problem with a blank `title`, `description`, `input_format`, `output_format`, or `difficulty`, or with no `rating`. The table itself lets the five text columns be NULL.

| Column | Type | Notes |
|--------|------|-------|
| id | BIGINT | PK |
| title | VARCHAR(255) | Required by the API |
| description | TEXT | Required by the API |
| input_format | TEXT | Required by the API |
| output_format | TEXT | Required by the API |
| constraints | TEXT | |
| difficulty | VARCHAR(255) | Required by the API. EASY, MEDIUM, or HARD by convention, not enforced |
| rating | INTEGER | NOT NULL, required by the API. Elo reference |
| avg_solving_time | INTEGER | NOT NULL |

### test_cases
| Column | Type | Notes |
|--------|------|-------|
| id | BIGINT | PK |
| problem_id | BIGINT | FK → problems(id) |
| input | TEXT | |
| expected_output | TEXT | |
| is_sample | BOOLEAN | NOT NULL. Sample vs hidden |

### matches
| Column | Type | Notes |
|--------|------|-------|
| id | BIGINT | PK |
| p1 | BIGINT | User id, no FK |
| p2 | BIGINT | User id, no FK |
| problem_id | BIGINT | Problem id, no FK |
| winner | BIGINT | NULL while in progress, `-1` when abandoned, else the winner's user id |
| p1elo_change | INTEGER | NOT NULL |
| p2elo_change | INTEGER | NOT NULL |

### solved_problems
| Column | Type | Notes |
|--------|------|-------|
| id | BIGINT | PK |
| user_id | BIGINT | User id, no FK |
| problem_id | BIGINT | Problem id, no FK |
| solved_at | TIMESTAMP(6) | |

A finished match writes one row for **each** player, winner or not. The daily leaderboard counts these rows, so it counts matches played rather than wins.

### visit
| Column | Type | Notes |
|--------|------|-------|
| id | BIGINT | PK |
| count | INTEGER | NOT NULL. Single-row counter |

---

## Setup Instructions

### Prerequisites

- Python 3.11+
- Node.js 18+
- Docker (for PostgreSQL, Redis, and Piston)

No JDK is needed.

### Steps

```bash
# 1. Clone repository
git clone https://github.com/rajnishkj/code_arena
cd code_arena

# 2. PostgreSQL and Redis
docker run -d --name arena-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=arena \
  -p 5432:5432 -v arena-pgdata:/var/lib/postgresql/data postgres:16
docker run -d --name arena-redis -p 6379:6379 redis:7-alpine

# 3. Piston (Docker)
docker run -d \
  --name piston \
  --restart unless-stopped \
  --privileged \
  --tmpfs /piston/jobs \
  -p 2000:2000 \
  ghcr.io/engineer-man/piston
# Then install the runtimes listed under Code Execution, through Piston's
# package API (POST /api/v2/packages), before running any code.

# 4. Backend
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1       # Windows PowerShell; source .venv/bin/activate elsewhere
pip install -r requirements.txt
copy .env.example .env            # cp on macOS and Linux
uvicorn app.main:app --host 0.0.0.0 --port 8080

# 5. Frontend (new terminal, from the repo root)
cd frontend
npm install
npm start
```

Open `http://localhost:3000`.

`.env.example` holds working local defaults, so the copy needs no edits. On first start the backend creates the tables and seeds the five problems. Run it as a single worker: never pass `--workers`, because heartbeats live in process memory.

### Setting Admin Privileges

Connect to PostgreSQL and run:

```sql
UPDATE users SET is_admin = true WHERE id = <your_user_id>;
```

---

## Future Additions — Gamification & Engagement

### Competitive & Social
- **Win streaks & badges** — streak counter on profile + badges (3-win, 10-win, first blood, comeback king). Visible on leaderboard.
- **Daily challenges** — one curated problem per day with separate leaderboard. Solves the "what do I practice?" problem.
- **Match history / replay** — view past matches: opponent, problem, result, Elo change, submitted code. Great for learning.
- **Rating tiers** — Elo thresholds (1000, 1400, 1800) act as floors. Bronze → Silver → Gold → Platinum progression.
- **Spectator mode** — watch ongoing matches between top players. Read-only editor + problem view. Drives community.

### Game Mechanics
- **Power-ups / modifiers** — rare random events: 2x points, harder variant for opponent, bonus time. Keeps matches unpredictable.
- **Timed mode** — 5/10/15 min rounds. Most problems solved wins (not first correct). Rewards breadth over speed.
- **Blitz mode** — 2-min sudden death. One easy problem, winner takes all. Fast, low commitment.
- **Casual / unranked mode** — no Elo change. Practice without fear, lower barrier for new users.

### Engagement Hooks
- **Push notifications** — "Match found!", "You dropped in rank". Browser notifications bring users back.
- **Friend system** — add friends, see online status, challenge directly (bypass queue).
- **Profile page** — public profile: username, Elo, win rate, solved count, recent matches, badges.
- **Activity feed** — "Raj beat Ankit at Factorial", "Sara reached 1500 Elo". Social proof drives engagement.

### Low Effort, High Impact
- Match start countdown (3, 2, 1, GO!) — trivial, huge hype
- Play again button on match-over overlay — one click, keeps flow
- "You are X Elo from next rank" progress bar — goal clarity
- Animated Elo change on result screen (+12 green, -8 red) — visceral feedback

## Development Notes

### Single worker only
Heartbeats are an in-process dictionary. With two Uvicorn workers, each worker sees only the beats it received, so a live opponent reads as disconnected and the sweep abandons matches still in play.

### Piston Version Mismatch
Hardcoded runtime versions must match Piston's installed runtimes. Check available versions via `GET /api/v2/runtimes` on the Piston container.

### Matchmaking claims are atomic
Two players joining at the same moment can both find the same waiting opponent. The `ZREM` that removes the opponent from the queue decides who gets them: a join whose `ZREM` removes nothing moves on to the next entry.

### Match completion is serialised
`/complete` locks the match row (`SELECT ... FOR UPDATE`), so a submit that races the opponent's disconnect auto-complete applies Elo once. The loser of the race gets `409`.

### Stale Match Purge
A background task runs every 60s, starting one interval after startup. It finds matches with `winner IS NULL` and checks the heartbeat tracker. Both players stale 30s+ → purged with `winner=-1`, no Elo change, no WebSocket notification.

### Expired tokens get 401
A missing or expired token gets `401`, but `frontend/src/services/api.js` logs the user out only on `403`. The Spring backend answered `403`, so an expired session now stays on the page and its requests fail until the user logs in again.
