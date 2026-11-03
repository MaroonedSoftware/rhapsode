"""Phonon's builds: which repository each one is, which voices it speaks, and how they arrive."""

from __future__ import annotations

import json
import os
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from rhapsode_worker import Internal

#: What the runtime reads, and nothing else in the repository, which also holds the q4k weights and the
#: safetensors the Transformers route loads.
CHECKPOINT_FILES: tuple[str, ...] = (
    "config.json",
    "tokenizer.json",
    "default-voice.safetensors",
    "model.q8.gguf",
)

#: Where the voices live, apart from every checkpoint. Apache-2.0 and ungated, and 2,247 files, most
#: of them audio samples, so a download names the voices it wants rather than taking the repository.
VOICES_REPOSITORY = "gradium/phonon-voices"

#: The revision `voices.jsonl` beside this file was copied from. Pinned together, because the table
#: says which file a voice is, and a voice whose file changed is a different rendering.
VOICES_REVISION = "0ee17205f254b5abc43b266c8a0f215565c352f7"


@dataclass(frozen=True)
class Build:
    repository: str
    #: Pinned, so an upstream push cannot change the voice under a caller who changed nothing.
    revision: str
    languages: tuple[str, ...]


#: Apache-2.0 and ungated.
OPEN_BUILDS: dict[str, Build] = {
    "31m": Build(
        repository="gradium/phonon-31m-en",
        revision="92741c5b07d085ff840e26fea8ce43110b87852f",
        languages=("en",),
    ),
}

#: CC BY-NC 4.0 and gated, so a separate engine rather than more variants of the one above: a licence
#: belongs to an engine (protocol.md § 4), and a variant cannot carry one of its own.
#:
#: Named for what they speak, so `phonon-40m:de` reads as what it is in the OpenAI shim's `model`.
GATED_BUILDS: dict[str, Build] = {
    "multilingual": Build(
        repository="gradium/phonon-40m-multilingual",
        revision="1537ce46c64f42903e0d608b132ccb073dac46d2",
        languages=("en", "fr", "de", "es", "pt"),
    ),
    "en": Build(
        repository="gradium/phonon-40m-en",
        revision="bc7e8ae7e543a7a3e4604753e42fbda76ddf0781",
        languages=("en",),
    ),
    "fr": Build(
        repository="gradium/phonon-40m-fr",
        revision="d91086970206b88efd2c88ca971d0628b5968f0f",
        languages=("fr",),
    ),
    "de": Build(
        repository="gradium/phonon-40m-de",
        revision="79cfc7b47fcfc0b666657b981eb366415023a862",
        languages=("de",),
    ),
    "es": Build(
        repository="gradium/phonon-40m-es",
        revision="e5e052b26e31abd5918ade71d3135e69d51a66f8",
        languages=("es",),
    ),
    "pt": Build(
        repository="gradium/phonon-40m-pt",
        revision="4cbfd742a1555d60eb5399c6d296e9f2e07389e9",
        languages=("pt",),
    ),
}


@dataclass(frozen=True)
class CatalogVoice:
    id: str
    name: str
    file: str
    language: str
    locale: str
    gender: str | None
    description: str


def voice_id(name: str) -> str:
    """A catalog name as a voice id: accents dropped, and anything else § 7 refuses made a hyphen.

    Upstream's names are not ids. `The Thing Under the Stairs` has spaces and `Lucía-Sol` an accent,
    and `check_voice_id` refuses both before an adapter is asked. Upstream's own `voice_id` would pass,
    but `NbpkqMVS3CJeq2j8` is not something anybody can type from memory, and Zoey stays `Zoey`.
    """
    decomposed = unicodedata.normalize("NFKD", name)
    plain = "".join(character for character in decomposed if not unicodedata.combining(character))
    return "".join(character if character.isascii() and character.isalnum() else "-" for character in plain)


@lru_cache(maxsize=1)
def catalog() -> tuple[CatalogVoice, ...]:
    """Every voice upstream publishes, read from the copy in this package.

    Copied rather than fetched, so that listing voices needs no network and no token, and a box that
    has never been online can still say what an install would give it.
    """
    lines = Path(__file__).with_name("voices.jsonl").read_text(encoding="utf-8").splitlines()
    return tuple(
        CatalogVoice(
            id=voice_id(entry["name"]),
            name=entry["name"],
            file=entry["filename"],
            language=entry["language"],
            locale=entry["locale"],
            gender=entry["gender"],
            description=entry["description"],
        )
        for entry in map(json.loads, lines)
        if entry
    )


def voices_for(build: Build) -> tuple[CatalogVoice, ...]:
    """The catalog's voices in the languages this build was trained on.

    The catalog holds German and Spanish voices too, and the English model would read English in them
    or mangle German with them. Claiming them would be a voice that fails the listener rather than
    the request, which nothing downstream could catch.
    """
    return tuple(voice for voice in catalog() if voice.language in build.languages)


def ensure(build: Build) -> tuple[Path, dict[str, Path]]:
    """A build's checkpoint directory and its voices' files, downloading whichever are missing."""
    from huggingface_hub import snapshot_download
    from huggingface_hub.utils import HfHubHTTPError

    # None rather than an empty string, because None is what falls back to the saved login. That is
    # the route for a gated build: naming an engine in the operator's file, even for only its `env`,
    # makes it the operator's, and an install of it is then refused. protocol.md § 10.
    token = os.getenv("HF_TOKEN") or None
    try:
        checkpoint = snapshot_download(
            repo_id=build.repository,
            revision=build.revision,
            allow_patterns=list(CHECKPOINT_FILES),
            token=token,
        )
    except HfHubHTTPError as error:
        if error.response.status_code not in (401, 403):
            raise
        # Internal rather than Unsupported, which an install reads as "this engine does not download
        # ahead of time" and carries on from, leaving the failure for the first request to find.
        raise Internal(
            f"{build.repository} is gated. Accept its terms at https://huggingface.co/{build.repository}, "
            "then run `hf auth login` as the user the server runs as, or write a token to "
            "~/.cache/huggingface/token."
        ) from error
    voices = voices_for(build)
    root = Path(
        snapshot_download(
            repo_id=VOICES_REPOSITORY,
            revision=VOICES_REVISION,
            allow_patterns=[voice.file for voice in voices],
            token=token,
        )
    )
    return Path(checkpoint), {voice.id: root / voice.file for voice in voices}
