"""Code execution, proxied to the external Piston container.

Two quirks of this contract are load-bearing for the frontend and are kept:
the parameters arrive as query strings while the **raw body is the source
code**, and the response is **plain text** rather than JSON. `Match.jsx` posts
with `Content-Type: text/plain` and compares `String(judgeRes.data).trim()`
against the expected output, so wrapping the result in JSON would fail every
test case.
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse

from app.security import get_current_user_id
from app.services.judge import PistonUnavailable, execute_code

router = APIRouter(prefix="/api/judge", tags=["judge"])


@router.post("/execute", response_class=PlainTextResponse)
async def execute(
    request: Request,
    language: str = Query(...),
    version: str = Query(...),
    stdin: str = Query(...),
    _user_id: int = Depends(get_current_user_id),
) -> str:
    """`stdin` is required, matching Java's `@RequestParam String stdin`: omitting
    it answered `400 {"error": "Missing parameter: stdin"}`, which `errors.py`
    already reproduces. The frontend always sends it, empty when a test case has
    no input.

    The body is read raw rather than declared as a parameter, so any content
    type is accepted - Spring's `@RequestBody String` went through
    StringHttpMessageConverter and did the same. Reading it is what forces this
    route to be async, and `execute_code` blocks for as long as the submitted
    program runs, so it goes to a thread rather than parking the event loop -
    the frontend fires all ten test cases of a submission concurrently, and
    heartbeats and match pushes share this loop.
    """
    source_code = (await request.body()).decode("utf-8")
    try:
        return await asyncio.to_thread(
            execute_code, source_code, language, version, stdin
        )
    except PistonUnavailable as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
