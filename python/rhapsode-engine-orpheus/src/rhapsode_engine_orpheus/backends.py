"""Where the model's tokens come from.

Everything the adapter decides (the prompt, the cues, the framing, the voices) is the same whichever
runtime executes the Llama, so the runtime sits behind one method. A backend is handed the text and
the sampling, and hands back token ids until the model says it has finished speaking.
"""

from __future__ import annotations

import random
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any, Protocol

from .prompt import END_OF_SPEECH, MAX_TOKENS, framed

#: Prompt and answer together. A segment is at most about 60 tokens of text and an answer at most
#: `MAX_TOKENS`, so 2048 holds both with room to spare, and the KV cache it costs is small beside
#: the weights.
CONTEXT_TOKENS = 2048

#: Tokens to a block of vLLM's KV cache. Its default on FlashAttention, pinned because the budget
#: below counts in blocks, and every attention backend vLLM offers a CUDA card supports it.
KV_BLOCK_TOKENS = 16

#: The KV cache the `full` build gives vLLM: one `CONTEXT_TOKENS` sequence, keys and values, for the
#: finetune's 28 layers of 8 KV heads of 128 in bfloat16, and one block more, because vLLM keeps a
#: block back as its null block: exactly 2048 tokens' worth refused to load with "the estimated
#: maximum model length is 2032". That is 0.22 GiB, and with one sequence at a time there is nothing
#: more cache could hold. Left to infer it, vLLM gives the KV cache whatever its budget minus its
#: profiled peak leaves, and on a cold compile cache that peak counts Inductor compiling the graph as
#: activations: on an RTX 4070 Ti SUPER (vLLM 0.31) the peak rose 0.92 GiB cold against 0.14 warm,
#: the card was 9.06 GiB free after profiling either way, and the cold figure left -0.41 GiB for
#: cache. Every first load failed "No available memory for the cache blocks", and only the SDK's
#: retry, on the cache the failure had just filled, came up: 50 s, where one load that compiles
#: takes 35.
KV_CACHE_BYTES = (CONTEXT_TOKENS + KV_BLOCK_TOKENS) * 28 * 2 * 8 * 128 * 2


@dataclass(frozen=True)
class Sampling:
    temperature: float
    top_p: float
    repetition_penalty: float
    #: None asks for a fresh one. A backend must not carry the previous request's seed over.
    seed: int | None
    max_tokens: int = MAX_TOKENS


class TokenSource(Protocol):
    def tokens(self, text: str, sampling: Sampling) -> Iterator[int]:
        """Token ids for `text`, ending before end of speech, and never more than `max_tokens`."""
        ...

    def close(self) -> None: ...


class LlamaCppSource:
    """The finetune as a GGUF, through llama.cpp.

    Runs on Metal, CUDA and the CPU from one package, which is why it is the default: a Mac can hear
    this engine at all. The import is here rather than at module scope so that the adapter imports,
    and its tests run, without llama.cpp.
    """

    def __init__(self, model_path: str, *, gpu: bool) -> None:
        from llama_cpp import Llama

        self._llama: Any = Llama(
            model_path=model_path,
            n_gpu_layers=-1 if gpu else 0,
            n_ctx=CONTEXT_TOKENS,
            # The whole sequence, not llama.cpp's default of the last 64 tokens. Upstream samples
            # through vLLM, whose repetition penalty counts every token in the prompt and the answer,
            # and "at least 1.1 is required for stable generations" is a statement about that one.
            last_n_tokens_size=CONTEXT_TOKENS,
            verbose=False,
        )

    def tokens(self, text: str, sampling: Sampling) -> Iterator[int]:
        prompt = framed(self._llama.tokenize(text.encode("utf-8"), add_bos=True, special=False))

        # Through `set_seed` and never the constructor, which reads a seed of 0 as "pick one".
        seed = sampling.seed if sampling.seed is not None else random.SystemRandom().getrandbits(32)
        self._llama.set_seed(seed % 2**32)

        # Forget the last prompt. `reset=True` below does not: llama-cpp-python keeps whatever prefix
        # of the KV cache matches and evaluates only the rest, so a repeated prompt is evaluated in a
        # different batch shape than it was the first time, its logits differ in the last bits, and
        # sampling goes its own way. Measured on q8 with Metal: the same seed and prompt twice agreed
        # for 160 tokens and then diverged, which made a seed reproduce nothing.
        self._llama.reset()

        generated = self._llama.generate(
            prompt,
            # Upstream's vLLM defaults: no top-k and no min-p. llama.cpp's own are 40 and 0.05, which
            # would sample a narrower model than the one upstream's numbers were tuned against.
            top_k=0,
            min_p=0.0,
            top_p=sampling.top_p,
            temp=sampling.temperature,
            repeat_penalty=sampling.repetition_penalty,
            reset=True,
        )
        try:
            for count, token in enumerate(generated):
                if token == END_OF_SPEECH or count >= sampling.max_tokens:
                    return
                yield token
        finally:
            generated.close()

    def close(self) -> None:
        self._llama.close()


class VllmSource:
    """Canopy's own weights, through vLLM, on a CUDA card.

    vLLM's engine is asynchronous and runs its output handling on whichever event loop created it,
    while the SDK calls `speak` from a worker thread. So this owns a loop on a thread of its own, as
    upstream's `orpheus_tts` does, and hands tokens across a queue. The imports are here for the same
    reason llama.cpp's are.
    """

    def __init__(self, model_dir: str, *, memory_fraction: float, kv_cache_bytes: int | None) -> None:
        import asyncio
        import os
        import threading

        # vLLM samples top-p through FlashInfer by default, which compiles its kernel with nvcc on
        # first use, and a box that installed its CUDA from wheels has no nvcc: in the server image
        # every load failed with "Could not find nvcc". PyTorch's sampler needs nothing compiled.
        # A default, so an engine's `env` can still choose FlashInfer where the toolkit is present.
        os.environ.setdefault("VLLM_USE_FLASHINFER_SAMPLER", "0")

        from transformers import AutoTokenizer
        from vllm import AsyncEngineArgs, AsyncLLMEngine

        self._tokenizer: Any = AutoTokenizer.from_pretrained(model_dir)
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._loop.run_forever, name="vllm", daemon=True)
        self._thread.start()

        arguments = AsyncEngineArgs(
            model=model_dir,
            dtype="bfloat16",
            max_model_len=CONTEXT_TOKENS,
            # vLLM checks this fraction of the whole card is free up front, 0.9 unless told
            # otherwise, and without `kv_cache_memory_bytes` fills what the weights leave of it with
            # KV cache. The residency manager expects engines to share a card, so the engine asks
            # for its budget rather than accepting the default.
            gpu_memory_utilization=memory_fraction,
            # None is vLLM's own sizing from the fraction, for an operator who set one.
            kv_cache_memory_bytes=kv_cache_bytes,
            block_size=KV_BLOCK_TOKENS,
            # One utterance at a time, as the SDK serves it. vLLM's default of several hundred sizes
            # its memory profile for that many sequences, and at this model's 156,940-token vocabulary
            # their logits alone ran a 16 GB card shared with another engine out of memory.
            max_num_seqs=1,
        )

        async def build() -> Any:
            return AsyncLLMEngine.from_engine_args(arguments)

        self._engine: Any = self._call(build())

    def tokens(self, text: str, sampling: Sampling) -> Iterator[int]:
        import asyncio
        import queue
        import uuid

        from vllm import SamplingParams, TokensPrompt
        from vllm.sampling_params import RequestOutputKind

        prompt = framed(list(self._tokenizer(text)["input_ids"]))
        parameters = SamplingParams(
            temperature=sampling.temperature,
            top_p=sampling.top_p,
            repetition_penalty=sampling.repetition_penalty,
            max_tokens=sampling.max_tokens,
            stop_token_ids=[END_OF_SPEECH],
            # None is a fresh seed per request, which is vLLM's own default.
            seed=None if sampling.seed is None else sampling.seed % 2**32,
            # Token ids are all this needs, and only the new ones each time.
            detokenize=False,
            output_kind=RequestOutputKind.DELTA,
        )
        request_id = uuid.uuid4().hex
        handoff: queue.Queue[list[int] | BaseException | None] = queue.Queue()

        async def produce() -> None:
            try:
                async for output in self._engine.generate(
                    TokensPrompt(prompt_token_ids=prompt), parameters, request_id
                ):
                    handoff.put(list(output.outputs[0].token_ids))
            except BaseException as error:
                handoff.put(error)
            else:
                handoff.put(None)

        asyncio.run_coroutine_threadsafe(produce(), self._loop)
        finished = False
        try:
            while True:
                item = handoff.get()
                if item is None:
                    finished = True
                    return
                if isinstance(item, BaseException):
                    finished = True
                    raise item
                for token in item:
                    if token != END_OF_SPEECH:
                        yield token
        finally:
            if not finished:
                # The caller went away mid-utterance. Without this the card goes on generating
                # audio nobody will hear, and holds the lease's worth of compute while it does.
                self._call(self._engine.abort(request_id))

    def close(self) -> None:
        """Stop the engine and its loop.

        What vLLM gives back on shutdown is not measured here. The core's answer to memory an unload
        does not return is `terminate`, which this engine needs no help to receive.
        """
        try:
            self._engine.shutdown()
        finally:
            self._loop.call_soon_threadsafe(self._loop.stop)
            self._thread.join(timeout=30)

    def _call(self, coroutine: Any) -> Any:
        import asyncio

        return asyncio.run_coroutine_threadsafe(coroutine, self._loop).result()
