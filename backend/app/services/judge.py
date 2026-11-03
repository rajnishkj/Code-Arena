"""Piston proxy, ported from `legacy/.../service/JudgeService.java`.

That file is the only authority on the failure strings - there is no JDK here to
run the Java version and diff against - so the four it can return are reproduced
verbatim below, and the branch order is its order.

The Java version used `RestTemplate.postForObject`, which *throws* on a non-2xx
response rather than returning the body. So the `Piston error:` and
`Piston message:` strings only ever appeared when Piston answered 200 with an
error key; a 400 from Piston (an unknown runtime, say) surfaced as a thrown
RestClientException and left as a 500 `{"error": ...}` from the global handler.
`PistonUnavailable` below keeps that split intact, message formats included.
"""

import httpx

from app.config import settings

# JudgeService set this header explicitly; Piston logs it, and the legacy
# service is the reason it exists at all.
USER_AGENT = "code-arena-app"

# Ours, not Java's: `new RestTemplate()` configures no timeouts at all, so a
# hung Piston pinned a request thread indefinitely. Piston caps a run itself
# (3s CPU by default), which this sits well clear of.
TIMEOUT_SECONDS = 30.0


class PistonUnavailable(RuntimeError):
    """Piston could not be reached, or answered non-2xx.

    Both cases reached Spring's `handleRuntime` and became a 500 carrying the
    exception's message, so this carries the message and the router maps it.
    """


def execute_code(source_code: str, language: str, version: str, stdin: str) -> str:
    body = {
        "language": language,
        "version": version,
        "files": [{"content": source_code}],
        "stdin": stdin,
    }

    try:
        response = httpx.post(
            settings.piston_url,
            json=body,
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.RequestError as exc:
        # ResourceAccessException's wording, which is what the frontend's error
        # toast showed when the container was down.
        raise PistonUnavailable(
            f'I/O error on POST request for "{settings.piston_url}": {exc}'
        ) from exc

    if response.is_error:
        # HttpStatusCodeException.getMessage() formats exactly this way.
        raise PistonUnavailable(
            f"{response.status_code} {response.reason_phrase}: [{response.text}]"
        )

    try:
        payload = response.json()
    except ValueError:
        # postForObject could not have converted a non-JSON body either, and
        # failed the same way - through the 500 path rather than with a string.
        raise PistonUnavailable(
            f"Could not extract response: Piston returned non-JSON content type "
            f"[{response.headers.get('content-type', 'unknown')}]"
        ) from None

    if payload is None:
        return "No response"

    # Order matters: `error` is checked before `message`, as in the Java source.
    if "error" in payload:
        return f"Piston error: {payload['error']}"
    if "message" in payload:
        return f"Piston message: {payload['message']}"

    run = payload.get("run")
    if run is None:
        return "No run result in Piston response"

    output = run.get("output")
    # A compile error or an uncaught exception is *not* a failure path here:
    # Piston answers 200 and puts the traceback in `run.output`, so the legacy
    # error text a broken program produces is simply its own stderr.
    return output if output is not None else "No output"
