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
