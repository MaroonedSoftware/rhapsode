"""StyleTTS 2 for rhapsode: zero-shot cloning from a few seconds of audio, with no transcript."""

from .builds import STOCK, variants
from .engine import StyleTTS2Engine

__all__ = ["STOCK", "StyleTTS2Engine", "variants"]
