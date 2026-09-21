"""Chatterbox as a rhapsode engine. protocol.md § 8."""

from __future__ import annotations

import hashlib
from collections import OrderedDict
from collections.abc import Iterator
from pathlib import Path
from typing import Any, ClassVar

from rhapsode_worker import (
    BadRequest,
    CreateVoiceRequest,
    Engine,
    NativeFormat,
    SpeakRequest,
    Unsupported,
    Variant,
    Voice,
)

from .builds import CFG_WEIGHT_RANGE, DELIVERY_OFFSETS, EXAGGERATION_RANGE, WEIGHTS, clamp, variants

#: Upstream's S3GEN_SR. Every build synthesises at this rate.
SAMPLE_RATE = 24_000

#: 100ms. The SDK's queue is bounded in chunks, so this is what "how much audio is in flight" means;
#: it also decides how promptly a cancelled request stops being encoded.
CHUNK_SAMPLES = SAMPLE_RATE // 10

#: Reference audio upstream is happy with. Shorter clones badly and longer buys nothing.
REFERENCE_SECONDS = (5.0, 20.0)

VOICE_SUFFIXES = (".wav", ".mp3", ".flac", ".ogg")

#: How many cloned voices keep their analysed reference on the device. The analysis is a second or more
#: of every cloned request (turbo on MPS: 4.9 s against the stock voice's 2.2 s), and an entry is small:
#: 1.3 MB on nano and 0.8 MB on original, measured, so all 32 are about 42 MB beside gigabytes of weights.
CONDITIONALS_KEPT = 32

#: What one `generate` is handed, where the SDK splits for this engine. Every build stops at 1000
#: speech tokens at 25 a second (chatterbox-tts 0.1.7, `inference_turbo`'s `max_gen_len` and the
#: other builds' `max_new_tokens`), so a call cannot say more than 40 seconds whatever it is given.
#: A 1,060-character bulletin sent to turbo whole came back as 26.7 seconds of skipped and crammed
#: speech, about 40 characters a second, where a 488-character one read cleanly at 16 a second in
#: 30.8. 300 is about 19 seconds at that pace: under half the ceiling, so a slower voice still fits.
SEGMENT_CHARACTERS = 300


def _installed_chatterbox() -> str | None:
    """The upstream version, when it is installed. It is not, in this repository's dev environment."""
    try:
        from importlib.metadata import version

        return version("chatterbox-tts")
    except Exception:
        return None


class ChatterboxEngine(Engine):
    id = "chatterbox"
    display_name = "Chatterbox"

    # Both, by hand, because deriving one from the other is the mistake § 4 exists to prevent. The
    # weights are MIT here, which is the unusual and welcome case; an Apache-2.0 inference stack over
    # research-only weights is the common one, and a scanner reports the first and misses the second.
    license: ClassVar[dict[str, Any]] = {
        "code": "MIT",
        "weights": "MIT",
        "weights_commercial_use": True,
        "notes": "https://github.com/resemble-ai/chatterbox",
    }

    native_format = NativeFormat(encoding="pcm_s16le", sample_rate=SAMPLE_RATE, channels=1)
    default_variant = "turbo"

    #: One model, one utterance at a time. Two concurrent generations on one card contend for the
    #: same weights and do not go twice as fast.
    concurrency = 1

    max_characters = 4096
    # The SDK splits, because this adapter carries nothing from one piece to the next: each call is
    # conditioned on the same voice afresh. No `segment_pause_ms`: turbo and nano end every generation
    # on three silence tokens, 120 ms, so their pieces already have a gap, and a pause is one number
    # for the engine where only two of its four builds would want it.
    segment_characters = SEGMENT_CHARACTERS

    #: Which chatterbox is installed, which is a different question from which adapter this is. A
    #: plain attribute rather than a property, because the base class declares it as one and an
    #: override that changes the kind of attribute works right up until somebody subclasses this.
    upstream_version = _installed_chatterbox()

    _model: Any = None
    #: The build's own voice, as upstream loaded it from `conds.pt`. Upstream keeps one `conds` per
    #: model and a clone overwrites it, so without this copy every request that named no voice after
    #: the first clone spoke as that clone.
    _stock: Any = None
    #: Each cloned voice's analysed reference, keyed by the file it came from as it is now, so a
    #: re-recording is a miss. Tensors on the resident model's device, so a load or unload empties it.
    _conditionals: OrderedDict[tuple[str, int, int], Any]

    # ------------------------------------------------------------------ what this engine can do

    def variants(self) -> dict[str, Variant]:
        return variants()

    # ------------------------------------------------------------------ residency

    def load(self, variant: str) -> None:
        """Bring one build onto the device.

        Upstream mostly gives each build its own class rather than an argument to one, which is a
        fact about this engine and not about the protocol. Nano is the exception: turbo's class with
        `nano=True`. The import is here rather than at module scope so that the adapter is
        importable, and testable, without torch.
        """
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        from chatterbox.tts import ChatterboxTTS
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        builds: dict[str, tuple[Any, dict[str, Any]]] = {
            "turbo": (ChatterboxTurboTTS, {}),
            "nano": (ChatterboxTurboTTS, {"nano": True}),
            "original": (ChatterboxTTS, {}),
            "multilingual": (ChatterboxMultilingualTTS, {}),
        }
        build = builds.get(variant)
        if build is None:
            raise Unsupported(f'no build "{variant}"; this engine has {sorted(builds)}')
        upstream, options = build

        # A string, never a torch.device. Upstream decides whether to map a CUDA-saved checkpoint
        # onto the CPU with `device in ["cpu", "mps"]`, which a torch.device never satisfies, so on
        # Apple Silicon every build failed to load with "deserialize object on a CUDA device".
        self._model = upstream.from_pretrained(device=self._torch_device(), **options)
        self._stock = getattr(self._model, "conds", None)
        self._conditionals = OrderedDict()
        _float32_loudness(self._model)

    def fetch(self, variant: str) -> None:
        """Download a build's weights into the Hugging Face cache, where its load will find them.

        The same repository and files upstream's `from_pretrained` asks for, so the load that follows
        is a cache hit. `turbo` alone is 3.8 GB and took about 75 seconds on a first load, which a
        `/speak` caller cannot tell from a hang. The import is here for the same reason `load`'s are.
        """
        import os

        from huggingface_hub import snapshot_download

        repository, patterns = WEIGHTS[variant]
        token = os.getenv("HF_TOKEN") or None
        snapshot_download(repo_id=repository, allow_patterns=list(patterns), token=token)

    def unload(self) -> None:
        """Drop the model, then ask the runtime for the memory back.

        It will not all come back. An unload reclaims roughly 70% of what the model held because the
        graphics runtime keeps the rest until the process exits, which is why the core has
        `terminate` as well and why a residency manager with only this verb slowly loses a card.
        """
        self._model = None
        self._stock = None
        self._conditionals = OrderedDict()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            elif torch.backends.mps.is_available():
                torch.mps.empty_cache()
        except Exception:
            pass

    def _torch_device(self) -> str:
        detected = self.device.type
        return "cuda" if detected in {"cuda", "rocm"} else detected

    # ------------------------------------------------------------------ voices

    def voices(self) -> list[Voice]:
        """Whatever reference audio is on disk. A cloned voice is a file, and that is the whole store."""
        if not self.voice_dir.is_dir():
            return []
        found = sorted(path for path in self.voice_dir.iterdir() if path.suffix.lower() in VOICE_SUFFIXES)
        return [self._voice(path) for path in found]

    def reference_formats(self) -> tuple[str, ...]:
        return tuple(suffix.lstrip(".") for suffix in VOICE_SUFFIXES)

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        """Store the reference audio. Cloning here is zero-shot, so there is nothing to train."""
        self.voice_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(request.filename or "reference.wav").suffix.lower()
        if suffix not in VOICE_SUFFIXES:
            raise Unsupported(f'reference audio must be one of {", ".join(VOICE_SUFFIXES)}, not "{suffix}"')
        if not request.reference:
            raise BadRequest("the reference audio is empty")

        # A re-record replaces, whatever the new clip is called. An mp3 over an earlier wav would
        # otherwise leave both, and which one speaks would depend on how the directory sorted.
        for stale in self.voice_dir.iterdir():
            if stale.stem == request.id and stale.suffix.lower() in VOICE_SUFFIXES:
                stale.unlink()
        target = self.voice_dir / f"{request.id}{suffix}"
        self._forget(request.id)
        target.write_bytes(request.reference)
        return self._voice(target, label=request.label)

    def _voice(self, path: Path, label: str | None = None) -> Voice:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
        return Voice(
            id=path.stem,
            label=label or path.stem.replace("_", " ").title(),
            description=f"Cloned from {path.name}",
            # Changes when what this voice SOUNDS like would: the reference, and the resident build,
            # since turbo and original read the same clip two different ways. It was the id and the
            # build alone, so re-recording a voice left the spec as it was and a client keying a
            # cached preview on it served the old recording. protocol.md § 7.
            spec=f"{path.stem}@{self.variant or self.default_variant}:{digest}",
            tags=("cloned",),
        )

    def delete_voice(self, voice_id: str) -> None:
        path = self.path_for(voice_id)
        self._forget(voice_id)
        path.unlink()

    def _forget(self, voice_id: str) -> None:
        """Drop a voice's analysed reference. The key would miss anyway once the file changes; this
        is for a re-recording that lands with the same size inside one tick of the file clock."""
        cached = getattr(self, "_conditionals", None)
        if not cached:
            return
        for key in [key for key in cached if Path(key[0]).stem == voice_id]:
            del cached[key]

    def reference_seconds(self) -> tuple[float, float] | None:
        return REFERENCE_SECONDS

    # ------------------------------------------------------------------ deliveries

    def apply_delivery(self, delivery: str | None, dials: dict[str, float]) -> dict[str, float]:
        """A direction, taken from wherever the voice already is. protocol.md § 5.

        Each word is an offset on the dials the request resolved to rather than a fixed point, so the
        two compose: a voice that is intense at rest is still more intense than its neighbours when
        hushed, and a calm one is still calmer when frantic. Hard-coding `exaggeration = 0.2` for
        hushed would throw away whatever made that voice itself, and make every hushed line sound
        alike whoever was reading it.

        Both dials move together whenever a delivery is asked for, because a reading is the pair.
        Sending one and leaving the other at its default is half a delivery.
        """
        offsets = DELIVERY_OFFSETS.get(delivery or "")
        if offsets is None:
            return dials

        exaggeration = dials.get("exaggeration", EXAGGERATION_RANGE[2]) + offsets["exaggeration"]
        cfg_weight = dials.get("cfgWeight", CFG_WEIGHT_RANGE[2]) + offsets["cfgWeight"]

        return {
            **dials,
            "exaggeration": clamp(exaggeration, EXAGGERATION_RANGE[0], EXAGGERATION_RANGE[1]),
            "cfgWeight": clamp(cfg_weight, CFG_WEIGHT_RANGE[0], CFG_WEIGHT_RANGE[1]),
        }

    # ------------------------------------------------------------------ speaking

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        """Synthesise, then hand the SDK PCM.

        Upstream has no streaming generate: every build returns the whole waveform at once. So this
        chunks a finished tensor rather than pretending to be incremental, which is honest about the
        latency and still gives the SDK, the encoder and the core something to move.
        """
        if self._model is None:
            raise Unsupported("no model is loaded")

        variant = self.effective_variant(request.variant)
        arguments = self._arguments(request, variant)
        self._model.conds = self._stock if request.voice is None else self._cloned(request.voice, arguments)

        # After conditioning rather than before, so a seeded request is the same audio whether its
        # voice was analysed just now or came from the cache.
        if request.seed is not None:
            self._seed(request.seed)
        waveform = self._model.generate(request.text, **arguments)

        yield from chunked_pcm(waveform, CHUNK_SAMPLES)

    def _arguments(self, request: SpeakRequest, variant: str) -> dict[str, Any]:
        """Exactly what this build accepts, and nothing it would only warn about."""
        arguments: dict[str, Any] = {}

        if variant in {"turbo", "nano"}:
            # Zero on purpose. Anything above it makes upstream log that CFG, min_p and exaggeration
            # are unsupported and ignore them, and the capability document already says these builds
            # have no dials, so a non-zero value here could only have come from the SDK ignoring it.
            return {**arguments, "exaggeration": 0.0, "cfg_weight": 0.0, "min_p": 0.0}

        dials = self.dials_for(request)
        arguments["exaggeration"] = dials.get("exaggeration", EXAGGERATION_RANGE[2])
        arguments["cfg_weight"] = dials.get("cfgWeight", CFG_WEIGHT_RANGE[2])

        if variant == "multilingual":
            arguments["language_id"] = request.language

        return arguments

    def _cloned(self, voice: str, arguments: dict[str, Any]) -> Any:
        """A cloned voice's analysed reference, from the cache or made now.

        Upstream analyses the reference inside `generate` whenever it is handed a path, which is on
        every request: turbo on MPS spent 4.9 s on a cloned line against 2.2 s for the stock voice. So
        this calls upstream's own `prepare_conditionals` once per voice and hands `generate` no path.
        Only `exaggeration` reaches the analysis, and every dialled build re-applies it to the
        conditionals on each `generate`, so a cached entry cannot carry one request's dials into the
        next.
        """
        path = self.path_for(voice)
        status = path.stat()
        key = (str(path), status.st_mtime_ns, status.st_size)

        cached = self._conditionals.get(key)
        if cached is not None:
            self._conditionals.move_to_end(key)
            return cached

        self._forget(voice)
        self._model.prepare_conditionals(str(path), exaggeration=arguments["exaggeration"])
        self._conditionals[key] = self._model.conds
        while len(self._conditionals) > CONDITIONALS_KEPT:
            self._conditionals.popitem(last=False)
        return self._model.conds

    def _seed(self, seed: int) -> None:
        """Reproducibility where the engine can manage it, which is every generator it touches."""
        import random

        import torch

        random.seed(seed)
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)


def _float32_loudness(model: Any) -> None:
    """Make turbo's loudness step hand back float32, which is what every later step computes in.

    Turbo normalises a reference clip with pyloudnorm, which returns float64, and the array goes to
    the device as it is. MPS has no float64, so on Apple Silicon every clone failed at its first
    `speak` with "Cannot convert a MPS Tensor to float64 dtype" (measured, turbo, chatterbox-tts
    0.1.7). Nano is turbo's class and has the same step; the other builds have none. Wrapped per
    instance rather than patched on the class, so nothing outside this adapter is changed.
    """
    original = getattr(model, "norm_loudness", None)
    if original is None:
        return

    def float32(wav: Any, sr: int, *args: Any, **kwargs: Any) -> Any:
        result = original(wav, sr, *args, **kwargs)
        return result.astype("float32") if hasattr(result, "astype") else result

    model.norm_loudness = float32


def chunked_pcm(waveform: Any, chunk_samples: int = CHUNK_SAMPLES) -> Iterator[bytes]:
    """A float waveform in [-1, 1] as little-endian signed 16-bit PCM, in pieces.

    Clipped before scaling rather than after, because a value slightly outside the range wraps around
    to full-scale of the opposite sign once it is an integer: a moment of loudness becomes a click,
    which is exactly the artefact nobody hears until it airs.
    """
    import numpy as np

    samples = np.asarray(waveform, dtype=np.float32).reshape(-1)
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")

    for start in range(0, pcm.size, chunk_samples):
        block = pcm[start : start + chunk_samples]
        if block.size:
            yield block.tobytes()
