"""Dia for rhapsode: two speakers in one pass, and nonverbals written where they happen."""

from .builds import CUE_TAGS, CUES, NATIVE_TAGS, variants
from .prompt import line, segments, translate_cues

__all__ = ["CUES", "CUE_TAGS", "NATIVE_TAGS", "line", "segments", "translate_cues", "variants"]
