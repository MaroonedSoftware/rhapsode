"""The llama.cpp backend: what it asks the model for, and when it stops listening."""

from __future__ import annotations

from harness.stubs import Recorder

from rhapsode_engine_orpheus.backends import CONTEXT_TOKENS, LlamaCppSource, Sampling
from rhapsode_engine_orpheus.prompt import END_OF_PROMPT, END_OF_SPEECH, START_OF_HUMAN

SAMPLING = Sampling(temperature=0.6, top_p=0.8, repetition_penalty=1.3, seed=7)


def source(gpu: bool = False) -> LlamaCppSource:
    return LlamaCppSource("/models/orpheus.gguf", gpu=gpu)


def test_the_prompt_is_framed_as_the_finetune_was_trained(orpheus: Recorder) -> None:
    list(source().tokens("tara: hi", SAMPLING))
    tokens = orpheus.llamas[0].generations[0].tokens
    assert tokens[0] == START_OF_HUMAN
    assert tokens[1] == 128000
    assert tokens[-len(END_OF_PROMPT) :] == list(END_OF_PROMPT)
    assert bytes(tokens[2 : -len(END_OF_PROMPT)]) == b"tara: hi"


def test_generation_stops_at_end_of_speech_and_does_not_yield_it(orpheus: Recorder) -> None:
    orpheus.frames = 3
    tokens = list(source().tokens("x", SAMPLING))
    assert len(tokens) == 21
    assert END_OF_SPEECH not in tokens
    assert orpheus.llamas[0].generations[0].closed


def test_a_model_that_will_not_stop_is_stopped_at_max_tokens(orpheus: Recorder) -> None:
    orpheus.endless = True
    tokens = list(source().tokens("x", Sampling(0.6, 0.8, 1.3, seed=1, max_tokens=50)))
    assert len(tokens) == 50
    assert orpheus.llamas[0].generations[0].closed


def test_upstreams_sampling_reaches_llama_cpp_with_its_own_defaults_turned_off(orpheus: Recorder) -> None:
    list(source().tokens("x", SAMPLING))
    sampling = orpheus.llamas[0].generations[0].sampling
    assert sampling["temp"] == 0.6
    assert sampling["top_p"] == 0.8
    assert sampling["repeat_penalty"] == 1.3
    # llama.cpp's defaults are top-k 40 and min-p 0.05; upstream's vLLM samples with neither.
    assert sampling["top_k"] == 0
    assert sampling["min_p"] == 0.0


def test_the_repetition_penalty_sees_the_whole_sequence(orpheus: Recorder) -> None:
    source()
    assert orpheus.llamas[0].options["last_n_tokens_size"] == CONTEXT_TOKENS


def test_a_seed_is_set_and_no_seed_is_a_fresh_one_each_time(orpheus: Recorder) -> None:
    built = source()
    list(built.tokens("x", SAMPLING))
    assert orpheus.llamas[0].generations[0].seed == 7

    unseeded = Sampling(0.6, 0.8, 1.3, seed=None)
    list(built.tokens("x", unseeded))
    list(built.tokens("x", unseeded))
    seeds = [generation.seed for generation in orpheus.llamas[0].generations[1:]]
    assert None not in seeds
    assert seeds[0] != seeds[1]


def test_a_seed_zero_is_zero_and_a_large_one_wraps(orpheus: Recorder) -> None:
    # llama.cpp's constructor reads a seed of 0 as "pick one", which is why the seed goes through
    # set_seed; and llama.cpp's seed is 32 bits wide.
    built = source()
    list(built.tokens("x", Sampling(0.6, 0.8, 1.3, seed=0)))
    list(built.tokens("x", Sampling(0.6, 0.8, 1.3, seed=2**32 + 5)))
    assert [generation.seed for generation in orpheus.llamas[0].generations] == [0, 5]


def test_every_layer_goes_to_the_gpu_when_there_is_one(orpheus: Recorder) -> None:
    source(gpu=True)
    source(gpu=False)
    assert [llama.options["n_gpu_layers"] for llama in orpheus.llamas] == [-1, 0]


def test_close_closes_the_model(orpheus: Recorder) -> None:
    built = source()
    built.close()
    assert orpheus.llamas[0].closed
