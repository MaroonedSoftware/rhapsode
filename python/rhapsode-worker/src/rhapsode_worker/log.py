"""Structured logging to stderr, one JSON object per line. protocol.md § 2.

The core reads these lines and forwards them into its own logger with the engine id attached, so
the shape matters more than the prettiness. Anything that is not JSON still reaches the operator:
the core passes unparseable lines through at warn, which is what makes torch's and CUDA's own
warnings visible when a load fails.
"""

from __future__ import annotations

import json
import sys
import threading
import traceback
from typing import Any

LEVELS = ("error", "warn", "info", "debug", "trace")

#: Keys the record owns. A field of the same name is kept, suffixed, rather than dropped.
RESERVED = frozenset({"level", "engine", "message"})


class Log:
    """A logger that writes JSON lines to the real stderr, whatever anybody did to sys.stderr."""

    def __init__(self, engine: str, level: str = "info") -> None:
        self.engine = engine
        self.level = level if level in LEVELS else "info"
        self._lock = threading.Lock()

    def _enabled(self, level: str) -> bool:
        return LEVELS.index(level) <= LEVELS.index(self.level)

    def _emit(self, level: str, message: str, /, **fields: Any) -> None:
        if not self._enabled(level):
            return

        # An exception serialises to something a reader can act on. str(Exception) is often empty,
        # and a bare repr loses the traceback that says where it came from.
        error = fields.pop("error", None)
        if isinstance(error, BaseException):
            fields["error"] = {
                "type": type(error).__name__,
                "message": str(error),
                "traceback": "".join(traceback.format_exception(error)).strip(),
            }
        elif error is not None:
            fields["error"] = error

        # The record's own keys are authoritative, because a logger that loses the line it was
        # asked to write is worse than one that renames a field. A collision is kept rather than
        # dropped: a caller passing `message=` meant something by it, and silently discarding it
        # would be the same failure this file exists to avoid in the other direction.
        record: dict[str, Any] = {}
        for key, value in fields.items():
            record[f"{key}_" if key in RESERVED else key] = value
        record["level"] = level
        record["engine"] = self.engine
        record["message"] = message
        try:
            line = json.dumps(record, separators=(",", ":"), default=repr)
        except (TypeError, ValueError):
            line = json.dumps({"level": level, "engine": self.engine, "message": message})

        stream = sys.__stderr__ or sys.stderr
        with self._lock:
            stream.write(line + "\n")
            stream.flush()

    def error(self, message: str, /, **fields: Any) -> None:
        self._emit("error", message, **fields)

    def warn(self, message: str, /, **fields: Any) -> None:
        self._emit("warn", message, **fields)

    def info(self, message: str, /, **fields: Any) -> None:
        self._emit("info", message, **fields)

    def debug(self, message: str, /, **fields: Any) -> None:
        self._emit("debug", message, **fields)

    def trace(self, message: str, /, **fields: Any) -> None:
        self._emit("trace", message, **fields)
