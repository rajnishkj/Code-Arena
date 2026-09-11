"""Seed data ported from `legacy/.../seeder/DataSeeder.java`.

The Java seeder was a `CommandLineRunner` that returned early when the problems
table was non-empty. On the destroyed database that guard never mattered; on the
fresh one this is the *only* source of problem data, and ticket 09's matchmaking
picks from it, so the five problems and their ten test cases each are reproduced
verbatim - titles, statements, ratings, inputs and expected outputs unchanged.

The sample/hidden split is also verbatim: the first two cases of every problem
are samples (the frontend's Run button executes exactly those), the remaining
eight are hidden judge tests.
"""

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Problem, TestCase

logger = logging.getLogger("arena")

# (input, expected_output, is_sample)
_Case = tuple[str, str, bool]

SEED_PROBLEMS: list[dict] = [
    {
        "title": "Sum of Two Numbers",
        "description": "Given two integers A and B, print their sum.",
        "input_format": "Two space-separated integers A and B.",
        "output_format": "Print a single integer, the sum of A and B.",
        "constraints": "1 <= A, B <= 10^9",
        "difficulty": "EASY",
        "rating": 800,
        "avg_solving_time": 60,
        "test_cases": [
            ("3 5", "8", True),
            ("10 20", "30", True),
            ("1000000000 1000000000", "2000000000", False),
            ("0 0", "0", False),
            ("1 1", "2", False),
            ("999999999 1", "1000000000", False),
            ("123456789 987654321", "1111111110", False),
            ("500000000 500000000", "1000000000", False),
            ("7 3", "10", False),
            ("42 58", "100", False),
        ],
    },
    {
        "title": "Even or Odd",
        "description": "Given an integer N, print EVEN if it is even, otherwise print ODD.",
        "input_format": "A single integer N.",
        "output_format": "Print EVEN or ODD.",
        "constraints": "1 <= N <= 10^9",
        "difficulty": "EASY",
        "rating": 900,
        "avg_solving_time": 45,
        "test_cases": [
            ("4", "EVEN", True),
            ("7", "ODD", True),
            ("1000000000", "EVEN", False),
            ("1", "ODD", False),
            ("2", "EVEN", False),
            ("999999999", "ODD", False),
            ("100", "EVEN", False),
            ("13", "ODD", False),
            ("256", "EVEN", False),
            ("777", "ODD", False),
        ],
    },
    {
        "title": "FizzBuzz",
        "description": (
            "Given N, for each number from 1 to N print Fizz if divisible by 3, "
            "Buzz if divisible by 5, FizzBuzz if both, else the number."
        ),
        "input_format": "A single integer N.",
        "output_format": "N lines of output.",
        "constraints": "1 <= N <= 1000",
        "difficulty": "MEDIUM",
        "rating": 1200,
        "avg_solving_time": 120,
        "test_cases": [
            ("5", "1\n2\nFizz\n4\nBuzz", True),
            ("3", "1\n2\nFizz", True),
            (
                "15",
                "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz",
                False,
            ),
            ("1", "1", False),
            ("6", "1\n2\nFizz\n4\nBuzz\nFizz", False),
            ("10", "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz", False),
            ("2", "1\n2", False),
            ("9", "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz", False),
            (
                "20",
                "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\n"
                "FizzBuzz\n16\n17\nFizz\n19\nBuzz",
                False,
            ),
            ("4", "1\n2\nFizz\n4", False),
        ],
    },
    {
        "title": "Reverse a String",
        "description": "Given a string S, print it reversed.",
        "input_format": "A single string S with no spaces.",
        "output_format": "Print the reversed string.",
        "constraints": "1 <= |S| <= 10^5",
        "difficulty": "MEDIUM",
        "rating": 1400,
        "avg_solving_time": 90,
        "test_cases": [
            ("hello", "olleh", True),
            ("abcd", "dcba", True),
            ("a", "a", False),
            ("racecar", "racecar", False),
            ("python", "nohtyp", False),
            ("openai", "ianepo", False),
            ("z", "z", False),
            ("abcdefgh", "hgfedcba", False),
            ("madam", "madam", False),
            ("coding", "gnidoc", False),
        ],
    },
    {
        "title": "Count Pairs with Given Sum",
        "description": (
            "Given an array of N integers and a target sum K, count the number of "
            "pairs (i, j) where i < j and arr[i] + arr[j] = K."
        ),
        "input_format": (
            "First line: two integers N and K. Second line: N space-separated integers."
        ),
        "output_format": "Print a single integer, the count of valid pairs.",
        "constraints": "1 <= N <= 10^4, -10^9 <= arr[i] <= 10^9",
        "difficulty": "HARD",
        "rating": 1600,
        "avg_solving_time": 300,
        "test_cases": [
            ("5 9\n1 2 3 4 5", "2", True),
            ("4 6\n1 5 3 3", "2", True),
            ("3 10\n1 2 3", "0", False),
            ("6 0\n-1 1 -2 2 -3 3", "3", False),
            ("5 5\n1 4 2 3 0", "2", False),
            ("4 8\n4 4 4 4", "6", False),
            ("5 1\n0 1 0 1 0", "4", False),
            ("3 -1\n-2 1 0", "1", False),
            ("6 10\n5 5 5 5 5 5", "15", False),
            ("2 1000000000\n500000000 500000000", "1", False),
        ],
    },
]


def seed_problems(db: Session) -> int:
    """Insert the seed problems if the table is empty; return how many landed.

    Returns 0 on the skip path, which is what every boot after the first takes.
    """
    existing = db.execute(select(func.count()).select_from(Problem)).scalar_one()
    if existing > 0:
        logger.info("Seeder skipped: problems table already holds %d rows", existing)
        return 0

    for spec in SEED_PROBLEMS:
        cases: list[_Case] = spec["test_cases"]
        problem = Problem(
            **{k: v for k, v in spec.items() if k != "test_cases"},
            test_cases=[
                TestCase(input=i, expected_output=o, is_sample=s) for i, o, s in cases
            ],
        )
        db.add(problem)

    db.commit()
    logger.info(
        "Seeded %d problems, %d test cases",
        len(SEED_PROBLEMS),
        sum(len(p["test_cases"]) for p in SEED_PROBLEMS),
    )
    return len(SEED_PROBLEMS)
