"""The llama.cpp backend: what it asks the model for, and when it stops listening."""

from __future__ import annotations

from harness.stubs import Recorder

from rhapsode_engine_orpheus.backends import CONTEXT_TOKENS, LlamaCppSource, Sampling, VllmSource
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


class TestVllm:
    def source(self) -> VllmSource:
        return VllmSource("/models/full", memory_fraction=0.4)

    def test_the_engine_is_made_and_used_on_its_own_loop(self, orpheus: Recorder) -> None:
        # vLLM's output handling runs on the loop that made the engine, and the SDK calls speak from
        # another thread. The fake asserts every generate runs on the loop it was made on.
        built = self.source()
        assert list(built.tokens("x", SAMPLING))
        built.close()

    def test_it_asks_for_its_budget_of_the_card_not_vllms_default(self, orpheus: Recorder) -> None:
        self.source()
        options = orpheus.vllms[0].arguments.options
        assert options["gpu_memory_utilization"] == 0.4
        assert options["dtype"] == "bfloat16"
        assert options["max_model_len"] == CONTEXT_TOKENS

    def test_the_prompt_is_framed_as_the_finetune_was_trained(self, orpheus: Recorder) -> None:
        list(self.source().tokens("tara: hi", SAMPLING))
        prompt = orpheus.vllms[0].requests[0].prompt
        assert prompt[:2] == [START_OF_HUMAN, 128000]
        assert prompt[-len(END_OF_PROMPT) :] == list(END_OF_PROMPT)

    def test_upstreams_sampling_reaches_vllm(self, orpheus: Recorder) -> None:
        list(self.source().tokens("x", SAMPLING))
        parameters = orpheus.vllms[0].requests[0].parameters
        assert (parameters.temperature, parameters.top_p, parameters.repetition_penalty) == (0.6, 0.8, 1.3)
        assert parameters.stop_token_ids == [END_OF_SPEECH]
        assert parameters.seed == 7
        assert parameters.detokenize is False
        assert parameters.output_kind.name == "DELTA"

    def test_the_stop_token_vllm_reports_is_not_passed_on(self, orpheus: Recorder) -> None:
        orpheus.frames = 3
        tokens = list(self.source().tokens("x", SAMPLING))
        assert len(tokens) == 21
        assert END_OF_SPEECH not in tokens

    def test_max_tokens_is_vllms_to_enforce(self, orpheus: Recorder) -> None:
        orpheus.endless = True
        tokens = list(self.source().tokens("x", Sampling(0.6, 0.8, 1.3, seed=1, max_tokens=50)))
        assert len(tokens) == 50

    def test_a_caller_who_leaves_is_aborted_so_the_card_stops(self, orpheus: Recorder) -> None:
        orpheus.endless = True
        stream = self.source().tokens("x", SAMPLING)
        next(stream)
        stream.close()
        engine = orpheus.vllms[0]
        assert engine.aborted == [engine.requests[0].request_id]

    def test_a_finished_request_is_not_aborted(self, orpheus: Recorder) -> None:
        list(self.source().tokens("x", SAMPLING))
        assert orpheus.vllms[0].aborted == []

    def test_no_seed_is_vllms_fresh_one(self, orpheus: Recorder) -> None:
        list(self.source().tokens("x", Sampling(0.6, 0.8, 1.3, seed=None)))
        assert orpheus.vllms[0].requests[0].parameters.seed is None

    def test_close_shuts_the_engine_down(self, orpheus: Recorder) -> None:
        built = self.source()
        built.close()
        assert orpheus.vllms[0].shut_down
