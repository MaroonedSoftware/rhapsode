"""What turns a script of Fish text into a waveform: the one place torch and upstream's code are touched.

Upstream's code is the tree `upstream.py` fetched, put on the import path before anything here
imports it. It is driven the way upstream's own server drives it, through `TTSInferenceEngine`, with
one difference: the model thread is this module's, so that its context, and with it the memory the
model holds, is a decision made here rather than the checkpoint's maximum.
"""

from __future__ import annotations

import queue
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from . import upstream

#: Positions the model's key/value cache holds, and so the longest conversation one request can be:
#: the reference's codes and transcript, every piece of text, and every piece's audio so far.
#:
#: Upstream sets up the checkpoint's whole 32,768. That cache is 36 layers x 2 x 8 heads x 128 x 32,768
#: x 2 bytes, 4.8 GB, beside 9.56 GiB of model measured on an RTX 4070 Ti SUPER, which is more than a
#: 16 GB card holds and is why upstream asks for 24 GB. At 12,288 it measured 1.69 GiB. It still fits
#: the longest request: 4,096
#: characters is about 4.5 minutes, 5,800 codec frames at 21.5 a second, with about 1,500 text tokens
#: and a 20 s reference's 430 frames, and upstream refuses a prompt within 2,048 of the end.
CONTEXT = 12_288

#: Upstream's own default for one batch's generation, about 48 s of audio at 21.5 frames a second,
#: against the 200 characters (about 13 s) a batch holds.
MAX_NEW_TOKENS = 1024

#: How upstream groups a script into batches, in UTF-8 bytes: its server's default `chunk_length`.
#: Each piece the adapter writes is at most this, so each is one batch.
CHUNK_BYTES = 200


@dataclass(frozen=True)
class Sampling:
    temperature: float
    top_p: float
    repetition_penalty: float
    seed: int | None = None


@dataclass(frozen=True)
class Reference:
    """A clip, as the bytes of a WAV file, and the exact words spoken in it."""

    audio: bytes
    text: str


class Generator(Protocol):
    def stream(
        self, script: str, sampling: Sampling, reference: Reference | None = None
    ) -> Iterator[np.ndarray]:
        """Float audio at 44.1 kHz, one batch at a time, as each is decoded."""
        ...

    def close(self) -> None: ...


class UpstreamFish:
    """S2 Pro through upstream's `TTSInferenceEngine`, on a model thread of this module's.

    The imports are here rather than at module scope so the adapter is importable, and testable,
    without torch or upstream's tree.
    """

    def __init__(self, source: Path, checkpoint: Path, device: str) -> None:
        upstream.activate(source)
        import torch
        from fish_speech.inference_engine import TTSInferenceEngine
        from fish_speech.models.dac.inference import load_model

        precision = torch.bfloat16 if device != "cpu" else torch.float32
        self._requests, self._thread = _launch(checkpoint, device, precision)
        # Loaded on the CPU, trimmed, then moved. Upstream's `load_model` reads the whole of codec.pth
        # onto the device it is given before keeping the generator's part. And the codec brought 4.58
        # GiB to an RTX 4070 Ti SUPER where its weights are 1.46: its three windowed transformers each
        # carry a 32,768-square causal mask, 1 GiB, which they never read, since they build a windowed
        # mask of their own on every call. With them, a 16 GB card loaded the model and then ran out on
        # every request. Each is replaced by an empty tensor, so a read would fail loudly rather than
        # mask wrongly. The codec reads its device from its first parameter, so upstream's engine
        # follows it to the card.
        decoder = load_model(
            config_name="modded_dac_vq", checkpoint_path=str(checkpoint / "codec.pth"), device="cpu"
        )
        _drop_unread_masks(decoder)
        decoder = decoder.to(device)
        self._engine: Any = TTSInferenceEngine(
            llama_queue=self._requests, decoder_model=decoder, precision=precision, compile=False
        )

    def stream(
        self, script: str, sampling: Sampling, reference: Reference | None = None
    ) -> Iterator[np.ndarray]:
        from fish_speech.utils.schema import ServeReferenceAudio, ServeTTSRequest

        request = ServeTTSRequest(
            text=script,
            references=[]
            if reference is None
            else [ServeReferenceAudio(audio=reference.audio, text=reference.text)],
            seed=sampling.seed,
            temperature=sampling.temperature,
            top_p=sampling.top_p,
            repetition_penalty=sampling.repetition_penalty,
            chunk_length=CHUNK_BYTES,
            max_new_tokens=MAX_NEW_TOKENS,
            # Each batch's audio as it is decoded, rather than the whole request at the end.
            streaming=True,
            # A cloned voice's clip is encoded once and kept by its hash, not on every request.
            use_memory_cache="on",
            format="wav",
        )
        for result in self._engine.inference(request):
            if result.code == "segment":
                yield np.asarray(result.audio[1], dtype=np.float32).reshape(-1)
            elif result.code == "error":
                raise result.error

    def close(self) -> None:
        """Stop the model thread, which drops the model, and wait for it."""
        self._requests.put(None)
        self._thread.join(timeout=60)
        self._engine = None


def _drop_unread_masks(codec: Any) -> None:
    """Replace the causal mask of each of the codec's windowed transformers with an empty tensor."""
    import torch
    from fish_speech.models.dac.modded_dac import WindowLimitedTransformer

    for module in codec.modules():
        if isinstance(module, WindowLimitedTransformer):
            module.causal_mask = torch.zeros(0, 0, dtype=torch.bool)


def _launch(checkpoint: Path, device: str, precision: Any) -> tuple[queue.Queue[Any], threading.Thread]:
    """Upstream's `launch_thread_safe_queue`, with the context set to CONTEXT before the cache is.

    The config's `max_seq_len` is set too, because `generate_long` measures a prompt against it: a
    cache smaller than the config believes would let a long request write past its end.
    """
    import torch
    from fish_speech.models.text2semantic.inference import (
        WrappedGenerateResponse,
        generate_long,
        init_model,
    )

    requests: queue.Queue[Any] = queue.Queue()
    ready = threading.Event()
    failed: list[BaseException] = []

    def run() -> None:
        try:
            model, decode_one_token = init_model(str(checkpoint), device, precision, compile=False)
            model.config.max_seq_len = CONTEXT
            # The causal mask is built at the checkpoint's length when the model is: 32,768 squared
            # booleans, 1 GiB, measured as the largest buffer on the card. Nothing indexes it past
            # the context, so it is cut to the context, 144 MiB, and the rest given back.
            model.causal_mask = model.causal_mask[:CONTEXT, :CONTEXT].clone()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            with torch.device(device):
                model.setup_caches(
                    max_batch_size=1, max_seq_len=CONTEXT, dtype=next(model.parameters()).dtype
                )
        except BaseException as error:
            failed.append(error)
            ready.set()
            return
        ready.set()
        while (item := requests.get()) is not None:
            try:
                for chunk in generate_long(model=model, decode_one_token=decode_one_token, **item.request):
                    item.response_queue.put(WrappedGenerateResponse(status="success", response=chunk))
            except Exception as error:
                item.response_queue.put(WrappedGenerateResponse(status="error", response=error))
            finally:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()

    thread = threading.Thread(target=run, name="fish-model", daemon=True)
    thread.start()
    ready.wait()
    if failed:
        raise failed[0]
    return requests, thread
