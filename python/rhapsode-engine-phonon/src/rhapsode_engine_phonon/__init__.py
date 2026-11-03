"""Phonon for rhapsode: streaming speech on the CPU, with no torch."""

from .engine import DEFAULT_VOICE, PhononEngine, chunked_pcm

__all__ = ["DEFAULT_VOICE", "PhononEngine", "chunked_pcm"]
