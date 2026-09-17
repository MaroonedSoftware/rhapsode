"""`rhapsode-conform <worker>`. Point it at a worker and it says whether that worker is one."""

from __future__ import annotations

import argparse
import sys

from .checks import Report, run
from .client import Worker

GREEN = "\033[32m"
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
    arguments = parser.parse_args(argv)

    with Worker(arguments.target) as worker:
        report = run(worker)

    _print(report, quiet=arguments.quiet, colour=not arguments.no_colour and sys.stdout.isatty())
    return 0 if report.ok else 1


def _print(report: Report, *, quiet: bool, colour: bool) -> None:
    green, red, dim, reset = (GREEN, RED, DIM, RESET) if colour else ("", "", "", "")

    for result in report.results:
        if result.passed and quiet:
            continue
        mark = f"{green}ok{reset}" if result.passed else f"{red}FAIL{reset}"
        detail = f"  {dim}{result.detail}{reset}" if result.detail else ""
        print(f"  {mark:>6}  {result.name} {dim}[{result.section}]{reset}{detail}")

    passed = len(report.results) - len(report.failures)
    print()
    if report.ok:
        print(f"{green}{passed} checks passed.{reset} This worker speaks the contract.")
    else:
        print(f"{red}{len(report.failures)} of {len(report.results)} checks failed.{reset}")


if __name__ == "__main__":
    raise SystemExit(main())
