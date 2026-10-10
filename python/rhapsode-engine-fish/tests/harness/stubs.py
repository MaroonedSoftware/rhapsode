"""A Fish that is not Fish: torch, the hub and upstream's `fish_speech`, as fakes.

The real ones bring torch, upstream's tree and 11 GB of weights, which is why every engine gets its
own virtualenv and why none of them is in this repository's dev environment. What is under test is
the adapter: the script it builds, the reference it passes, the sampling it asks for, the model
thread it runs and what it does with what comes back. The fakes answer all of those through the
calls the backend makes of upstream, and behave as upstream does where the adapter depends on it:
a script is batched only at speaker tags, a request's bounds are validated, and the model thread
answers through the queue `TTSInferenceEngine` reads.

Their output varies with everything they were given, because that is what a real model does and it
is the only way the conformance suite can see that a cue, a dial or a seed reached the model. The
audio is noise; only its length and its content depend on the input. The noise is drawn from torch's
global generator, so a request that is not seeded is not reproducible, as it is not for real.

What this cannot check is whether the audio is speech, or whether `[sigh]` is performed. Only real
weights answer that.
"""

from __future__ import annotations

import contextlib
import hashlib
import queue
import random
import re
import sys
import types
import wave
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, ClassVar

import numpy as np

SAMPLE_RATE = 44_100
#: The codec's samples per frame, 21.5 frames a second.
HOP = 2048


@dataclass
class Batch:
    """One batch upstream's `generate_long` generated, kept so a test can assert on it."""

    text: str
    prompt_texts: list[str]
    prompt_audio: list[bytes]
    sampling: dict[str, Any]
    seed: int | None
    frames: int


@dataclass
class Recorder:
    batches: list[Batch] = field(default_factory=list)
    loads: list[dict[str, Any]] = field(default_factory=list)
    downloads: list[dict[str, Any]] = field(default_factory=list)
    #: Every reference clip upstream's codec encoded, in order.
    encodes: list[bytes] = field(default_factory=list)
    #: How many frames each batch speaks. None is "in proportion to the text".
    frames: int | None = None


# ---------------------------------------------------------------------------- upstream's schema


class ValidationError(ValueError):
    pass


class ServeReferenceAudio:
    def __init__(self, audio: bytes, text: str) -> None:
        self.audio, self.text = audio, text


class ServeTTSRequest:
    """Upstream's request, with the bounds it validates, which are the adapter's dials' bounds."""

    BOUNDS: ClassVar[dict[str, tuple[float, float]]] = {
        "chunk_length": (100, 1000),
        "top_p": (0.1, 1.0),
        "repetition_penalty": (0.9, 2.0),
        "temperature": (0.1, 1.0),
    }

    def __init__(self, **fields: Any) -> None:
        defaults: dict[str, Any] = {
            "references": [],
            "seed": None,
            "chunk_length": 200,
            "max_new_tokens": 1024,
            "top_p": 0.8,
            "repetition_penalty": 1.1,
            "temperature": 0.8,
            "streaming": False,
            "use_memory_cache": "off",
            "format": "wav",
        }
        values = {**defaults, **fields}
        for name, (low, high) in self.BOUNDS.items():
            if not low <= values[name] <= high:
                raise ValidationError(f"{name} {values[name]} is outside [{low}, {high}]")
        self.__dict__.update(values)


# ---------------------------------------------------------------------------- upstream's model thread


@dataclass
class GenerateResponse:
    action: str
    codes: np.ndarray | None = None
    text: str | None = None


@dataclass
class WrappedGenerateResponse:
    status: str
    response: Any = None


@dataclass
class GenerateRequest:
    request: dict[str, Any]
    response_queue: queue.Queue[Any]


@dataclass
class Config:
    max_seq_len: int = 32_768


class Mask:
    """Enough of the causal mask for a 2-D slice and `.clone()`: only its shape is ever read."""

    def __init__(self, rows: int, columns: int) -> None:
        self.shape = (rows, columns)

    def __getitem__(self, index: tuple[slice, slice]) -> Mask:
        rows, columns = index
        return Mask(len(range(*rows.indices(self.shape[0]))), len(range(*columns.indices(self.shape[1]))))

    def clone(self) -> Mask:
        return Mask(*self.shape)


class Model:
    def __init__(self, recorder: Recorder) -> None:
        self.recorder = recorder
        self.config = Config()
        self.cache: int | None = None
        # Built at the checkpoint's length, as upstream's is.
        self.causal_mask = Mask(self.config.max_seq_len, self.config.max_seq_len)

    def setup_caches(self, max_batch_size: int, max_seq_len: int, dtype: Any) -> None:
        self.cache = max_seq_len
        self.recorder.loads.append(
            {"cache": max_seq_len, "config": self.config.max_seq_len, "mask": self.causal_mask.shape}
        )

    def parameters(self) -> Iterator[Any]:
        yield types.SimpleNamespace(dtype="bfloat16")


def split_by_speaker(text: str) -> list[str]:
    """Upstream's `split_text_by_speaker`: turns begin at `<|speaker:N|>`, and untagged text is none."""
    parts = re.split(r"(<\|speaker:\d+\|>)", text)
    turns, index = [], 0
    while index < len(parts):
        if re.fullmatch(r"<\|speaker:\d+\|>", parts[index].strip()):
            turns.append((parts[index] + (parts[index + 1] if index + 1 < len(parts) else "")).strip())
            index += 2
        else:
            index += 1
    return turns


def batches(text: str, max_bytes: int) -> list[str]:
    """Upstream's `group_turns_into_batches`, which an untagged text skips: it is one batch."""
    turns = split_by_speaker(text)
    if not turns:
        return [text]
    grouped: list[list[str]] = []
    size = 0
    for turn in turns:
        length = len(turn.encode())
        if grouped and (len(grouped[-1]) >= 5 or size + length > max_bytes):
            grouped.append([turn])
            size = length
        elif grouped:
            grouped[-1].append(turn)
            size += length
        else:
            grouped.append([turn])
            size = length
    return ["\n".join(group) for group in grouped]


# ---------------------------------------------------------------------------- the modules


def modules(recorder: Recorder) -> dict[str, types.ModuleType]:
    """The fakes, as the modules the adapter imports."""
    torch = types.ModuleType("torch")
    torch.bfloat16 = "bfloat16"  # type: ignore[attr-defined]
    torch.float32 = "float32"  # type: ignore[attr-defined]
    torch.bool = "bool"  # type: ignore[attr-defined]
    torch.zeros = lambda *shape, dtype=None: Mask(*shape)  # type: ignore[attr-defined]
    torch.device = lambda name: contextlib.nullcontext()  # type: ignore[attr-defined]
    torch.inference_mode = contextlib.nullcontext  # type: ignore[attr-defined]
    torch.cuda = types.SimpleNamespace(is_available=lambda: False, empty_cache=lambda: None)  # type: ignore[attr-defined]
    torch.mps = types.SimpleNamespace(empty_cache=lambda: None)  # type: ignore[attr-defined]
    torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False))  # type: ignore[attr-defined]
    torch.generator = random.Random()  # type: ignore[attr-defined]
    torch.seeded = None  # type: ignore[attr-defined]

    def set_seed(seed: int) -> None:
        torch.generator = random.Random(seed)  # type: ignore[attr-defined]
        torch.seeded = seed  # type: ignore[attr-defined]

    t2s = types.ModuleType("fish_speech.models.text2semantic.inference")

    def init_model(checkpoint: str, device: str, precision: Any, compile: bool = False) -> tuple[Model, Any]:
        recorder.loads.append(
            {"model": checkpoint, "device": device, "precision": precision, "compile": compile}
        )
        return Model(recorder), "decode_one_token"

    def generate_long(*, model: Model, decode_one_token: Any, **request: Any) -> Iterator[GenerateResponse]:
        assert request["iterative_prompt"] and model.cache is not None
        for text in batches(request["text"], request["chunk_length"]):
            frames = recorder.frames if recorder.frames is not None else 10 + len(text.encode()) // 4
            noise = torch.generator.getrandbits(32)  # type: ignore[attr-defined]
            sampling = {name: request[name] for name in ("temperature", "top_p", "repetition_penalty")}
            recorder.batches.append(
                Batch(
                    text=text,
                    prompt_texts=list(request["prompt_text"]),
                    prompt_audio=[bytes(tokens) for tokens in request["prompt_tokens"]],
                    sampling=sampling,
                    seed=torch.seeded,  # type: ignore[attr-defined]
                    frames=frames,
                )
            )
            heard = [hashlib.sha256(bytes(tokens)).hexdigest() for tokens in request["prompt_tokens"]]
            digest = (
                int.from_bytes(
                    hashlib.sha256(repr((text, heard, sorted(sampling.items()), noise)).encode()).digest()[
                        :8
                    ],
                    "little",
                )
                >> 2
            )  # Inside an int64, which the codes are.
            codes = np.full((10, frames), digest % 4096, dtype=np.int64)
            codes[0, 0] = digest
            yield GenerateResponse(action="sample", codes=codes, text=text)
        yield GenerateResponse(action="next")

    t2s.init_model = init_model  # type: ignore[attr-defined]
    t2s.generate_long = generate_long  # type: ignore[attr-defined]
    t2s.WrappedGenerateResponse = WrappedGenerateResponse  # type: ignore[attr-defined]
    t2s.GenerateRequest = GenerateRequest  # type: ignore[attr-defined]
    t2s.GenerateResponse = GenerateResponse  # type: ignore[attr-defined]

    dac = types.ModuleType("fish_speech.models.dac.inference")

    class WindowLimitedTransformer:
        """Each of the codec's three carries a mask at 32,768 squared, as upstream's do."""

        def __init__(self) -> None:
            self.causal_mask = Mask(32_768, 32_768)

    class Codec:
        """Reads its device from where it was last put, as the real one reads its first parameter's."""

        sample_rate = SAMPLE_RATE

        def __init__(self, device: str) -> None:
            self.device = types.SimpleNamespace(type=device)
            self.transformers = [WindowLimitedTransformer() for _ in range(3)]

        def modules(self) -> Iterator[Any]:
            yield self
            yield from self.transformers

        def to(self, device: str) -> Codec:
            masks = [transformer.causal_mask.shape for transformer in self.transformers]
            recorder.loads.append({"codec moved": device, "masks": masks})
            self.device = types.SimpleNamespace(type=device)
            return self

    def load_model(config_name: str, checkpoint_path: str, device: str = "cuda") -> Any:
        recorder.loads.append({"codec": checkpoint_path, "config_name": config_name, "device": device})
        return Codec(device)

    dac.load_model = load_model  # type: ignore[attr-defined]

    modded_dac = types.ModuleType("fish_speech.models.dac.modded_dac")
    modded_dac.WindowLimitedTransformer = WindowLimitedTransformer  # type: ignore[attr-defined]

    engine_module = types.ModuleType("fish_speech.inference_engine")

    @dataclass
    class InferenceResult:
        code: str
        audio: tuple[int, np.ndarray] | None
        error: Exception | None

    class TTSInferenceEngine:
        """Upstream's, as far as the adapter depends on it: references encoded, or found in its cache
        by the clip's hash, the seed set, the request sent to the model thread through its queue, and
        each batch decoded as it arrives. The cache keeps the transcript it first saw beside the codes,
        as upstream's `load_by_hash` does."""

        def __init__(
            self, llama_queue: queue.Queue[Any], decoder_model: Any, precision: Any, compile: bool
        ) -> None:
            self.llama_queue = llama_queue
            self.decoder_model = decoder_model
            self.ref_by_hash: dict[str, tuple[Any, str]] = {}

        def encode_reference(self, reference_audio: bytes, enable_reference_audio: bool) -> Any:
            """The clip's codes. These are its bytes, so a test can see which clip reached the model.
            The clip is loaded first, as upstream's is, at the codec's rate."""
            assert enable_reference_audio
            audio = self.load_audio(reference_audio, SAMPLE_RATE)
            assert audio.dtype == np.float32 and audio.ndim == 1 and audio.size > 0
            recorder.encodes.append(reference_audio)
            return reference_audio

        def load_audio(self, reference_audio: bytes, sr: int) -> np.ndarray:
            """Upstream's, as it behaves on torchaudio 2.9 and later without torchcodec installed."""
            raise ImportError("TorchCodec is required for load_with_torchcodec.")

        def load_by_hash(self, references: list[Any], use_cache: str) -> tuple[list[Any], list[str]]:
            tokens, texts = [], []
            for reference in references:
                key = hashlib.sha256(reference.audio).hexdigest()
                if use_cache == "off" or key not in self.ref_by_hash:
                    self.ref_by_hash[key] = (
                        self.encode_reference(reference_audio=reference.audio, enable_reference_audio=True),
                        reference.text,
                    )
                cached_tokens, cached_text = self.ref_by_hash[key]
                tokens.append(cached_tokens)
                texts.append(cached_text)
            return tokens, texts

        def send_Llama_request(
            self, req: ServeTTSRequest, prompt_tokens: list[Any], prompt_texts: list[str]
        ) -> queue.Queue[Any]:
            response_queue: queue.Queue[Any] = queue.Queue()
            self.llama_queue.put(
                GenerateRequest(
                    request={
                        "text": req.text,
                        "max_new_tokens": req.max_new_tokens,
                        "top_p": req.top_p,
                        "repetition_penalty": req.repetition_penalty,
                        "temperature": req.temperature,
                        "compile": False,
                        "iterative_prompt": req.chunk_length > 0,
                        "chunk_length": req.chunk_length,
                        "prompt_tokens": prompt_tokens,
                        "prompt_text": prompt_texts,
                    },
                    response_queue=response_queue,
                )
            )
            return response_queue

        def inference(self, req: ServeTTSRequest) -> Iterator[InferenceResult]:
            prompt_tokens: list[Any] = []
            prompt_texts: list[str] = []
            if req.references:
                prompt_tokens, prompt_texts = self.load_by_hash(req.references, req.use_memory_cache)
            if req.seed is not None:
                set_seed(req.seed)
            response_queue = self.send_Llama_request(req, prompt_tokens, prompt_texts)
            segments = []
            while True:
                wrapped = response_queue.get()
                if wrapped.status == "error":
                    yield InferenceResult(code="error", audio=None, error=wrapped.response)
                    return
                if wrapped.response.action == "next":
                    break
                codes = wrapped.response.codes
                samples = np.random.default_rng(int(codes[0, 0])).uniform(-0.5, 0.5, codes.shape[1] * HOP)
                segment = samples.astype(np.float32)
                if req.streaming:
                    yield InferenceResult(code="segment", audio=(SAMPLE_RATE, segment), error=None)
                segments.append(segment)
            yield InferenceResult(code="final", audio=(SAMPLE_RATE, np.concatenate(segments)), error=None)

    engine_module.TTSInferenceEngine = TTSInferenceEngine  # type: ignore[attr-defined]

    schema = types.ModuleType("fish_speech.utils.schema")
    schema.ServeTTSRequest = ServeTTSRequest  # type: ignore[attr-defined]
    schema.ServeReferenceAudio = ServeReferenceAudio  # type: ignore[attr-defined]

    hub = types.ModuleType("huggingface_hub")

    def snapshot_download(**arguments: Any) -> str:
        recorder.downloads.append(arguments)
        return f"/models/{arguments['repo_id']}"

    hub.snapshot_download = snapshot_download  # type: ignore[attr-defined]

    packages = {
        name: types.ModuleType(name)
        for name in (
            "fish_speech",
            "fish_speech.models",
            "fish_speech.models.text2semantic",
            "fish_speech.models.dac",
            "fish_speech.utils",
        )
    }
    return {
        "torch": torch,
        **packages,
        "fish_speech.models.text2semantic.inference": t2s,
        "fish_speech.models.dac.inference": dac,
        "fish_speech.models.dac.modded_dac": modded_dac,
        "fish_speech.inference_engine": engine_module,
        "fish_speech.utils.schema": schema,
        "huggingface_hub": hub,
        "soundfile": soundfile_module(),
    }


def soundfile_module() -> types.ModuleType:
    """soundfile, for WAV only, through the standard library. Anything else is unreadable, as a file
    libsndfile could not decode is."""
    soundfile = types.ModuleType("soundfile")

    def read(source: Any, dtype: str = "float64", always_2d: bool = False) -> tuple[np.ndarray, int]:
        with wave.open(source, "rb") as clip:
            channels, rate = clip.getnchannels(), clip.getframerate()
            pcm = np.frombuffer(clip.readframes(clip.getnframes()), dtype="<i2")
        audio = (pcm.astype(dtype) / 32768.0).reshape(-1, channels)
        return (audio if always_2d or channels > 1 else audio[:, 0]), rate

    soundfile.read = read  # type: ignore[attr-defined]
    return soundfile


def install(recorder: Recorder | None = None) -> Recorder:
    """For a whole process: the served harness."""
    recorder = recorder or Recorder()
    sys.modules.update(modules(recorder))
    return recorder
