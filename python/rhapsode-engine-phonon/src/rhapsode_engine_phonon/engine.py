"""Phonon as a rhapsode engine, through Gradium's Rust runtime and on the CPU. protocol.md § 8."""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any, ClassVar

from rhapsode_worker import (
    BadRequest,
    Engine,
    NativeFormat,
    SpeakRequest,
    UnknownVoice,
    Unsupported,
    Variant,
    Voice,
)

from . import builds

#: Phonon's rate, for every build.
SAMPLE_RATE = 24_000

#: 100 ms, the same slice the other adapters hand the SDK. The runtime's own chunks grow as a line
#: goes on, from 80 ms to about 900 ms, and the SDK's bounded queue counts chunks, not seconds.
CHUNK_SAMPLES = SAMPLE_RATE // 10

#: The checkpoint's own voice, which the runtime registers from `default-voice.safetensors`. It is what
#: a request naming no voice gets, here as in Ollama.
DEFAULT_VOICE = "default"

#: The 8-bit weights, the format Ollama's published figures give for this runtime on the CPU, and the
#: only one this adapter downloads.
QUANT = "q8"

#: The runtime defaults to every core, which is the slowest thing measured. On an M5 Pro with 18, for
#: an 8 s line, median of five: 57.6x realtime on 1 thread, 66.7x on 2, 75.0x on 4, 62.8x on 8 and 50.5x
#: on 18. Past 4 the threads wait on each other, and a CPU engine sharing a box with a GPU one has
#: better uses for the rest.
THREADS = 4

#: Upstream's `duration_delta` is a condition the model was trained on, not a time-stretch: negative
#: is faster, and on an 8.08 s line -0.5 gave 5.92 s and +0.5 gave 10.08 s. Past that it stops doing
#: anything (-1 gave 6.16 s and +1 gave 10.24 s), so the range is where it still moves. Not `speed`,
#: and so not what the OpenAI shim's `speed` reaches, because no ratio of it means "twice as fast".
#: `temperature` defaults to the runtime's own 0.3. It changes the take rather than the pace: the same
#: line was 8.08 s from 0.1 to 2, and 8.56 s at 0.
DIALS: dict[str, tuple[float, float, float]] = {
    "durationDelta": (-0.5, 0.5, 0.0),
    "temperature": (0.0, 1.0, 0.3),
}

_threads_set = False


def _installed_ptts() -> str | None:
    try:
        from importlib.metadata import version

        return version("ptts")
    except Exception:
        return None


class PhononEngine(Engine):
    id = "phonon"
    display_name = "Phonon"

    license: ClassVar[dict[str, Any]] = {
        "code": "MIT OR Apache-2.0",
        "weights": "Apache-2.0",
        "weights_commercial_use": True,
        "notes": (
            "https://huggingface.co/gradium/phonon-31m-en, run through ptts. The weights, tokenizer and "
            "voices are Apache-2.0. Upstream asks that it not be used to impersonate a real person or "
            "deceive listeners about who is speaking. On Linux and Windows x86_64 the runtime's wheels "
            "need a CPU with AVX2."
        ),
    }

    native_format = NativeFormat(encoding="pcm_s16le", sample_rate=SAMPLE_RATE, channels=1)
    default_variant = builds.DEFAULT_BUILD
    concurrency = 1
    # Ollama refuses past 4,096 for this model, and that much is about four and a half minutes of audio
    # which arrives in under five seconds. The first chunk leaves in about 10 ms however long the text
    # is, because the runtime streams, so nothing is won by the SDK splitting it. The runtime does its
    # own sentence splitting, and prosody does not carry across those joints; the README says so.
    upstream_version = _installed_ptts()

    _model: Any = None

    # ------------------------------------------------------------------ what this engine can do

    def variants(self) -> dict[str, Variant]:
        return {
            name: Variant(cues=(), deliveries=(), dials=DIALS, languages=build.languages)
            for name, build in builds.BUILDS.items()
        }

    # ------------------------------------------------------------------ residency

    def load(self, variant: str) -> None:
        """Bring one build into memory, downloading it first if it has never been fetched."""
        import ptts

        checkpoint, voices = builds.ensure(variant)
        _set_threads(ptts)
        # The CPU rather than `auto`, which would pick Metal on a Mac. Ollama's published comparison has
        # this runtime at 84x realtime on the CPU and 38x on Metal on an M5 Max.
        model = ptts.TTS(
            str(checkpoint), device="cpu", quant=QUANT, lang=builds.build_of(variant).languages[0]
        )
        # 0.26 ms each, so all of them now, and the runtime never has to reach for its catalog: that
        # would be a network request in the middle of somebody's speech.
        for voice, path in voices.items():
            model.add_voice(voice, str(path))
        self._model = model

    def fetch(self, variant: str) -> None:
        builds.ensure(variant)

    def unload(self) -> None:
        self._model = None

    # ------------------------------------------------------------------ voices

    def voices(self) -> list[Voice]:
        variant = self.variant or self.default_variant or builds.DEFAULT_BUILD
        own = Voice(
            id=DEFAULT_VOICE,
            label="Default",
            description="The checkpoint's own voice",
            spec=f"{DEFAULT_VOICE}@{builds.build_of(variant).revision[:8]}-{variant}",
            tags=tuple(builds.build_of(variant).languages),
        )
        return [own, *(_voice(voice, variant) for voice in builds.voices_for(variant))]

    # ------------------------------------------------------------------ speaking

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        """As the runtime decodes it, which is the point of this engine.

        `request.seed` goes to the runtime and holds the take nearly still rather than still: repeated
        with one seed the samples differ by under 1e-6, and that is enough to flip a rounding, so 9 of
        20 repeats of one line were the same 16-bit PCM. § 6 asks reproducibility only of engines that
        can, and the conformance suite skips rather than fails it.
        """
        name = request.voice or DEFAULT_VOICE
        variant = self.effective_variant(request.variant)
        # Checked here rather than left to the runtime, which on a name it has not got goes looking in
        # its online catalog. A request should not be able to start a download.
        if name != DEFAULT_VOICE and name not in {voice.id for voice in builds.voices_for(variant)}:
            raise UnknownVoice(f'no voice "{name}"')
        if self._model is None:
            raise Unsupported("no model is loaded")

        dials = self.dials_for(request)
        self._model.set_conditions({"duration_delta": dials["durationDelta"]})
        try:
            with self._model.stream(
                request.text, voice=name, temperature=dials["temperature"], seed=request.seed
            ) as audio:
                for chunk in audio:
                    yield from chunked_pcm(chunk)
        except ValueError as error:
            # Text the normaliser leaves nothing of: "🙂" alone is "nothing to synthesize". The
            # request's fault, and the SDK makes this a 400 as long as no audio has left.
            raise BadRequest(str(error)) from error


def _set_threads(runtime: Any) -> None:
    """Once, before the first model: it sizes a global pool, and a later load must not ask again."""
    global _threads_set
    if not _threads_set:
        runtime.set_num_threads(min(THREADS, os.cpu_count() or 1))
        _threads_set = True


def _voice(voice: builds.CatalogVoice, variant: str) -> Voice:
    tags = (voice.language, voice.locale, *((voice.gender,) if voice.gender else ()))
    return Voice(
        id=voice.id,
        label=voice.name,
        description=voice.description,
        # The rendering changes with the voice file and the weights, and with nothing else this
        # adapter controls.
        spec=f"{voice.id}@{builds.VOICES_REVISION[:8]}-{builds.build_of(variant).revision[:8]}",
        tags=tags,
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
