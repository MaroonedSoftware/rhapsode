"""Fish Audio S2 Pro for rhapsode: eighty languages and free-form direction, on research-only weights."""

from .builds import CUE_TAGS, CUES, LANGUAGES, variants
from .prompt import line, segments, translate_cues

__all__ = ["CUES", "CUE_TAGS", "LANGUAGES", "line", "segments", "translate_cues", "variants"]
