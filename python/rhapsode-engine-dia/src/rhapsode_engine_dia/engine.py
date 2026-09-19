"""Dia as a rhapsode engine. protocol.md § 8."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any, ClassVar

from rhapsode_worker import (
    CreateVoiceRequest,
    Engine,
    NativeFormat,
    SpeakRequest,
    UnknownVoice,
    Unsupported,
    Variant,
    Voice,
)
from rhapsode_worker.engine import Device

from .backends import Generator, Prompt, Sampling, TransformersDia
from .builds import (
    CFG_SCALE_RANGE,
    CODEC_FILES,
    CODEC_REPOSITORY,
    CODEC_REVISION,
    DEFAULT_VARIANT,
    FILES,
    REPOSITORY,
    REVISION,
    TEMPERATURE_RANGE,
    TOP_P_RANGE,
    variants,
)
from .prompt import line, segments, translate_cues
from .voices import REFERENCE_SECONDS, clips, digest, load, remove, store

#: The Descript codec's rate. Every generation is 44.1 kHz mono.
SAMPLE_RATE = 44_100

#: 100 ms. The SDK's queue is bounded in chunks, so this is what "how much audio is in flight" means;
#: it also decides how promptly a cancelled request stops being encoded.
CHUNK_SAMPLES = SAMPLE_RATE // 10


def _installed_transformers() -> str | None:
    """The transformers version, when it is installed. It is not, in this repository's dev environment."""
    try:
        from importlib.metadata import version

        return version("transformers")
    except Exception:
        return None


class DiaEngine(Engine):
    id = "dia"
    display_name = "Dia"

    # Both, by hand, because deriving one from the other is the mistake § 4 exists to prevent. Here
    # they happen to agree. Upstream's README also forbids identity misuse and deceptive content, in a
    # section it calls a disclaimer rather than a licence term; the notes carry it so that an operator
    # reads it before installing rather than after.
    license: ClassVar[dict[str, Any]] = {
        "code": "Apache-2.0",
        "weights": "Apache-2.0",
        "weights_commercial_use": True,
        "notes": "https://github.com/nari-labs/dia. Upstream asks that it not be used to imitate a real "
        "person without consent or to deceive.",
    }

    native_format = NativeFormat(encoding="pcm_s16le", sample_rate=SAMPLE_RATE, channels=1)
    default_variant = DEFAULT_VARIANT

    #: One model, one utterance at a time. Two concurrent generations on one card contend for the
    #: same weights and do not go twice as fast.
    concurrency = 1

    max_characters = 4096

    #: Which transformers is installed, since that is where the model's code lives. A plain attribute
    #: rather than a property, because the base class declares it as one.
    upstream_version = _installed_transformers()

    _generator: Generator | None = None

    # ------------------------------------------------------------------ what this engine can do

    def variants(self) -> dict[str, Variant]:
        return variants()

    # ------------------------------------------------------------------ residency

    def load(self, variant: str) -> None:
        if variant not in variants():
            raise Unsupported(f'no build "{variant}"; this engine has {sorted(variants())}')
        self._generator = TransformersDia(_torch_device(self.device))

    def fetch(self, variant: str) -> None:
        """Download the checkpoint and its codec into the Hugging Face cache, where the load finds them.

        The same repositories, revisions and files the load asks for, so the load that follows is a
        cache hit. They are 6.4 GB and 0.3 GB, which a first `/speak` caller could not tell from a
        hang. The import is here so the adapter is importable without the hub.
        """
        import os

        from huggingface_hub import snapshot_download

        if variant not in variants():
            raise Unsupported(f'no build "{variant}"; this engine has {sorted(variants())}')
        token = os.getenv("HF_TOKEN") or None
        snapshot_download(
            repo_id=CODEC_REPOSITORY, revision=CODEC_REVISION, allow_patterns=list(CODEC_FILES), token=token
        )
        snapshot_download(repo_id=REPOSITORY, revision=REVISION, allow_patterns=list(FILES), token=token)

    def unload(self) -> None:
        """Drop the model, then ask the runtime for the memory back, which it will not all give."""
        if self._generator is not None:
            self._generator.close()
        self._generator = None
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            elif torch.backends.mps.is_available():
                torch.mps.empty_cache()
        except Exception:
            pass

    # ------------------------------------------------------------------ voices

    def voices(self) -> list[Voice]:
        """Only what was cloned. Dia was not finetuned on any voice, so a request naming none is read
        in whichever voice the model picks, which a seed fixes."""
        return [self._voice(clip) for clip in clips(self.voice_dir)]

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        """Keep the clip at the model's rate, and the words spoken in it, which Dia cannot clone without."""
        return self._voice(store(self.voice_dir, request))

    def delete_voice(self, voice_id: str) -> None:
        remove(self._clip(voice_id))

    def reference_seconds(self) -> tuple[float, float] | None:
        return REFERENCE_SECONDS

    def _voice(self, clip: Path) -> Voice:
        return Voice(
            id=clip.stem,
            label=load(clip).label,
            description="Cloned from a reference and its transcript",
            # The clip and its words, and the resident build. protocol.md § 7.
            spec=f"{clip.stem}@{self.variant or self.default_variant}:{digest(clip)}",
            tags=("cloned",),
        )

    # ------------------------------------------------------------------ speaking

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        """Generate one segment at a time, and hand the SDK each as soon as it is whole.

        Dia generates a segment all at once, so this chunks a finished waveform rather than pretending
        to be incremental. Long text is several generations, and upstream says plainly that without an
        audio prompt "you will get different voices every time you run the model", which in one
        request would be a different reader every 17 seconds. So every segment after the first
        continues from the first: its audio and its words are the prompt, and the voice the model
        picked for it is the voice of the whole request. A cloned voice is a prompt already, its clip
        and transcript, and every segment continues from that instead.

        Each segment's seed is the request's plus its index, so the whole request reproduces and no
        two segments are sampled alike.
        """
        generator = self._generator
        if generator is None:
            raise Unsupported("no model is loaded")
        anchor = None if request.voice is None else self._cloned(request.voice)
        cloned = anchor is not None

        dials = self.dials_for(request)
        for index, segment in enumerate(segments(translate_cues(request.text))):
            text = line(segment)
            sampling = Sampling(
                cfg_scale=dials.get("cfgScale", CFG_SCALE_RANGE[2]),
                temperature=dials.get("temperature", TEMPERATURE_RANGE[2]),
                top_p=dials.get("topP", TOP_P_RANGE[2]),
                seed=None if request.seed is None else request.seed + index,
            )
            spoken = generator.generate(text, sampling, anchor)
            if spoken.exhausted:
                # The model was still speaking when it ran out, so this segment ends mid-word. It is
                # what SEGMENT_CHARACTERS exists to prevent, and the evidence for tuning it.
                self.log.warn("a segment ran out of positions", characters=len(segment))
            yield from chunked_pcm(spoken.audio)
            if not cloned and anchor is None:
                anchor = Prompt(audio=spoken.audio, text=text)

    def _cloned(self, voice: str) -> Prompt:
        """A cloned voice as the prompt it continues from, or `unknown_voice` and never a substitute."""
        reference = load(self._clip(voice))
        return Prompt(audio=reference.audio, text=line(translate_cues(reference.transcript)))

    def _clip(self, voice: str) -> Path:
        """The voice's clip. `path_for` checks the id and the directory, and answers with whichever file
        has the stem first, which is the `.json` beside it, so the clip is found from that."""
        clip = self.path_for(voice).with_suffix(".wav")
        if not (clip.is_file() and clip.with_suffix(".json").is_file()):
            raise UnknownVoice(f'no voice "{voice}"; this engine has only what was cloned')
        return clip


def chunked_pcm(waveform: Any, chunk_samples: int = CHUNK_SAMPLES) -> Iterator[bytes]:
    """A float waveform in [-1, 1] as little-endian signed 16-bit PCM, in pieces.

    Clipped before scaling rather than after, because a value slightly outside the range wraps around
    to full-scale of the opposite sign once it is an integer.
    """
    import numpy as np

    samples = np.asarray(waveform, dtype=np.float32).reshape(-1)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    for start in range(0, pcm.size, chunk_samples):
        block = pcm[start : start + chunk_samples]
        if block.size:
            yield block.tobytes()


def _torch_device(device: Device) -> str:
    """torch's name for the detected device. ROCm builds of torch answer to "cuda"."""
    return {"cuda": "cuda", "rocm": "cuda", "mps": "mps"}.get(device.type, "cpu")
