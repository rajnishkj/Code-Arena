"""Pydantic request/response models, with the exact JSON keys the frontend reads.

Response fields are named in snake_case and carry a `serialization_alias` where
the wire key differs; FastAPI serialises by alias, so the JSON keys stay exactly
what the Java controllers emitted.
"""

from datetime import datetime

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, computed_field

# UserService.createUser: `if (user.getElo() == 0) user.setElo(800)`.
DEFAULT_ELO = 800


class VisitCountResponse(BaseModel):
    count: int


class ErrorResponse(BaseModel):
    """The single error shape every router returns: {"error": "<message>"}."""

    error: str


class RegisterRequest(BaseModel):
    """Java bound the whole `User` entity here, hence the odd shape: the *raw*
    password arrives under the `encrypted_password` key and is hashed on the way
    in. `guest` rather than `is_guest` is Lombok's doing - `isGuest()` makes
    Jackson call the property `guest` - and both spellings are accepted.

    `username` and `encrypted_password` are required. Java left them optional and
    answered a body without a password with an NPE-driven 500; a 400 naming the
    missing field is the same rejection, better spelled.

    Registration deliberately does NOT bind `isAdmin`, which Java's
    `@RequestBody User` did - that made registration a self-serve admin
    escalation. `elo` stays bindable, faithfully: a registrant can still
    self-assign one.
    """

    model_config = ConfigDict(populate_by_name=True)

    username: str
    password: str = Field(alias="encrypted_password")
    name: str | None = None
    email: str | None = None
    # 0 carries "unset" through to the 800 default, as it did in Java.
    elo: int = 0
    is_guest: bool = Field(default=False, alias="guest")


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    """Both /register and /login return this identical shape."""

    token: str
    user_id: int = Field(serialization_alias="userId")
    username: str | None
    elo: int


class MeResponse(BaseModel):
    user_id: int = Field(serialization_alias="userId")
    username: str | None
    elo: int
    # Java coalesced these two to "" rather than emitting null.
    name: str = ""
    email: str = ""


# ---------------------------------------------------------------------------
# Problems
# ---------------------------------------------------------------------------


class TestCaseRequest(BaseModel):
    """Jackson bound `TestCase` from two names at once, and both are in live use:
    `problems.md` sends `isSample`, and the frontend reads `sample`. That is not
    sloppiness in either consumer - it is the well-known Jackson quirk around a
    boolean field called `isSample`. The field carries `@JsonProperty("isSample")`
    while Lombok's `isSample()` getter introspects to the implicit name `sample`,
    and because the two implicit names differ Jackson never links them into one
    property. It publishes both. Accept both on the way in, emit both on the way
    out (see `TestCaseResponse.sample`).
    """

    model_config = ConfigDict(populate_by_name=True)

    input: str | None = None
    expected_output: str | None = Field(default=None, validation_alias="expectedOutput")
    is_sample: bool = Field(
        default=False, validation_alias=AliasChoices("isSample", "sample")
    )


class ProblemRequest(BaseModel):
    """Every field is optional here because Jackson's binding was: a missing key
    left the field null (or 0 for the two primitives), and only the *later*
    Bean Validation pass rejected it. That pass lives in `routers/problems.py`,
    which is where the rejection turns into a 400.
    """

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = None
    description: str | None = None
    input_format: str | None = Field(default=None, validation_alias="inputFormat")
    output_format: str | None = Field(default=None, validation_alias="outputFormat")
    constraints: str | None = None
    difficulty: str | None = None
    rating: int | None = None
    avg_solving_time: int = Field(default=0, validation_alias="avgSolvingTime")
    test_cases: list[TestCaseRequest] | None = Field(
        default=None, validation_alias="testCases"
    )


class TestCaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    input: str | None = None
    expected_output: str | None = Field(
        default=None, serialization_alias="expectedOutput"
    )
    is_sample: bool = Field(default=False, serialization_alias="isSample")

    @computed_field
    @property
    def sample(self) -> bool:
        """The second of Jackson's two keys for one boolean - the one the
        frontend actually filters on (`tc.sample`). See `TestCaseRequest`.
        """
        return self.is_sample


class ProblemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str | None = None
    description: str | None = None
    input_format: str | None = Field(default=None, serialization_alias="inputFormat")
    output_format: str | None = Field(default=None, serialization_alias="outputFormat")
    constraints: str | None = None
    difficulty: str | None = None
    rating: int
    avg_solving_time: int = Field(default=0, serialization_alias="avgSolvingTime")
    test_cases: list[TestCaseResponse] = Field(
        default_factory=list, serialization_alias="testCases"
    )

    @computed_field
    @property
    def eloRange(self) -> str:  # noqa: N802 - the wire key, not a Python name
        """`Problem.getEloRange()` is a getter with no backing column, so Jackson
        published it as a response key. Nothing in the frontend reads it today,
        but it costs one property to keep the response shape whole.
        """
        if self.rating <= 900:
            return "0-1000"
        if self.rating <= 1300:
            return "1000-1400"
        if self.rating <= 1600:
            return "1400-1800"
        return "1800+"


# ---------------------------------------------------------------------------
# Users - lookup, leaderboards, profile update
# ---------------------------------------------------------------------------


class PublicUserResponse(BaseModel):
    """The `User` entity as `/{username}`, `/id/{id}`, `/leaderboard` and
    `PUT /{id}` returned it - minus the password.

    Key names are Lombok's, not the field names: a `private boolean isGuest`
    gets an `isGuest()` getter whose implicit Jackson name is `guest`, and the
    private field itself is not auto-detected, so `guest` and `admin` are the
    only spellings that ever went over the wire. `created_at` keeps its
    underscore because the Java field is literally named `created_at`.

    Dropping `encrypted_password` is the one intentional difference. Jackson
    published the bcrypt hash on all four of these routes, one of which is
    public; nothing reads it, so it is gone.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str | None = None
    username: str | None = None
    email: str | None = None
    elo: int
    is_guest: bool = Field(default=False, serialization_alias="guest")
    is_admin: bool = Field(default=False, serialization_alias="admin")
    created_at: datetime | None = None


class DailyLeaderboardEntry(BaseModel):
    username: str | None = None
    solve_count: int = Field(serialization_alias="solveCount")


class UpdateUserRequest(BaseModel):
    """Java bound `Map<String, String>` and applied each value only when
    non-null, so a body carrying just one of the two fields left the other
    alone. Both optional here for the same reason.
    """

    name: str | None = None
    email: str | None = None


class MatchDetailsResponse(BaseModel):
    """MatchDetailsDTO. `Match.jsx` works out the opponent from `p1Id`/`p2Id`."""

    match_id: int = Field(serialization_alias="matchId")
    p1_id: int | None = Field(serialization_alias="p1Id")
    p2_id: int | None = Field(serialization_alias="p2Id")
    p1_username: str | None = Field(serialization_alias="p1Username")
    p2_username: str | None = Field(serialization_alias="p2Username")
    problem_id: int | None = Field(serialization_alias="problemId")
