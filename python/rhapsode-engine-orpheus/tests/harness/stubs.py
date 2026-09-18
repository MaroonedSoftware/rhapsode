"""An Orpheus that is not Orpheus: llama.cpp, SNAC, torch and the Hugging Face hub, as fakes.

The real ones bring torch, a compiled llama.cpp and gigabytes of weights, which is why every engine
gets its own virtualenv and why none of them is in this repository's dev environment. What is under
test is the adapter: the prompt it builds, the sampling it asks for, how it frames tokens and how it
stops. The fakes answer all of those.

Their output varies with everything they were given, because that is what a real model does and it
is the only way the conformance suite can see that a cue, a dial or a seed reached the model. The
audio is noise; only its length and its content depend on the input.

What this cannot check is whether the audio is speech, or whether `<laugh>` is performed. Only real
weights answer that, and `rhapsode-conform` against a real install is where it gets asked.
"""

from __future__ import annotations

import contextlib
import hashlib
import random
import sys
import types
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from rhapsode_engine_orpheus.codes import AUDIO_TOKEN_BASE, CODEBOOK_SIZE, FRAME_TOKENS, SAMPLES_PER_FRAME
from rhapsode_engine_orpheus.prompt import END_OF_SPEECH


@dataclass
class Generation:
    """One call to `generate`, kept so a test can assert on what the adapter asked for."""

    tokens: list[int]
    seed: int | None
    sampling: dict[str, Any]
    yielded: int = 0
    closed: bool = False


@dataclass
class Recorder:
    llamas: list[FakeLlama] = field(default_factory=list)
    downloads: list[dict[str, Any]] = field(default_factory=list)
    #: How many frames each generation speaks. None is "in proportion to the prompt".
    frames: int | None = None
    #: Keep generating audio past the frame count rather than saying end of speech.
    endless: bool = False


class FakeLlama:
    def __init__(self, recorder: Recorder, model_path: str, **options: Any) -> None:
        self.recorder = recorder
        self.model_path = model_path
        self.options = options
        self.seed: int | None = None
        self.generations: list[Generation] = []
        self.closed = False
        recorder.llamas.append(self)

    def tokenize(self, text: bytes, add_bos: bool = True, special: bool = False) -> list[int]:
        return ([128000] if add_bos else []) + list(text)

    def set_seed(self, seed: int) -> None:
        self.seed = seed

    def generate(self, tokens: list[int], **sampling: Any) -> Iterator[int]:
        generation = Generation(tokens=list(tokens), seed=self.seed, sampling=sampling)
        self.generations.append(generation)
        return self._generate(generation)

    def _generate(self, generation: Generation) -> Iterator[int]:
        rng = random.Random(repr((generation.tokens, generation.seed, sorted(generation.sampling.items()))))
        frames = self.recorder.frames if self.recorder.frames is not None else 6 + len(generation.tokens) // 2
        position = 0
        try:
            # llama.cpp's generate never ends by itself: stopping is the caller's job.
            while True:
                if position == frames * FRAME_TOKENS and not self.recorder.endless:
                    generation.yielded += 1
                    yield END_OF_SPEECH
                    continue
                slot = position % FRAME_TOKENS
                generation.yielded += 1
                yield AUDIO_TOKEN_BASE + slot * CODEBOOK_SIZE + rng.randrange(CODEBOOK_SIZE)
                position += 1
        finally:
            generation.closed = True

    def close(self) -> None:
        self.closed = True


class _Audio(np.ndarray):
    """Enough of a tensor for `audio[0, 0, a:b].float().cpu().numpy()`."""

    def float(self) -> _Audio:
        return self

    def cpu(self) -> _Audio:
        return self

    def numpy(self) -> np.ndarray:
        return np.asarray(self)


class FakeSnac:
    def __init__(self) -> None:
        self.device: str | None = None
        self.decoded: list[list[list[int]]] = []

    def eval(self) -> FakeSnac:
        return self

    def to(self, device: str) -> FakeSnac:
        self.device = device
        return self

    def decode(self, codes: list[np.ndarray]) -> _Audio:
        layers = [np.asarray(layer).reshape(-1).tolist() for layer in codes]
        self.decoded.append(layers)
        digest = int.from_bytes(hashlib.sha256(repr(layers).encode()).digest()[:8], "little")
        samples = np.random.default_rng(digest).uniform(-0.5, 0.5, len(layers[0]) * SAMPLES_PER_FRAME)
        return samples.astype(np.float32).reshape(1, 1, -1).view(_Audio)


def modules(recorder: Recorder) -> dict[str, types.ModuleType]:
    """The fakes, as the modules the adapter imports."""
    torch = types.ModuleType("torch")
    torch.int32 = "int32"  # type: ignore[attr-defined]
    torch.tensor = lambda data, dtype=None, device=None: np.asarray(data)  # type: ignore[attr-defined]
    torch.inference_mode = contextlib.nullcontext  # type: ignore[attr-defined]
    torch.cuda = types.SimpleNamespace(is_available=lambda: False, empty_cache=lambda: None)  # type: ignore[attr-defined]
    torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False))  # type: ignore[attr-defined]

    snac = types.ModuleType("snac")
    codec = FakeSnac()

    def from_pretrained(repo_id: str, **options: Any) -> FakeSnac:
        recorder.downloads.append({"repo_id": repo_id, **options})
        return codec

    snac.SNAC = types.SimpleNamespace(from_pretrained=from_pretrained)  # type: ignore[attr-defined]
    snac.codec = codec  # type: ignore[attr-defined]

    llama_cpp = types.ModuleType("llama_cpp")
    llama_cpp.Llama = lambda model_path, **options: FakeLlama(recorder, model_path, **options)  # type: ignore[attr-defined]

    hub = types.ModuleType("huggingface_hub")

    def hf_hub_download(**arguments: Any) -> str:
        recorder.downloads.append(arguments)
        return f"/models/{arguments['filename']}"

    def snapshot_download(**arguments: Any) -> str:
        recorder.downloads.append(arguments)
        return f"/models/{arguments['repo_id']}"

    hub.hf_hub_download = hf_hub_download  # type: ignore[attr-defined]
    hub.snapshot_download = snapshot_download  # type: ignore[attr-defined]

    return {"torch": torch, "snac": snac, "llama_cpp": llama_cpp, "huggingface_hub": hub}


def install(recorder: Recorder | None = None) -> Recorder:
    """For a whole process: the served harness."""
    recorder = recorder or Recorder()
    sys.modules.update(modules(recorder))
    return recorder
