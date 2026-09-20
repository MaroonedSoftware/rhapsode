"""What turns a line of Dia text into a waveform: the one place torch and transformers are touched.

Behind a protocol so that the engine decides what to say and a backend only says it. There is one
backend so far, the 1.6B model through transformers. Dia2 is a different package with a different
codec, and would be a second backend rather than a change to this one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np

from .builds import CODEC_REPOSITORY, CODEC_REVISION, REPOSITORY, REVISION

#: The most decoder positions one generation may fill, prompt included: the checkpoint's own
#: `max_length` and its decoder's `max_position_embeddings`. At upstream's 86 frames a second that is
#: about 35 s. The processor counts a reference clip against it too, which is why a cloned voice's
#: clip is kept short.
MAX_POSITIONS = 3072


@dataclass(frozen=True)
class Sampling:
    cfg_scale: float
    temperature: float
    top_p: float
    seed: int | None = None


@dataclass(frozen=True)
class Prompt:
    """Audio the model continues from, and the words spoken in it.

    Upstream's cloning is a continuation: the model is handed the clip as the start of its own output
    and the clip's transcript as the start of the text, then asked for what comes next. So both halves
    are required, and a transcript that does not match the clip degrades the voice with no error.
    """

    audio: np.ndarray
    text: str


@dataclass(frozen=True)
class Spoken:
    """One generation's audio, without the prompt it continued from."""

    audio: np.ndarray
    #: Whether the model was still speaking when it ran out of room, so the audio stops mid-word:
    #: it filled the decoder's positions, or it ran through the budget it was given.
    exhausted: bool


class Generator(Protocol):
    def generate(
        self, text: str, sampling: Sampling, prompt: Prompt | None = None, max_new_tokens: int | None = None
    ) -> Spoken: ...

    def close(self) -> None: ...


class TransformersDia:
    """The 1.6B model through transformers' `DiaForConditionalGeneration`.

    The imports are here rather than at module scope so the adapter is importable, and testable,
    without torch.
    """

    def __init__(self, device: str) -> None:
        import torch
        from transformers import (
            DacModel,
            DiaFeatureExtractor,
            DiaForConditionalGeneration,
            DiaProcessor,
            DiaTokenizer,
        )

        self._torch = torch
        self._device = device
        # The processor built from its parts rather than by `AutoProcessor`, which loads the codec
        # itself by the bare name in `audio_tokenizer_config.json`, ignoring one it is handed, and
        # passes it the checkpoint's own `revision`: a commit the codec's repository does not have, so
        # every load failed with "descript/dac_44khz does not appear to have a file named
        # model.safetensors" (measured, transformers 5.17). Built here, each part has its own pin, and
        # the codec is on the device rather than the CPU, where every clip it encoded and every line it
        # decoded would be copied off the device and back.
        codec = DacModel.from_pretrained(CODEC_REPOSITORY, revision=CODEC_REVISION).to(device).eval()
        self._processor = DiaProcessor(
            feature_extractor=DiaFeatureExtractor.from_pretrained(REPOSITORY, revision=REVISION),
            tokenizer=DiaTokenizer.from_pretrained(REPOSITORY, revision=REVISION),
            audio_tokenizer=codec,
        )
        self._model = (
            DiaForConditionalGeneration.from_pretrained(
                REPOSITORY, revision=REVISION, dtype=_dtype(torch, device)
            )
            .to(device)
            .eval()
        )

    def generate(
        self, text: str, sampling: Sampling, prompt: Prompt | None = None, max_new_tokens: int | None = None
    ) -> Spoken:
        if sampling.seed is not None:
            _seed(sampling.seed)

        processor, model = self._processor, self._model
        with self._torch.inference_mode():
            if prompt is None:
                inputs = processor(text=[text], padding=True, return_tensors="pt")
            else:
                inputs = processor(
                    text=[f"{prompt.text} {text}"], audio=[prompt.audio], padding=True, return_tensors="pt"
                )
            inputs = inputs.to(self._device)
            prompt_length = (
                processor.get_audio_prompt_len(inputs["decoder_attention_mask"])
                if prompt is not None
                else None
            )
            outputs = model.generate(
                **inputs,
                guidance_scale=sampling.cfg_scale,
                temperature=sampling.temperature,
                top_p=sampling.top_p,
                # Counts what is generated, so a prompt does not eat into it.
                **({} if max_new_tokens is None else {"max_new_tokens": max_new_tokens}),
            )
            audio = processor.batch_decode(outputs, audio_prompt_len=prompt_length)[0]

        # A generation that stopped by itself is shorter than what it was allowed; one that used all
        # of it was still speaking. The delay pattern puts a few frames on the end either way, so this
        # counts a generation within a frame or two of its limit as cut off, which it is.
        start = prompt_length if prompt_length is not None else 1
        generated = int(outputs.shape[1]) - start
        exhausted = generated >= MAX_POSITIONS - start or (
            max_new_tokens is not None and generated >= max_new_tokens
        )
        return Spoken(audio=np.asarray(audio.float().cpu().numpy(), dtype=np.float32), exhausted=exhausted)

    def close(self) -> None:
        self._model = None
        self._processor = None


def _dtype(torch: Any, device: str) -> Any:
    """bfloat16 on an NVIDIA card, where upstream measured it at 4.4 GB of VRAM and 1.5 times real
    time on a 4090 against 7.9 GB and 0.9 in float32. float32 elsewhere, until measured otherwise."""
    return torch.bfloat16 if device == "cuda" else torch.float32


def _seed(seed: int) -> None:
    """Upstream's own `set_seed`, from its CLI: `generate` takes no seed, so reproducibility is every
    generator the model draws from, and cuDNN told not to pick its algorithms by timing."""
    import random

    import torch

    random.seed(seed)
    np.random.seed(seed % 2**32)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
