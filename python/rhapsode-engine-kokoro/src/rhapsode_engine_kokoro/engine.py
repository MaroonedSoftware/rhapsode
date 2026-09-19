"""Kokoro as a rhapsode engine, through ONNX and on the CPU. protocol.md § 8.

The first engine here with no torch in it, and the one § 8's decision was made for: ONNX engines are
workers like any other, so this is an ordinary adapter and the core learns nothing new.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any, ClassVar

from rhapsode_worker import (
    BadRequest,
    BlendRequest,
    CreateVoiceRequest,
    Engine,
    Internal,
    NativeFormat,
    SpeakRequest,
    UnknownVoice,
    Unsupported,
    Variant,
    Voice,
)

from . import styles, weights

#: Kokoro's rate, for every variant.
SAMPLE_RATE = 24_000

#: 100 ms, the same slice the Chatterbox adapter hands the SDK, for the same reason: it is what "how
#: much audio is in flight" means to the SDK's bounded queue.
CHUNK_SAMPLES = SAMPLE_RATE // 10

#: What kokoro-onnx puts between sentences inside one call. Spoken sentence by sentence (see `speak`),
#: the gap has to be put back by hand or the sentences run together.
SENTENCE_PAUSE_SAMPLES = SAMPLE_RATE // 4

#: A group of sentences synthesised in one call. Small enough that the first audio leaves quickly,
#: large enough that a run of short sentences is not a call each.
GROUP_CHARACTERS = 200

#: eSpeak NG copies its data path into a 160-byte buffer. At 160 characters or more it silently falls
#: back to the path compiled into the library, finds nothing there, and calls exit(1), which ends the
#: worker with no exception for Python to catch (measured with espeakng-loader 0.2.4: 159 works, 160
#: exits). kokoro-onnx's own copy of the data sits inside the venv, so a deep venv is enough.
ESPEAK_PATH_LIMIT = 159

DEFAULT_VOICE = "af_heart"

#: The English voices in voices-v1.0.bin: 28 of its 54. The first letter is the accent and the second
#: the voice's sex, which is Kokoro's own naming. The rest are other languages, which this adapter does
#: not claim yet, because § 6's `language` has to be decided against a voice that has one of its own.
ENGLISH_VOICES: tuple[str, ...] = (
    "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore", "af_nicole", "af_nova",
    "af_river", "af_sarah", "af_sky",
    "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck",
    "am_santa",
    "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
    "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
)  # fmt: skip

ACCENTS = {"a": ("en-us", "American"), "b": ("en-gb", "British")}
SEXES = {"f": "female", "m": "male"}

SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def _installed_kokoro_onnx() -> str | None:
    try:
        from importlib.metadata import version

        return version("kokoro-onnx")
    except Exception:
        return None


class KokoroEngine(Engine):
    id = "kokoro"
    display_name = "Kokoro"

    # The code licence is what the process runs, not what this package is (§ 4). kokoro-onnx is MIT,
    # and it turns text into phonemes through phonemizer and eSpeak NG, which are GPL-3.0-or-later.
    license: ClassVar[dict[str, Any]] = {
        "code": "GPL-3.0-or-later",
        "weights": "Apache-2.0",
        "weights_commercial_use": True,
        "notes": (
            "GPL through phonemizer and eSpeak NG, which kokoro-onnx (MIT) phonemizes with. "
            "Weights: hexgrad/Kokoro-82M, Apache-2.0."
        ),
    }

    native_format = NativeFormat(encoding="pcm_s16le", sample_rate=SAMPLE_RATE, channels=1)
    default_variant = "fp16"
    concurrency = 1
    max_characters = 4096
    upstream_version = _installed_kokoro_onnx()

    _model: Any = None

    # ------------------------------------------------------------------ what this engine can do

    def variants(self) -> dict[str, Variant]:
        # Three precisions of one model, so they claim the same things. `speed` is the only control
        # the graph takes, and kokoro-onnx refuses anything outside 0.5 to 2.0.
        claims = Variant(cues=(), deliveries=(), dials={"speed": (0.5, 2.0, 1.0)}, languages=("en",))
        return {name: claims for name in weights.MODELS}

    # ------------------------------------------------------------------ residency

    def load(self, variant: str) -> None:
        """Bring one precision into memory, downloading it first if it has never been fetched."""
        from kokoro_onnx import EspeakConfig, Kokoro

        model, voices = weights.ensure(variant)
        self._model = Kokoro(
            str(model), str(voices), espeak_config=EspeakConfig(data_path=espeak_data_path())
        )

    def fetch(self, variant: str) -> None:
        weights.ensure(variant)

    def unload(self) -> None:
        self._model = None

    # ------------------------------------------------------------------ voices

    def voices(self) -> list[Voice]:
        variant = self.variant or self.default_variant
        built_in = [_voice(name, variant) for name in ENGLISH_VOICES]
        return built_in + [self._created(path, variant) for path in self._stored()]

    def reference_seconds(self) -> tuple[float, float] | None:
        # A Kokoro reference is a style vector, not audio, so it has no length to advise on.
        return None

    def reference_formats(self) -> tuple[str, ...]:
        return ("npy", "pt")

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        """Keep an uploaded style vector: how a voicepack outside voices-v1.0.bin arrives."""
        self._refuse_built_in(request.id)
        suffix = Path(request.filename).suffix.lower().lstrip(".") if request.filename else ""
        style = styles.read_style(request.reference, suffix)
        source = Path(request.filename or "").name
        path = self._store(request.id, style, {"source": source, "lang": _accent_of(Path(source).stem)})
        return self._created(path, self.variant or self.default_variant, label=request.label)

    def blend_voice(self, request: BlendRequest) -> Voice:
        """Mix the components' style vectors in their shares, now, and keep the result.

        The accent is the heaviest component's. Kokoro phonemizes with one language per call, and a
        mix of a British and an American voice has to be read in one of them.
        """
        self._refuse_built_in(request.id)
        # Every part is read before anything is written, so a blend that names the voice it replaces
        # mixes the old one rather than finding it gone.
        parts = [(self._style_of(name), share) for name, share in request.components]
        heaviest = max(request.components, key=lambda component: component[1])[0]
        lang = self._language_of(heaviest)
        path = self._store(request.id, styles.mix(parts), {"recipe": request.recipe, "lang": lang})
        return self._created(path, self.variant or self.default_variant, label=request.label)

    def delete_voice(self, voice_id: str) -> None:
        if voice_id in ENGLISH_VOICES:
            raise Unsupported(f'"{voice_id}" is one of Kokoro\'s own voices and cannot be deleted')
        self._stored_path(voice_id).unlink()

    def _refuse_built_in(self, voice_id: str) -> None:
        # Refused rather than stored: `speak` resolves a built-in name first, so a created voice
        # with one would be kept, listed twice, and never heard.
        if voice_id in ENGLISH_VOICES:
            raise BadRequest(f'"{voice_id}" is one of Kokoro\'s own voices; choose another id')

    def _store(self, voice_id: str, style: Any, meta: dict[str, str]) -> Path:
        self.voice_dir.mkdir(parents=True, exist_ok=True)
        path = self.voice_dir / f"{voice_id}{styles.SUFFIX}"
        styles.save(path, style, meta)
        return path

    def _stored(self) -> list[Path]:
        if not self.voice_dir.is_dir():
            return []
        return sorted(
            path for path in self.voice_dir.iterdir() if path.suffix == styles.SUFFIX and path.is_file()
        )

    def _stored_path(self, voice_id: str) -> Path:
        """A created voice's file. `path_for` matches any stem, and only a `.npz` is a voice here."""
        path = self.path_for(voice_id)
        if path.suffix != styles.SUFFIX:
            raise UnknownVoice(f'no voice "{voice_id}"')
        return path

    def _style_of(self, voice: str) -> Any:
        """A voice's style vector, built in or created, without loading the model."""
        if voice in ENGLISH_VOICES:
            import numpy as np

            with np.load(weights.ensure_voices(), allow_pickle=False) as pack:
                return pack[voice]
        return styles.load(self._stored_path(voice))[0]

    def _language_of(self, voice: str) -> str:
        if voice in ENGLISH_VOICES:
            return ACCENTS[voice[0]][0]
        return styles.load(self._stored_path(voice))[1]["lang"]

    def _created(self, path: Path, variant: str, label: str | None = None) -> Voice:
        style, meta = styles.load(path)
        digest = hashlib.sha256(style.tobytes()).hexdigest()[:12]
        made = "blended" if "recipe" in meta else "uploaded"
        description = f"Blended from {meta['recipe']}" if made == "blended" else f"From {meta['source']}"
        return Voice(
            id=path.stem,
            label=label or path.stem.replace("_", " ").title(),
            description=description,
            # The vector's hash rather than the recipe, because re-blending the same recipe after a
            # component was re-uploaded renders differently. And the precision, as for the built-ins.
            spec=f"{path.stem}@{digest}-{variant}",
            tags=("en", meta["lang"], made),
        )

    # ------------------------------------------------------------------ speaking

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        """Sentence groups, one call each, so the first audio leaves before the last is made.

        kokoro-onnx's `create` returns a whole waveform. A 4096-character request is about four and a
        half minutes of audio, which at the 2.5x realtime int8 managed here is 110 s before the first
        byte, against the core's 120 s wait for headers. Speaking a group at a time makes the wait the
        length of the first group instead.
        """
        name = request.voice or DEFAULT_VOICE
        voice: Any
        if name in ENGLISH_VOICES:
            voice, language = name, ACCENTS[name[0]][0]
        else:
            # A created voice goes to kokoro-onnx as its array, which `create` takes in place of a
            # name. The file is read here, before the model check, so an unknown id is `unknown_voice`
            # whatever is resident.
            voice, meta = styles.load(self._stored_path(name))
            language = meta["lang"]
        if self._model is None:
            raise Unsupported("no model is loaded")

        speed = self.dials_for(request)["speed"]

        for index, group in enumerate(sentence_groups(request.text)):
            if index > 0:
                yield bytes(SENTENCE_PAUSE_SAMPLES * 2)
            audio, _ = self._model.create(group, voice=voice, speed=speed, lang=language)
            yield from chunked_pcm(audio)


def espeak_data_path() -> str:
    """kokoro-onnx's own eSpeak NG data, refused here if eSpeak would exit the process over it."""
    import espeakng_loader

    path = str(espeakng_loader.get_data_path())
    if len(path) > ESPEAK_PATH_LIMIT:
        raise Internal(
            f"eSpeak NG's data is at a path {len(path)} characters long and eSpeak exits the process "
            f"above {ESPEAK_PATH_LIMIT}: {path}. Install this engine's virtualenv somewhere shorter "
            "(install.venvDir)."
        )
    return path


def sentence_groups(text: str, limit: int = GROUP_CHARACTERS) -> Iterator[str]:
    """Whole sentences, gathered until the next would pass `limit`. A longer sentence goes alone."""
    group = ""
    for sentence in SENTENCE_END.split(text.strip()):
        if group and len(group) + 1 + len(sentence) > limit:
            yield group
            group = sentence
        else:
            group = f"{group} {sentence}" if group else sentence
    if group:
        yield group


def _accent_of(stem: str) -> str:
    """Kokoro's own naming, where an uploaded pack keeps it: `bm_` is British. American otherwise.

    From the name rather than the vector, because nothing in 510 x 256 floats says which phonemizer
    the voice was trained against, and Kokoro-FastAPI names every pack it ships this way.
    """
    if len(stem) > 2 and stem[0] in ACCENTS and stem[1] in SEXES and stem[2] == "_":
        return ACCENTS[stem[0]][0]
    return ACCENTS["a"][0]


def _voice(name: str, variant: str) -> Voice:
    _, accent = ACCENTS[name[0]]
    sex = SEXES[name[1]]
    return Voice(
        id=name,
        label=name[3:].title(),
        description=f"{accent} English, {sex}",
        # The rendering changes with the voice, the weights release and the precision, and with
        # nothing else this adapter controls.
        spec=f"{name}@v1.0-{variant}",
        tags=("en", ACCENTS[name[0]][0], sex),
    )


def chunked_pcm(waveform: Any, chunk_samples: int = CHUNK_SAMPLES) -> Iterator[bytes]:
    """A float waveform in [-1, 1] as little-endian signed 16-bit PCM, clipped before it is scaled.

    Clipped first because a sample slightly outside the range wraps to full scale of the other sign
    once it is an integer, and a moment of loudness becomes a click.
    """
    import numpy as np

    samples = np.asarray(waveform, dtype=np.float32).reshape(-1)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    for start in range(0, pcm.size, chunk_samples):
        block = pcm[start : start + chunk_samples]
        if block.size:
            yield block.tobytes()
