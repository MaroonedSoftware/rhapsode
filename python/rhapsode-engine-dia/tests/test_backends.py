"""The transformers backend: what it loads, from where, onto what, and how it asks for audio."""

from __future__ import annotations

import numpy as np
from harness.stubs import Recorder

from rhapsode_engine_dia.backends import Prompt, Sampling, TransformersDia
from rhapsode_engine_dia.builds import CODEC_REPOSITORY, CODEC_REVISION, REPOSITORY, REVISION

SAMPLING = Sampling(cfg_scale=3.0, temperature=1.8, top_p=0.9)


class TestLoading:
    def test_the_checkpoint_and_the_codec_each_come_from_their_pinned_revision(self, dia: Recorder) -> None:
        TransformersDia("cpu")
        assert {"codec": CODEC_REPOSITORY, "revision": CODEC_REVISION} in dia.loads
        assert {"features": REPOSITORY, "revision": REVISION} in dia.loads
        assert {"tokenizer": REPOSITORY, "revision": REVISION} in dia.loads
        models = [load for load in dia.loads if "model" in load]
        assert [(load["model"], load["revision"]) for load in models] == [(REPOSITORY, REVISION)]

    def test_the_processor_is_handed_the_pinned_codec_rather_than_loading_its_own(
        self, dia: Recorder
    ) -> None:
        backend = TransformersDia("cuda")
        codec = backend._processor.audio_tokenizer
        # On the device, so a clip is encoded and a line decoded where the model is.
        assert (codec.device, codec.evaluated) == ("cuda", True)

    def test_bfloat16_on_an_nvidia_card_and_float32_elsewhere(self, dia: Recorder) -> None:
        for device in ("cuda", "mps", "cpu"):
            TransformersDia(device)
        dtypes = [load["dtype"] for load in dia.loads if "model" in load]
        assert dtypes == ["bfloat16", "float32", "float32"]

    def test_the_model_is_on_the_device_and_in_inference_mode(self, dia: Recorder) -> None:
        backend = TransformersDia("mps")
        assert (backend._model.device, backend._model.evaluated) == ("mps", True)


class TestGenerate:
    def test_the_text_is_given_as_it_is(self, dia: Recorder) -> None:
        TransformersDia("cpu").generate("[S1] Hi.", SAMPLING)
        assert dia.generations[0].text == "[S1] Hi."
        assert dia.generations[0].prompt is None

    def test_a_prompt_is_its_words_ahead_of_the_new_ones_and_its_audio_ahead_of_the_output(
        self, dia: Recorder
    ) -> None:
        clip = np.linspace(-0.5, 0.5, 4096, dtype=np.float32)
        spoken = TransformersDia("cpu").generate(
            "[S1] Next.", SAMPLING, Prompt(audio=clip, text="[S1] First.")
        )
        assert dia.generations[0].text == "[S1] First. [S1] Next."
        assert np.array_equal(dia.generations[0].prompt, clip)
        # Only what was generated, not the clip it continued from.
        assert spoken.audio.size == dia.generations[0].frames * 512

    def test_an_unseeded_generation_seeds_nothing(self, dia: Recorder) -> None:
        TransformersDia("cpu").generate("[S1] Hi.", SAMPLING)
        assert dia.generations[0].seed is None

    def test_a_seeded_one_seeds_torch(self, dia: Recorder) -> None:
        TransformersDia("cpu").generate("[S1] Hi.", Sampling(3.0, 1.8, 0.9, seed=11))
        assert dia.generations[0].seed == 11

    def test_the_audio_is_float32(self, dia: Recorder) -> None:
        spoken = TransformersDia("cpu").generate("[S1] Hi.", SAMPLING)
        assert spoken.audio.dtype == np.float32
        assert not spoken.exhausted
