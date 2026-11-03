"""Phonon's 40M builds as a rhapsode engine of their own. `python -m rhapsode_engine_phonon.forty`.

The same runtime, file layout and adapter as `phonon`. What differs is the licence, and a licence
belongs to an engine: as variants of `phonon`, either a commercial user would be told the Apache-2.0
build is non-commercial, or an install of these would accept nothing. protocol.md § 4.
"""

from __future__ import annotations

from typing import Any, ClassVar

from rhapsode_worker import serve

from . import builds
from .engine import PhononEngine


class Phonon40mEngine(PhononEngine):
    id = "phonon-40m"
    display_name = "Phonon 40M"

    license: ClassVar[dict[str, Any]] = {
        "code": "MIT OR Apache-2.0",
        "weights": "CC-BY-NC-4.0",
        "weights_commercial_use": False,
        "notes": (
            "https://huggingface.co/gradium/phonon-40m-multilingual, run through ptts. Non-commercial use "
            "only. Gated: accept the terms on each build's Hugging Face page and log in on this machine. "
            "Upstream asks that it not be used to impersonate a real person or deceive listeners about "
            "who is speaking. On Linux and Windows x86_64 the runtime needs a CPU with AVX2."
        ),
    }

    # multilingual, so that one download speaks all five and `language` does what it says. A build for
    # one language reads it better, German 2097 Elo against 2046 on Gradium's own listening tests, and
    # a client that wants that names it: `phonon-40m:de` in the OpenAI shim's `model`.
    default_variant = "multilingual"
    BUILDS: ClassVar[dict[str, builds.Build]] = builds.GATED_BUILDS


if __name__ == "__main__":
    serve(Phonon40mEngine())
