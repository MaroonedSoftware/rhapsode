"""`rhapsode-conform <worker>`. Point it at a worker and it says whether that worker is one."""

from __future__ import annotations

import argparse
import sys

from .checks import Report, run
from .client import Worker

GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
DIM = "\033[2m"
RESET = "\033[0m"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="rhapsode-conform",
        description="Check a running worker against docs/protocol.md.",
    )
    parser.add_argument(
        "target",
        help="unix:/run/rhapsode/workers/tone.sock, tcp:127.0.0.1:9310, or http://gpu-02.lan:9310",
    )
    parser.add_argument("--quiet", action="store_true", help="only print failures")
    parser.add_argument("--no-colour", action="store_true", help="plain output, for a log")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="treat a check that could not be decided as a failure",
    )
    arguments = parser.parse_args(argv)

    with Worker(arguments.target) as worker:
        report = run(worker)

    _print(report, quiet=arguments.quiet, colour=not arguments.no_colour and sys.stdout.isatty())
    if not report.ok:
        return 1
    return 1 if arguments.strict and report.skipped else 0


def _print(report: Report, *, quiet: bool, colour: bool) -> None:
    green, yellow, red, dim, reset = (GREEN, YELLOW, RED, DIM, RESET) if colour else ("", "", "", "", "")

    for result in report.results:
        if result.passed and quiet:
            continue
        if result.passed:
            mark = f"{green}ok{reset}"
        elif result.skipped:
            mark = f"{yellow}skip{reset}"
        else:
            mark = f"{red}FAIL{reset}"
        detail = f"  {dim}{result.detail}{reset}" if result.detail else ""
        print(f"  {mark:>6}  {result.name} {dim}[{result.section}]{reset}{detail}")

    passed = len(report.results) - len(report.failures) - len(report.skipped)
    print()
    if not report.ok:
        print(f"{red}{len(report.failures)} of {len(report.results)} checks failed.{reset}")
    elif report.skipped:
        # Said on its own line and not folded into the pass count, because the skipped checks are
        # the honesty checks, and "passed" would be exactly the claim they could not support.
        print(
            f"{green}{passed} checks passed{reset}, {yellow}{len(report.skipped)} could not be decided{reset}. "
            "Nothing failed, but the undecided checks are the ones about whether a claimed cue or delivery "
            "is actually performed: listen to those yourself."
        )
    else:
        print(f"{green}{passed} checks passed.{reset} This worker speaks the contract.")


if __name__ == "__main__":
    raise SystemExit(main())
