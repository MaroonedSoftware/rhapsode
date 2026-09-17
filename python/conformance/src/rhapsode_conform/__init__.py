"""Point it at a worker and it says whether that worker is one.

An engine author runs this before opening a pull request. It talks HTTP and nothing else, so it
works the same against a worker on a unix socket, a worker on another machine, and an engine written
in a language this project has never heard of.
"""

from .checks import Report, Result, run
from .client import Worker

__all__ = ["Report", "Result", "Worker", "run"]
