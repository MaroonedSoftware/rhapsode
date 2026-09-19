"""The blend recipe: `name(weight)+name(weight)`. protocol.md § 7.

Parsed here rather than in each adapter because the syntax is the contract's, and two adapters
parsing it two ways is two dialects of one field. What a blend MEANS is the adapter's: Kokoro
averages style vectors, the tone engine averages pitches.
"""

from __future__ import annotations

import math
import re

from .engine import check_voice_id
from .errors import BadRequest

#: One component: a name, then an optional weight in parentheses. Kokoro-FastAPI's syntax, because
#: that is what an operator coming from it already has typed into a config.
COMPONENT = re.compile(r"^\s*([^()+\s]+)\s*(?:\(\s*([^()]*?)\s*\))?\s*$")


def parse_blend(recipe: str) -> tuple[tuple[str, float], ...]:
    """Each voice and its share, the shares normalised to sum to 1.

    Strict, because a recipe that half-parses is a voice that sounds half like what was asked for,
    and nothing downstream could say why. A repeated name is refused rather than summed: it is
    nearly always a typo for a different voice.
    """
    if not recipe.strip():
        raise BadRequest("`blend` is empty")

    parsed: list[tuple[str, float]] = []
    for part in recipe.split("+"):
        match = COMPONENT.fullmatch(part)
        if match is None:
            raise BadRequest(f'`blend` part "{part.strip()}" is not `name` or `name(weight)`')
        name, weight_text = match.group(1), match.group(2)
        check_voice_id(name)
        weight = _weight(name, weight_text)
        if any(existing == name for existing, _ in parsed):
            raise BadRequest(f'`blend` names "{name}" twice')
        parsed.append((name, weight))

    total = sum(weight for _, weight in parsed)
    return tuple((name, weight / total) for name, weight in parsed)


def _weight(name: str, text: str | None) -> float:
    if text is None:
        return 1.0
    try:
        weight = float(text)
    except ValueError:
        raise BadRequest(f'`blend` weight for "{name}" is not a number: "{text}"') from None
    if not math.isfinite(weight) or weight <= 0:
        raise BadRequest(f'`blend` weight for "{name}" must be a positive number, not {text}')
    return weight
