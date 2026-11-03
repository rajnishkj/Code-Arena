"""Problem authoring (admin-gated), lookup, and the Elo-band query.

Everything here is authenticated. The three write routes additionally require
the `users.is_admin` flag - there is no role claim in the token, so `require_admin`
pays for a user read on each call, exactly as the Java controller did when it
called `userService.getUserById(auth.getPrincipal())` before every write.

Note that `problems.md` section 9 calls the two GET routes public. It is wrong:
`SecurityConfig` permits only `/api/users/login`, `/api/users/register`,
`/api/users/{username}`, `/api/visits` and `/ws/**`, so everything under
`/api/problems` fell through to `anyRequest().authenticated()`.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Problem, TestCase
from app.schemas import ProblemRequest, ProblemResponse
from app.security import get_current_user_id, require_admin
from app.services.problems import problems_for_elo as problems_in_elo_band

router = APIRouter(prefix="/api/problems", tags=["problems"])

# The Bean Validation pass the Java entity's @NotBlank annotations stood for,
# in their declaration order. That order is load-bearing: Java reported only the
# *first* field error, and `problems.md` pins the body {"description": ...} to
# "title: Title is required". Spring's own ordering was incidental; fixing it
# here is what makes that documented example reproducible.
_REQUIRED_TEXT: tuple[tuple[str, str, str], ...] = (
    ("title", "title", "Title is required"),
    ("description", "description", "Description is required"),
    ("input_format", "inputFormat", "Input format is required"),
    ("output_format", "outputFormat", "Output format is required"),
    ("difficulty", "difficulty", "Difficulty is required"),
)


def _reject_if_invalid(payload: ProblemRequest) -> ProblemRequest:
    """Raise 400 `{"error": "field: message"}` on the first violation.

    `rating` is checked for presence, which the Java annotation could not do:
    @NotNull on a primitive `int` can never fail, so a body omitting `rating`
    silently became a rating-0 problem that no Elo band could match.
    """
    for attr, json_key, message in _REQUIRED_TEXT:
        value = getattr(payload, attr)
        if value is None or not value.strip():
            raise HTTPException(status_code=400, detail=f"{json_key}: {message}")
    if payload.rating is None:
        raise HTTPException(status_code=400, detail="rating: Rating is required")
    return payload


def _test_case_rows(payload: ProblemRequest) -> list[TestCase]:
    return [
        TestCase(input=tc.input, expected_output=tc.expected_output, is_sample=tc.is_sample)
        for tc in (payload.test_cases or [])
    ]


def _new_problem(payload: ProblemRequest, db: Session) -> Problem:
    problem = Problem(
        title=payload.title,
        description=payload.description,
        input_format=payload.input_format,
        output_format=payload.output_format,
        constraints=payload.constraints,
        difficulty=payload.difficulty,
        rating=payload.rating,
        avg_solving_time=payload.avg_solving_time,
        test_cases=_test_case_rows(payload),
    )
    db.add(problem)
    return problem


@router.post("/create", response_model=ProblemResponse)
def create_problem(
    payload: ProblemRequest,
    db: Session = Depends(get_db),
    _admin: int = Depends(require_admin),
) -> Problem:
    problem = _new_problem(_reject_if_invalid(payload), db)
    db.commit()
    db.refresh(problem)
    return problem


@router.post("/bulk", response_model=list[ProblemResponse])
def create_problems(
    payloads: list[ProblemRequest],
    db: Session = Depends(get_db),
    _admin: int = Depends(require_admin),
) -> list[Problem]:
    """All-or-nothing, unlike Java's `.map(problemService::createProblem)`, which
    saved each problem as it went and left the earlier ones committed when a
    later one failed validation. One transaction is the better contract and the
    success shape is identical.
    """
    validated = [_reject_if_invalid(p) for p in payloads]
    created = [_new_problem(p, db) for p in validated]
    db.commit()
    for problem in created:
        db.refresh(problem)
    return created


@router.put("/{problem_id}", response_model=ProblemResponse)
def update_problem(
    problem_id: int,
    payload: ProblemRequest,
    db: Session = Depends(get_db),
    _admin: int = Depends(require_admin),
) -> Problem:
    """Scalars are replaced wholesale and the test-case collection is *rebuilt*:
    clearing the list lets `delete-orphan` delete the old rows rather than
    leaving them behind pointing at nothing, which is what made Java clear the
    collection and null each incoming id before re-adding.
    """
    payload = _reject_if_invalid(payload)
    problem = db.get(Problem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="Problem not found")

    problem.title = payload.title
    problem.description = payload.description
    problem.input_format = payload.input_format
    problem.output_format = payload.output_format
    problem.constraints = payload.constraints
    problem.difficulty = payload.difficulty
    problem.rating = payload.rating
    problem.avg_solving_time = payload.avg_solving_time

    # Unconditional, which looks like a missing guard and is not. Java wrote
    # `if (updated.getTestCases() != null)`, but `Problem.testCases` is field-
    # initialised to `new ArrayList<>()`, so Jackson never handed it a null and
    # the branch always fired. A body omitting `testCases` therefore *emptied*
    # the collection. Faithful, and the plan is explicit that a real gap gets
    # preserved and flagged rather than quietly tightened.
    problem.test_cases.clear()
    # Flush the orphan deletes before the replacements are queued, so the two
    # sets never collide on the way to the database.
    db.flush()
    problem.test_cases.extend(_test_case_rows(payload))

    db.commit()
    db.refresh(problem)
    return problem


@router.get("/for-elo/{elo}", response_model=list[ProblemResponse])
def problems_for_elo(
    elo: int,
    db: Session = Depends(get_db),
    _user_id: int = Depends(get_current_user_id),
) -> list[Problem]:
    """Declared before `/{problem_id}` so the literal segment wins the match."""
    return problems_in_elo_band(db, elo)


@router.get("/{problem_id}", response_model=ProblemResponse)
def get_problem(
    problem_id: int,
    db: Session = Depends(get_db),
    _user_id: int = Depends(get_current_user_id),
) -> Problem:
    problem = db.get(Problem, problem_id)
    if problem is None:
        # Java threw a bare RuntimeException here, which the global handler
        # turned into a 500. 404 is the honest code and is what the plan's
        # status mapping asks for; the {"error": ...} body is unchanged, and
        # the frontend only checks for failure.
        raise HTTPException(status_code=404, detail="Problem not found")
    return problem
