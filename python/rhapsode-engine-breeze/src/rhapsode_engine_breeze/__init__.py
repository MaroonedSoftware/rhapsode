"""Breeze TTS 2 for rhapsode: the top open-weight model on the speech arena, on research-only weights."""

from .builds import CUE_TAGS, CUES, NATIVE_TAGS_EN, NATIVE_TAGS_ZH, variants
from .prompt import segments, translate_cues

__all__ = ["CUES", "CUE_TAGS", "NATIVE_TAGS_EN", "NATIVE_TAGS_ZH", "segments", "translate_cues", "variants"]
