"""What turns a line of Breeze text into a waveform: the one place torch and upstream's code are touched.

Behind a protocol so that the engine decides what to say and a backend only says it. Upstream's code
comes from `rhapsode-vendor-breeze`, a copy of breezeblue-ai/breeze-tts at one commit (protocol.md
§ 10), and is called the way its own `infer.py` calls it: the eager path, one request at a time.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Protocol

import numpy as np

#: The most codec frames one generation may produce, and the most positions it may fill with its
#: prompt: upstream's `infer.py` uses both, against `FastStreamingConfig`'s defaults of 750 and 1024.
#: At 12.5 frames a second, 1500 is two minutes, far beyond any piece this adapter sends, so a piece
#: that reaches it is a model that did not stop rather than text that was too long.
MAX_NEW_TOKENS = 1500
MAX_SEQ_LEN = 2048

#: Upstream's own, from `infer.py`. Not a dial: upstream exposes no way to change it and names no
#: range it was tested over.
REPETITION_PENALTY = 1.1

#: Samples per codec frame: the audio tokenizer's `decode_upsample_rate`, 24 kHz at 12.5 frames a second.
SAMPLES_PER_FRAME = 1920


@dataclass(frozen=True)
class Sampling:
    temperature: float
    top_p: float
    seed: int | None = None


@dataclass(frozen=True)
class Prompt:
    """A clip the model clones from, and the exact words spoken in it.

    Upstream's cloning template puts the transcript, then the clip's codes, then the new text, so both
    halves are required, and upstream says the transcript must be exact. It reads the clip from a path.
    """

    path: Path
    text: str


class Generator(Protocol):
    def stream(self, text: str, sampling: Sampling, prompt: Prompt | None = None) -> Iterator[np.ndarray]:
        """Float audio in [-1, 1] at 24 kHz, a chunk at a time, as the model makes it."""
        ...

    def close(self) -> None: ...


class EagerBreeze:
    """Breeze TTS 2 through upstream's streaming runtime, every fast-path stage off.

    Eager rather than `--fast-all` because upstream measures the fast path at 14.4 GiB against eager's
    7.7, puts its minimum at a 24 GB card against eager's 12, and pays for it in a warmup at every
    load. Eager is what fits beside another model on a 16 GB card.

    The imports are here rather than at module scope so the adapter is importable, and testable,
    without torch.
    """

    def __init__(self, checkpoint: Path, device: str) -> None:
        from breeze_infer.runtime import load_runtime, update_generation_config_for_breeze
        from models.fast_streaming import FastBreezeStreamingRuntime, FastStreamingConfig

        tokenizer, model, audio_tokenizer = load_runtime(
            checkpoint, device=device, attn_implementation="eager"
        )
        update_generation_config_for_breeze(model)
        self._tokenizer: Any = tokenizer
        self._model: Any = model
        self._audio_tokenizer: Any = audio_tokenizer
        self._runtime: Any = FastBreezeStreamingRuntime(
            model,
            audio_tokenizer,
            FastStreamingConfig(
                max_new_tokens=MAX_NEW_TOKENS,
                max_seq_len=MAX_SEQ_LEN,
                fast_all=False,
                repetition_penalty=REPETITION_PENALTY,
            ),
            tokenizer=tokenizer,
        )

    def stream(self, text: str, sampling: Sampling, prompt: Prompt | None = None) -> Iterator[np.ndarray]:
        from breeze_infer.templates import get_template, prepare_inputs, select_template_name

        request: dict[str, Any] = {"id": "rhapsode", "text": text, "speaker": "S0"}
        if prompt is not None:
            request["ref_audio_path"] = str(prompt.path)
            request["ref_text"] = prompt.text
        inputs = prepare_inputs(
            self._tokenizer,
            self._audio_tokenizer,
            self._model,
            [request],
            get_template(select_template_name(request)),
            # 1 is off, and the only value the plain and cloning templates accept: neither defines
            # the negative prompt guidance needs, and `prepare_inputs` raises on anything else.
            guidance_scale=1.0,
            guidance_scale_ref=None,
            guidance_scale_ins=None,
        )
        # The runtime reads its sampling from its config on every request, so a request's dials are
        # a replaced config rather than a second runtime and a second set of caches.
        self._runtime.config = replace(
            self._runtime.config, temperature=sampling.temperature, top_p=sampling.top_p
        )
        for chunk in self._runtime.iter_audio_chunks(inputs, request_id="rhapsode", seed=sampling.seed):
            yield np.asarray(chunk.audio, dtype=np.float32).reshape(-1)

    def close(self) -> None:
        self._runtime = None
        self._model = None
        self._audio_tokenizer = None
        self._tokenizer = None
