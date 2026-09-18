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

import asyncio
import contextlib
import enum
import hashlib
import importlib.machinery
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
    vllms: list[FakeAsyncLLM] = field(default_factory=list)
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
        #: The prompt whose KV cache is still held, which llama.cpp reuses across calls to generate.
        self.cached: list[int] = []
        recorder.llamas.append(self)

    def reset(self) -> None:
        self.cached = []

    def tokenize(self, text: bytes, add_bos: bool = True, special: bool = False) -> list[int]:
        return ([128000] if add_bos else []) + list(text)

    def set_seed(self, seed: int) -> None:
        self.seed = seed

    def generate(self, tokens: list[int], **sampling: Any) -> Iterator[int]:
        generation = Generation(tokens=list(tokens), seed=self.seed, sampling=sampling)
        self.generations.append(generation)
        return self._generate(generation)

    def _generate(self, generation: Generation) -> Iterator[int]:
        # As llama.cpp does: a prompt that shares a prefix with the cached one is evaluated only from
        # where they differ, and the logits that produces are not bit-identical to a whole evaluation,
        # so what is sampled from them is not either.
        replayed = bool(self.cached) and self.cached[:8] == generation.tokens[:8]
        self.cached = list(generation.tokens)
        options = sorted(generation.sampling.items())
        rng = random.Random(repr((generation.tokens, generation.seed, options, replayed)))
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


def _audio_tokens(rng: random.Random, frames: int, endless: bool) -> Iterator[int]:
    """What the finetune writes: seven codes a frame, then end of speech, unless it will not stop."""
    position = 0
    while endless or position < frames * FRAME_TOKENS:
        yield AUDIO_TOKEN_BASE + (position % FRAME_TOKENS) * CODEBOOK_SIZE + rng.randrange(CODEBOOK_SIZE)
        position += 1
    yield END_OF_SPEECH


@dataclass
class VllmRequest:
    prompt: list[int]
    parameters: Any
    request_id: str
    delivered: int = 0


class FakeAsyncLLM:
    """vLLM's AsyncLLM: an async generator of deltas, which includes the stop token as vLLM's does."""

    def __init__(self, recorder: Recorder, arguments: Any) -> None:
        self.recorder = recorder
        self.arguments = arguments
        self.requests: list[VllmRequest] = []
        self.aborted: list[str] = []
        self.shut_down = False
        #: The loop it was made on, which must be the loop it is used on.
        self.loop = asyncio.get_running_loop()
        recorder.vllms.append(self)

    async def generate(self, prompt: dict[str, Any], parameters: Any, request_id: str) -> Any:
        assert asyncio.get_running_loop() is self.loop
        request = VllmRequest(
            prompt=list(prompt["prompt_token_ids"]), parameters=parameters, request_id=request_id
        )
        self.requests.append(request)
        options = sorted((k, v) for k, v in vars(parameters).items() if k != "output_kind")
        rng = random.Random(repr((request.prompt, options)))
        frames = self.recorder.frames if self.recorder.frames is not None else 6 + len(request.prompt) // 2
        tokens = _audio_tokens(rng, frames, self.recorder.endless)
        while request_id not in self.aborted and request.delivered < parameters.max_tokens:
            delta: list[int] = []
            for token in tokens:
                delta.append(token)
                request.delivered += 1
                if token == END_OF_SPEECH or len(delta) == 3 or request.delivered == parameters.max_tokens:
                    break
            yield types.SimpleNamespace(outputs=[types.SimpleNamespace(token_ids=delta)])
            if delta and delta[-1] == END_OF_SPEECH:
                return
            await asyncio.sleep(0)

    async def abort(self, request_id: str) -> None:
        self.aborted.append(request_id)

    def shutdown(self) -> None:
        self.shut_down = True


class _Audio(np.ndarray):
    """Enough of a tensor for `audio[0, 0, a:b].float().cpu().numpy()`."""

    def float(self) -> _Audio:
        return self

    def cpu(self) -> _Audio:
        return self

    def numpy(self) -> np.ndarray:
        return np.asarray(self)


class FakeSnac:
    """SNAC 24 kHz, including the part that matters here: its decoder adds noise from torch's global
    generator on every decode, so the same codes decode differently unless torch was seeded."""

    def __init__(self, torch: types.ModuleType) -> None:
        self.torch = torch
        self.device: str | None = None
        self.decoded: list[list[list[int]]] = []
        self.seeds: list[int | None] = []

    def eval(self) -> FakeSnac:
        return self

    def to(self, device: str) -> FakeSnac:
        self.device = device
        return self

    def decode(self, codes: list[np.ndarray]) -> _Audio:
        layers = [np.asarray(layer).reshape(-1).tolist() for layer in codes]
        self.decoded.append(layers)
        self.seeds.append(self.torch.seeded)  # type: ignore[attr-defined]
        noise = self.torch.generator.getrandbits(32)  # type: ignore[attr-defined]
        digest = int.from_bytes(hashlib.sha256(repr((layers, noise)).encode()).digest()[:8], "little")
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
    # The global generator, unseeded until somebody seeds it, as torch's is.
    torch.generator = random.Random()  # type: ignore[attr-defined]
    torch.seeded = None  # type: ignore[attr-defined]

    def manual_seed(seed: int) -> None:
        torch.generator = random.Random(seed)  # type: ignore[attr-defined]
        torch.seeded = seed  # type: ignore[attr-defined]

    torch.manual_seed = manual_seed  # type: ignore[attr-defined]

    snac = types.ModuleType("snac")
    codec = FakeSnac(torch)

    def from_pretrained(repo_id: str, **options: Any) -> FakeSnac:
        recorder.downloads.append({"repo_id": repo_id, **options})
        return codec

    snac.SNAC = types.SimpleNamespace(from_pretrained=from_pretrained)  # type: ignore[attr-defined]
    snac.codec = codec  # type: ignore[attr-defined]

    llama_cpp = types.ModuleType("llama_cpp")
    llama_cpp.__spec__ = importlib.machinery.ModuleSpec("llama_cpp", None)
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

    return {
        "torch": torch,
        "snac": snac,
        "llama_cpp": llama_cpp,
        "huggingface_hub": hub,
        **vllm_modules(recorder),
    }


def vllm_modules(recorder: Recorder) -> dict[str, types.ModuleType]:
    """vLLM and the transformers tokenizer it brings, enough for the `full` build."""
    vllm = types.ModuleType("vllm")
    # `importlib.util.find_spec` reads this for a module already in sys.modules, and raises on None.
    vllm.__spec__ = importlib.machinery.ModuleSpec("vllm", None)

    class AsyncEngineArgs:
        def __init__(self, **options: Any) -> None:
            self.options = options

    class SamplingParams:
        def __init__(self, **options: Any) -> None:
            self.__dict__.update(options)

    vllm.AsyncEngineArgs = AsyncEngineArgs  # type: ignore[attr-defined]
    vllm.SamplingParams = SamplingParams  # type: ignore[attr-defined]
    vllm.TokensPrompt = dict  # type: ignore[attr-defined]
    vllm.AsyncLLMEngine = types.SimpleNamespace(  # type: ignore[attr-defined]
        from_engine_args=lambda arguments: FakeAsyncLLM(recorder, arguments)
    )

    sampling = types.ModuleType("vllm.sampling_params")
    sampling.RequestOutputKind = enum.Enum("RequestOutputKind", ["CUMULATIVE", "DELTA", "FINAL_ONLY"])  # type: ignore[attr-defined]

    transformers = types.ModuleType("transformers")

    class Tokenizer:
        def __call__(self, text: str) -> dict[str, list[int]]:
            return {"input_ids": [128000, *text.encode("utf-8")]}

    transformers.AutoTokenizer = types.SimpleNamespace(from_pretrained=lambda path: Tokenizer())  # type: ignore[attr-defined]

    return {"vllm": vllm, "vllm.sampling_params": sampling, "transformers": transformers}


def install(recorder: Recorder | None = None) -> Recorder:
    """For a whole process: the served harness."""
    recorder = recorder or Recorder()
    sys.modules.update(modules(recorder))
    return recorder
