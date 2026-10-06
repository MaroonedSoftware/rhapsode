"""A Breeze that is not Breeze: torch, the hub and upstream's runtime, as fakes.

The real ones bring torch, a CUDA card and 7.7 GB of weights, which is why every engine gets its own
virtualenv and why none of them is in this repository's dev environment. What is under test is the
adapter: the text it builds, the template it picks, the sampling it asks for, the prompt it clones
from and what it does with what comes back. The fakes answer all of those through the calls the
backend makes of upstream's `breeze_infer` and `models` packages, and refuse what upstream refuses.

Their output varies with everything they were given, because that is what a real model does and it
is the only way the conformance suite can see that a cue, a dial or a seed reached the model. The
audio is noise; only its length and its content depend on the input. The noise is drawn from torch's
global generator, so a request that is not seeded is not reproducible, as it is not for real.

What this cannot check is whether the audio is speech, or whether `(laugh)` is performed. Only real
weights answer that, and `rhapsode-conform` against a real install is where it gets asked.
"""

from __future__ import annotations

import hashlib
import random
import sys
import types
import wave
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

#: Samples per codec frame, and frames per chunk on upstream's eager path.
SAMPLES_PER_FRAME = 1920
CHUNK_FRAMES = 2


@dataclass
class Generation:
    """One call to `iter_audio_chunks`, kept so a test can assert on what the adapter asked for."""

    template: str
    text: str
    ref_text: str | None
    ref_audio: bytes | None
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


@dataclass(frozen=True)
class FastStreamingConfig:
    """Upstream's, field for field where the adapter sets one."""

    max_new_tokens: int = 750
    max_seq_len: int = 1024
    fast_all: bool | None = None
    temperature: float | None = None
    top_k: int | None = None
    top_p: float | None = None
    repetition_penalty: float = 1.1


@dataclass(frozen=True)
class FastStreamingChunk:
    audio: np.ndarray
    sample_rate: int
    codec_frames: int
    is_final: bool


@dataclass(frozen=True)
class TemplateSpec:
    name: str
    required_fields: tuple[str, ...]


TEMPLATES = {
    "tts_plain": TemplateSpec("tts_plain", ("text",)),
    "tts_instruction": TemplateSpec("tts_instruction", ("text", "instruction")),
    "ref_clone_tata": TemplateSpec("ref_clone_tata", ("text", "ref_audio_path", "ref_text")),
    "ref_edit_tata": TemplateSpec("ref_edit_tata", ("text", "instruction", "ref_audio_path", "ref_text")),
}


def select_template_name(request: dict[str, Any]) -> str:
    """Upstream's rule, verbatim in effect: a clip and its transcript together or not at all."""
    if bool(request.get("ref_audio_path")) != bool(request.get("ref_text")):
        raise ValueError("ref_audio_path and ref_text must be provided together")
    instruction = bool(str(request.get("instruction") or "").strip())
    if request.get("ref_audio_path"):
        return "ref_edit_tata" if instruction else "ref_clone_tata"
    return "tts_instruction" if instruction else "tts_plain"


def get_template(name: str) -> TemplateSpec:
    return TEMPLATES[name]


def prepare_inputs(
    tokenizer: Any,
    audio_tokenizer: Any,
    model: Any,
    requests: list[dict[str, Any]],
    template: TemplateSpec,
    *,
    guidance_scale: float,
    guidance_scale_ref: float | None,
    guidance_scale_ins: float | None,
) -> dict[str, Any]:
    """What upstream checks, and the clip read from its path as upstream reads it."""
    (request,) = requests
    missing = [name for name in template.required_fields if not request.get(name)]
    if missing:
        raise ValueError(f"Request {request.get('id')} missing template fields: {missing}")
    # Upstream raises here: the plain and cloning templates define no negative prompt.
    if guidance_scale != 1.0 and template.name in ("tts_plain", "ref_clone_tata"):
        raise ValueError(f"Template '{template.name}' does not define a negative prompt")
    clip = request.get("ref_audio_path")
    return {
        "template": template.name,
        "text": f"[{request['speaker']}]{request['text']}",
        "ref_text": request.get("ref_text"),
        "ref_audio": None if clip is None else Path(clip).read_bytes(),
    }


class Runtime:
    """`FastBreezeStreamingRuntime`, as far as the adapter reaches into it."""

    def __init__(
        self,
        recorder: Recorder,
        torch: types.ModuleType,
        model: Any,
        audio_tokenizer: Any,
        config: Any,
        *,
        tokenizer: Any,
    ) -> None:
        recorder.loads.append({"runtime": config})
        self.recorder = recorder
        self.torch = torch
        self.config = config
        self.sample_rate = 24_000

    def iter_audio_chunks(
        self, inputs: dict[str, Any], *, request_id: str | None = None, seed: int | None = None
    ) -> Iterator[FastStreamingChunk]:
        if seed is not None:
            self.torch.manual_seed(seed)
        recorder = self.recorder
        frames = recorder.frames if recorder.frames is not None else 20 + len(inputs["text"].encode()) // 2
        frames = min(frames, self.config.max_new_tokens)
        sampling = {"temperature": self.config.temperature, "top_p": self.config.top_p}
        recorder.generations.append(
            Generation(
                template=inputs["template"],
                text=inputs["text"],
                ref_text=inputs["ref_text"],
                ref_audio=inputs["ref_audio"],
                sampling=sampling,
                seed=seed,
                frames=frames,
            )
        )
        noise = self.torch.generator.getrandbits(32)  # type: ignore[attr-defined]
        heard = None if inputs["ref_audio"] is None else hashlib.sha256(inputs["ref_audio"]).hexdigest()
        digest = int.from_bytes(
            hashlib.sha256(
                repr((inputs["text"], inputs["ref_text"], heard, sorted(sampling.items()), noise)).encode()
            ).digest()[:8],
            "little",
        )
        samples = (
            np.random.default_rng(digest).uniform(-0.5, 0.5, frames * SAMPLES_PER_FRAME).astype(np.float32)
        )
        step = CHUNK_FRAMES * SAMPLES_PER_FRAME
        for start in range(0, samples.size, step):
            yield FastStreamingChunk(
                audio=samples[start : start + step],
                sample_rate=24_000,
                codec_frames=CHUNK_FRAMES,
                is_final=start + step >= samples.size,
            )


def modules(recorder: Recorder) -> dict[str, types.ModuleType]:
    """The fakes, as the modules the adapter imports."""
    torch = types.ModuleType("torch")
    torch.cuda = types.SimpleNamespace(  # type: ignore[attr-defined]
        is_available=lambda: True,
        current_device=lambda: 0,
        get_device_properties=lambda index: types.SimpleNamespace(name="Fake RTX", total_memory=16 * 2**30),
        empty_cache=lambda: None,
        manual_seed_all=lambda seed: None,
    )
    torch.version = types.SimpleNamespace(hip=None)  # type: ignore[attr-defined]
    torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False))  # type: ignore[attr-defined]
    # The global generator, unseeded until somebody seeds it, as torch's is.
    torch.generator = random.Random()  # type: ignore[attr-defined]

    def manual_seed(seed: int) -> None:
        torch.generator = random.Random(seed)  # type: ignore[attr-defined]

    torch.manual_seed = manual_seed  # type: ignore[attr-defined]

    runtime_module = types.ModuleType("breeze_infer.runtime")

    def load_runtime(ckpt_dir: Path, *, device: str, attn_implementation: str) -> tuple[Any, Any, Any]:
        assert isinstance(ckpt_dir, Path), "upstream joins `audio_tokenizer` onto it with /"
        # Upstream hands it to `torch.cuda.set_device`, which refuses a device with no index.
        if device.startswith("cuda") and ":" not in device:
            raise ValueError(f"Expected a torch.device with a specified index, but got:{device}")
        recorder.loads.append({"checkpoint": ckpt_dir, "device": device, "attention": attn_implementation})
        return "tokenizer", types.SimpleNamespace(generation_config={}), "audio tokenizer"

    def update_generation_config_for_breeze(model: Any) -> None:
        model.generation_config = {"temperature": 0.9, "top_p": 1.0, "top_k": 50}

    runtime_module.load_runtime = load_runtime  # type: ignore[attr-defined]
    runtime_module.update_generation_config_for_breeze = update_generation_config_for_breeze  # type: ignore[attr-defined]

    templates_module = types.ModuleType("breeze_infer.templates")
    templates_module.select_template_name = select_template_name  # type: ignore[attr-defined]
    templates_module.get_template = get_template  # type: ignore[attr-defined]
    templates_module.prepare_inputs = prepare_inputs  # type: ignore[attr-defined]

    streaming_module = types.ModuleType("models.fast_streaming")
    streaming_module.FastStreamingConfig = FastStreamingConfig  # type: ignore[attr-defined]
    streaming_module.FastBreezeStreamingRuntime = (  # type: ignore[attr-defined]
        lambda model, audio_tokenizer, config, *, tokenizer: Runtime(
            recorder, torch, model, audio_tokenizer, config, tokenizer=tokenizer
        )
    )

    hub = types.ModuleType("huggingface_hub")

    def snapshot_download(**arguments: Any) -> str:
        recorder.downloads.append(arguments)
        return f"/models/{arguments['repo_id']}"

    hub.snapshot_download = snapshot_download  # type: ignore[attr-defined]

    return {
        "torch": torch,
        "breeze_infer": types.ModuleType("breeze_infer"),
        "breeze_infer.runtime": runtime_module,
        "breeze_infer.templates": templates_module,
        "models": types.ModuleType("models"),
        "models.fast_streaming": streaming_module,
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
