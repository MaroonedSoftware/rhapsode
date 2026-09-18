"""A rhapsode engine with no weights.

It exists to prove the protocol rather than to make speech, which is exactly why it is useful: it
loads in microseconds, needs no GPU, downloads nothing, and can therefore run in CI on every commit.
Every worker rule has to hold for this engine too, so it is the conformance fixture and will stay
one long after there are real engines beside it.
"""

from .engine import ToneEngine

__all__ = ["ToneEngine"]
