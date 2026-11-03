"""FastAPI application factory: config, CORS, lifespan, routers."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.errors import register_exception_handlers
from app.redis_client import ping_redis
from app.routers import judge, matchmaking, problems, users, visits
from app.seed import seed_problems
from app.ws import manager

# Importing the models registers all six tables on Base.metadata, which is what
# create_all below has to work from.
from app import models  # noqa: F401

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("arena")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The database is empty after the PC reset, so this genuinely creates the
    # six tables rather than being the no-op the migration plan first assumed.
    Base.metadata.create_all(bind=engine)
    logger.info("Postgres connected; schema ensured for %d tables", len(Base.metadata.tables))

    ping_redis()
    logger.info("Redis connected at %s:%s", settings.redis_host, settings.redis_port)

    # The seeder is the only source of problem data on the fresh database, and
    # matchmaking has nothing to hand out until it has run.
    with SessionLocal() as db:
        seed_problems(db)

    # Synchronous service code pushes to sockets from threadpool workers, so
    # the manager needs a handle on this loop to hop back onto.
    manager.bind_loop(asyncio.get_running_loop())

    yield


app = FastAPI(title="Arena API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

register_exception_handlers(app)

app.include_router(judge.router)
app.include_router(matchmaking.router)
app.include_router(problems.router)
app.include_router(users.router)
app.include_router(visits.router)


@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket, user_id: int = Query(alias="userId")
) -> None:
    """Public, like the STOMP endpoint it replaces: the `userId` query param is
    the only addressing, and it is not authenticated - a client that lies about
    it receives another user's match pushes, exactly as subscribing to
    `/topic/match/{id}` allowed before.

    The receive loop exists only to notice the disconnect. Inbound frames are
    read and discarded; the client never sends any.
    """
    await manager.connect(user_id, websocket)
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user_id, websocket)
