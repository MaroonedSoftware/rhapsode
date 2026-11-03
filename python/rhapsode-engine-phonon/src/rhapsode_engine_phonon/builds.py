"""Phonon's builds: which repository each one is, which voices it speaks, and how they arrive."""

from __future__ import annotations

import json
import os
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from rhapsode_worker import Unsupported

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


BUILDS: dict[str, Build] = {
    "31m": Build(
        repository="gradium/phonon-31m-en",
        revision="92741c5b07d085ff840e26fea8ce43110b87852f",
        languages=("en",),
    ),
}

DEFAULT_BUILD = "31m"


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


def build_of(variant: str) -> Build:
    build = BUILDS.get(variant)
    if build is None:
        raise Unsupported(f'no build "{variant}"; this engine has {sorted(BUILDS)}')
    return build


def voices_for(variant: str) -> tuple[CatalogVoice, ...]:
    """The catalog's voices in the languages this build was trained on.

    The catalog holds German and Spanish voices too, and the English model would read English in them
    or mangle German with them. Claiming them would be a voice that fails the listener rather than
    the request, which nothing downstream could catch.
    """
    languages = build_of(variant).languages
    return tuple(voice for voice in catalog() if voice.language in languages)


def ensure(variant: str) -> tuple[Path, dict[str, Path]]:
    """A build's checkpoint directory and its voices' files, downloading whichever are missing."""
    from huggingface_hub import snapshot_download

    build = build_of(variant)
    token = os.getenv("HF_TOKEN") or None
    checkpoint = snapshot_download(
        repo_id=build.repository,
        revision=build.revision,
        allow_patterns=list(CHECKPOINT_FILES),
        token=token,
    )
    voices = voices_for(variant)
    root = Path(
        snapshot_download(
            repo_id=VOICES_REPOSITORY,
            revision=VOICES_REVISION,
            allow_patterns=[voice.file for voice in voices],
            token=token,
        )
    )
    return Path(checkpoint), {voice.id: root / voice.file for voice in voices}
