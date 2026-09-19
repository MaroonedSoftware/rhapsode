"""A Dia that is not Dia: torch, transformers' Dia classes and the Hugging Face hub, as fakes.

The real ones bring torch and 6.7 GB of weights, which is why every engine gets its own virtualenv and
why none of them is in this repository's dev environment. What is under test is the adapter: the text
it builds, the sampling it asks for, the prompt it continues from and what it does with what comes
back. The fakes answer all of those, through the same calls the backend makes of the real library.

Their output varies with everything they were given, because that is what a real model does and it
is the only way the conformance suite can see that a cue, a dial or a seed reached the model. The
audio is noise; only its length and its content depend on the input. The noise is drawn from torch's
global generator, so a request that is not seeded is not reproducible, as it is not for real.

What this cannot check is whether the audio is speech, or whether `(laughs)` is performed. Only real
weights answer that, and `rhapsode-conform` against a real install is where it gets asked.
"""

from __future__ import annotations

import contextlib
import hashlib
import random
import sys
import types
from dataclasses import dataclass, field
from typing import Any

import numpy as np

#: The codec's hop, and the largest of the checkpoint's codebook delays.
HOP = 512
MAX_DELAY = 15


@dataclass
class Generation:
    """One call to `generate`, kept so a test can assert on what the adapter asked for."""

    text: str
    prompt: np.ndarray | None
    sampling: dict[str, Any]
    seed: int | None
    frames: int


@dataclass
class Recorder:
    generations: list[Generation] = field(default_factory=list)
    loads: list[dict[str, Any]] = field(default_factory=list)
    downloads: list[dict[str, Any]] = field(default_factory=list)
    #: How many frames each generation speaks. None is "in proportion to the text".
    frames: int | None = None


class Tensor(np.ndarray):
    """Enough of a tensor for `.float().cpu().numpy()`."""

    def float(self) -> Tensor:
        return self

    def cpu(self) -> Tensor:
        return self

    def numpy(self) -> np.ndarray:
        return np.asarray(self)


class Inputs(dict[str, Any]):
    """The processor's BatchFeature: a dict that moves to a device."""

    device: str | None = None

    def to(self, device: str) -> Inputs:
        self.device = device
        return self


class Outputs:
    """What `generate` returns: a sequence of frames, of which only the shape is read by the adapter."""

    def __init__(self, generation: Generation, prompt_frames: int, digest: int) -> None:
        self.generation = generation
        self.prompt_frames = prompt_frames
        self.digest = digest
        self.shape = (1, prompt_frames + generation.frames + MAX_DELAY, 9)


class Codec:
    def __init__(self, recorder: Recorder, repository: str, revision: str | None) -> None:
        recorder.loads.append({"codec": repository, "revision": revision})
        self.device: str | None = None
        self.evaluated = False

    def to(self, device: str) -> Codec:
        self.device = device
        return self

    def eval(self) -> Codec:
        self.evaluated = True
        return self


class Part:
    """The processor's feature extractor or tokenizer, which the adapter loads on their own."""

    def __init__(self, recorder: Recorder, kind: str, repository: str, revision: str | None) -> None:
        recorder.loads.append({kind: repository, "revision": revision})


class Processor:
    def __init__(self, feature_extractor: Part, tokenizer: Part, audio_tokenizer: Codec) -> None:
        self.feature_extractor = feature_extractor
        self.tokenizer = tokenizer
        self.audio_tokenizer = audio_tokenizer

    def __call__(self, text: list[str], audio: list[np.ndarray] | None = None, **options: Any) -> Inputs:
        assert options == {"padding": True, "return_tensors": "pt"}
        assert len(text) == 1
        # As the real processor: the clip is encoded to frames, then a start frame and the delays.
        prompt = None if audio is None else np.asarray(audio[0], dtype=np.float32)
        frames = 0 if prompt is None else -(-prompt.size // HOP)
        mask = np.ones((1, frames + 1 + MAX_DELAY), dtype=np.int64)
        return Inputs(input_ids=text[0], prompt=prompt, decoder_attention_mask=mask)

    def get_audio_prompt_len(self, decoder_attention_mask: np.ndarray) -> int:
        return int(decoder_attention_mask.shape[1]) - MAX_DELAY

    def batch_decode(self, outputs: Outputs, audio_prompt_len: int | None = None) -> list[Tensor]:
        # Without a prompt length the real processor finds the start by counting start frames, which
        # there is one of; with one, the prompt's frames are left out. Either way, only new audio.
        assert audio_prompt_len in (None, outputs.prompt_frames + 1)
        samples = np.random.default_rng(outputs.digest).uniform(-0.5, 0.5, outputs.generation.frames * HOP)
        return [samples.astype(np.float32).view(Tensor)]


class Model:
    def __init__(self, recorder: Recorder, torch: types.ModuleType, repository: str, **options: Any) -> None:
        recorder.loads.append({"model": repository, **options})
        self.recorder = recorder
        self.torch = torch
        self.device: str | None = None
        self.evaluated = False

    def to(self, device: str) -> Model:
        self.device = device
        return self

    def eval(self) -> Model:
        self.evaluated = True
        return self

    def generate(self, **arguments: Any) -> Outputs:
        text: str = arguments.pop("input_ids")
        prompt: np.ndarray | None = arguments.pop("prompt")
        mask: np.ndarray = arguments.pop("decoder_attention_mask")
        frames = self.recorder.frames if self.recorder.frames is not None else 40 + len(text.encode()) // 2
        generation = Generation(
            text=text,
            prompt=prompt,
            sampling=dict(arguments),
            seed=self.torch.seeded,  # type: ignore[attr-defined]
            frames=frames,
        )
        self.recorder.generations.append(generation)
        noise = self.torch.generator.getrandbits(32)  # type: ignore[attr-defined]
        heard = None if prompt is None else hashlib.sha256(prompt.tobytes()).hexdigest()
        digest = int.from_bytes(
            hashlib.sha256(repr((text, heard, sorted(arguments.items()), noise)).encode()).digest()[:8],
            "little",
        )
        return Outputs(generation, int(mask.shape[1]) - 1 - MAX_DELAY, digest)


def modules(recorder: Recorder) -> dict[str, types.ModuleType]:
    """The fakes, as the modules the adapter imports."""
    torch = types.ModuleType("torch")
    torch.bfloat16 = "bfloat16"  # type: ignore[attr-defined]
    torch.float32 = "float32"  # type: ignore[attr-defined]
    torch.inference_mode = contextlib.nullcontext  # type: ignore[attr-defined]
    torch.cuda = types.SimpleNamespace(  # type: ignore[attr-defined]
        is_available=lambda: False, empty_cache=lambda: None, manual_seed_all=lambda seed: None
    )
    torch.mps = types.SimpleNamespace(empty_cache=lambda: None)  # type: ignore[attr-defined]
    torch.backends = types.SimpleNamespace(  # type: ignore[attr-defined]
        mps=types.SimpleNamespace(is_available=lambda: False),
        cudnn=types.SimpleNamespace(deterministic=False, benchmark=True),
    )
    # The global generator, unseeded until somebody seeds it, as torch's is.
    torch.generator = random.Random()  # type: ignore[attr-defined]
    torch.seeded = None  # type: ignore[attr-defined]

    def manual_seed(seed: int) -> None:
        torch.generator = random.Random(seed)  # type: ignore[attr-defined]
        torch.seeded = seed  # type: ignore[attr-defined]

    torch.manual_seed = manual_seed  # type: ignore[attr-defined]

    transformers = types.ModuleType("transformers")
    transformers.DacModel = types.SimpleNamespace(  # type: ignore[attr-defined]
        from_pretrained=lambda repository, revision=None: Codec(recorder, repository, revision)
    )
    for kind, name in (("features", "DiaFeatureExtractor"), ("tokenizer", "DiaTokenizer")):
        setattr(
            transformers,
            name,
            types.SimpleNamespace(
                from_pretrained=lambda repository, revision=None, kind=kind: Part(
                    recorder, kind, repository, revision
                )
            ),
        )
    transformers.DiaProcessor = Processor  # type: ignore[attr-defined]
    transformers.DiaForConditionalGeneration = types.SimpleNamespace(  # type: ignore[attr-defined]
        from_pretrained=lambda repository, **options: Model(recorder, torch, repository, **options)
    )

    hub = types.ModuleType("huggingface_hub")

    def snapshot_download(**arguments: Any) -> str:
        recorder.downloads.append(arguments)
        return f"/models/{arguments['repo_id']}"

    hub.snapshot_download = snapshot_download  # type: ignore[attr-defined]

    return {"torch": torch, "transformers": transformers, "huggingface_hub": hub}


def install(recorder: Recorder | None = None) -> Recorder:
    """For a whole process: the served harness."""
    recorder = recorder or Recorder()
    sys.modules.update(modules(recorder))
    return recorder
