"""The adapter's own decisions: what text, what sampling, what it continues from, and what comes back."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from harness.stubs import HOP, Recorder
from rhapsode_worker import BadRequest, Log, SpeakRequest, UnknownVoice, Unsupported
from rhapsode_worker.engine import Device

from rhapsode_engine_dia.backends import MAX_POSITIONS
from rhapsode_engine_dia.builds import (
    CODEC_FILES,
    CODEC_REPOSITORY,
    CODEC_REVISION,
    FILES,
    REPOSITORY,
    REVISION,
)
from rhapsode_engine_dia.engine import CHUNK_SAMPLES, DiaEngine, chunked_pcm
from rhapsode_engine_dia.prompt import ANCHOR_CHARACTERS, SEGMENT_CHARACTERS, room, tokens_for


class RecordingLog(Log):
    def __init__(self) -> None:
        super().__init__(engine="dia")
        self.warnings: list[tuple[str, dict[str, Any]]] = []

    def warn(self, message: str, /, **fields: Any) -> None:
        self.warnings.append((message, fields))


def engine(tmp_path: Path, device: str = "cpu") -> DiaEngine:
    built = DiaEngine()
    built.device = Device(type=device, name="test")
    built.voice_dir = tmp_path
    built.log = RecordingLog()
    built.variant = None
    return built


def loaded(tmp_path: Path, device: str = "cpu") -> DiaEngine:
    built = engine(tmp_path, device)
    built.load("1.6b")
    built.variant = "1.6b"
    return built


def spoken(built: DiaEngine, text: str = "A line to read.", **overrides: Any) -> bytes:
    return b"".join(built.speak(SpeakRequest(text=text, **overrides)))


LONG = " ".join(["This sentence is exactly as long as it needs to be for the test."] * 10)


class TestLoading:
    def test_the_one_build_loads(self, dia: Recorder, tmp_path: Path) -> None:
        loaded(tmp_path)
        assert [load for load in dia.loads if "model" in load]

    def test_a_build_this_engine_does_not_have_is_refused(self, dia: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no build"):
            engine(tmp_path).load("dia2-2b")

    def test_speaking_before_loading_is_refused(self, dia: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no model"):
            spoken(engine(tmp_path))

    def test_unload_lets_go_of_the_model(self, dia: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        built.unload()
        built.unload()
        with pytest.raises(Unsupported):
            spoken(built)


class TestFetching:
    def test_fetches_the_checkpoint_and_its_codec_at_the_revisions_the_load_reads(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        engine(tmp_path).fetch("1.6b")
        assert [(fetched["repo_id"], fetched["revision"]) for fetched in dia.downloads] == [
            (CODEC_REPOSITORY, CODEC_REVISION),
            (REPOSITORY, REVISION),
        ]
        loaded(tmp_path)
        fetched = {(fetched["repo_id"], fetched["revision"]) for fetched in dia.downloads}
        parts = ("codec", "features", "tokenizer", "model")
        read = {(load[kind], load["revision"]) for load in dia.loads for kind in parts if kind in load}
        assert read == fetched

    def test_asks_for_the_files_the_load_reads_and_no_more(self, dia: Recorder, tmp_path: Path) -> None:
        engine(tmp_path).fetch("1.6b")
        assert [sorted(fetched["allow_patterns"]) for fetched in dia.downloads] == [
            sorted(CODEC_FILES),
            sorted(FILES),
        ]

    def test_fetching_loads_nothing(self, dia: Recorder, tmp_path: Path) -> None:
        engine(tmp_path).fetch("1.6b")
        assert dia.loads == []

    def test_a_build_this_engine_does_not_have_is_refused(self, dia: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no build"):
            engine(tmp_path).fetch("dia2-2b")
        assert dia.downloads == []


class TestText:
    def test_the_split_is_declared_and_kept(self, tmp_path: Path) -> None:
        """This adapter splits its own text, because every piece continues from the audio of the one
        before. A client still has to be told, which is what `segmentation` is for. protocol.md § 8.
        """
        built = engine(tmp_path)
        assert built.segment_characters == SEGMENT_CHARACTERS
        assert built.splits_own_text is True

    def test_one_voice_is_the_first_speaker(self, dia: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), "Hello there.")
        assert [generation.text for generation in dia.generations] == ["[S1] Hello there."]

    def test_cues_arrive_in_dias_syntax(self, dia: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), "Well [laugh] that is that. [clear throat]")
        assert dia.generations[0].text == "[S1] Well (laughs) that is that. (clears throat)"

    def test_a_speaker_tag_written_by_hand_cannot_hand_the_line_to_somebody_else(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        spoken(loaded(tmp_path), "Mine. [S2] Still mine.")
        assert dia.generations[0].text == "[S1] Mine. Still mine."

    def test_long_text_is_several_generations_each_inside_the_window(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        spoken(loaded(tmp_path), LONG)
        assert len(dia.generations) > 1

    def test_the_first_piece_is_short_because_every_later_one_pays_for_it(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        spoken(loaded(tmp_path), LONG)
        assert len(dia.generations[0].text) <= len("[S1] ") + ANCHOR_CHARACTERS

    def test_every_later_piece_fits_beside_the_first(self, dia: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), LONG)
        first, *rest = dia.generations
        fits = room(first.frames * HOP / 44_100)
        for generation in rest:
            assert len(generation.text) - len(first.text + " [S1] ") <= fits

    def test_nothing_but_dias_own_tags_is_a_bad_request(self, dia: Recorder, tmp_path: Path) -> None:
        with pytest.raises(BadRequest, match=r"\[laugh\]"):
            spoken(loaded(tmp_path), "(burps) (sneezes)")
        assert dia.generations == []


class TestVoice:
    def test_no_voices_of_its_own(self, dia: Recorder, tmp_path: Path) -> None:
        assert loaded(tmp_path).voices() == []

    def test_a_named_voice_it_does_not_have_is_refused_not_substituted(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        with pytest.raises(UnknownVoice):
            spoken(loaded(tmp_path), voice="narrator")
        assert dia.generations == []

    def test_the_first_segment_is_read_in_whatever_voice_the_model_picks(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        spoken(loaded(tmp_path), LONG)
        assert dia.generations[0].prompt is None

    def test_every_later_segment_continues_from_the_first_so_the_reader_does_not_change(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        audio = spoken(loaded(tmp_path), LONG)
        first, *rest = dia.generations
        assert rest
        first_samples = np.frombuffer(audio, dtype="<i2")[: first.frames * HOP]
        for generation in rest:
            assert generation.prompt is not None
            # The first segment's own audio, as the model made it, and its words ahead of the new ones.
            assert np.array_equal((np.clip(generation.prompt, -1, 1) * 32767).astype("<i2"), first_samples)
            assert generation.text.startswith(first.text + " [S1] ")


class TestSampling:
    def test_the_checkpoints_defaults_when_no_dial_is_turned(self, dia: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path))
        sampling = dia.generations[0].sampling
        assert sampling["guidance_scale"], sampling["temperature"] == (3.0, 1.8)
        assert sampling["top_p"] == 0.9

    def test_dials_reach_the_model(self, dia: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), params={"cfgScale": 2.0, "temperature": 1.2, "topP": 0.95})
        sampling = dia.generations[0].sampling
        assert (sampling["guidance_scale"], sampling["temperature"], sampling["top_p"]) == (2.0, 1.2, 0.95)

    def test_each_segment_is_seeded_from_the_request(self, dia: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), LONG, seed=7)
        assert [generation.seed for generation in dia.generations] == list(range(7, 7 + len(dia.generations)))

    def test_a_seed_reproduces_the_audio(self, dia: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        assert spoken(built, LONG, seed=3) == spoken(built, LONG, seed=3)
        assert spoken(built, LONG, seed=3) != spoken(built, LONG, seed=4)

    def test_cudnn_is_told_to_be_deterministic_for_a_seeded_request(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        import torch

        spoken(loaded(tmp_path), seed=1)
        assert torch.backends.cudnn.deterministic is True
        assert torch.backends.cudnn.benchmark is False


class TestOutput:
    def test_the_audio_is_what_the_model_made_as_pcm(self, dia: Recorder, tmp_path: Path) -> None:
        audio = spoken(loaded(tmp_path))
        assert len(audio) == dia.generations[0].frames * HOP * 2

    def test_a_piece_that_ran_out_of_room_is_logged(self, dia: Recorder, tmp_path: Path) -> None:
        dia.frames = MAX_POSITIONS
        built = loaded(tmp_path)
        spoken(built)
        assert isinstance(built.log, RecordingLog)
        assert [message for message, _ in built.log.warnings] == ["a piece ran out of room"]

    def test_a_generation_is_given_a_budget_from_its_text_so_it_cannot_run_on(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        # Measured on an RTX 4070 Ti SUPER: unbounded, "one" ran to 27 s of murmur where a longer
        # line stopped after 3.8 s, so a shorter text made more audio than a longer one.
        spoken(loaded(tmp_path), "one")
        short = dia.generations[0].sampling["max_new_tokens"]
        spoken(loaded(tmp_path), "one two three four five six seven eight nine ten")
        longer = dia.generations[-1].sampling["max_new_tokens"]
        assert 0 < short < longer
        assert short >= tokens_for(len("[S1] one"))

    def test_a_finished_segment_is_not(self, dia: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        spoken(built)
        assert isinstance(built.log, RecordingLog)
        assert built.log.warnings == []


class TestChunkedPcm:
    def test_clipped_before_it_is_an_integer(self) -> None:
        pcm = b"".join(chunked_pcm(np.array([1.5, -1.5, 0.0], dtype=np.float32)))
        assert np.frombuffer(pcm, dtype="<i2").tolist() == [32767, -32767, 0]

    def test_in_pieces_of_a_tenth_of_a_second(self) -> None:
        pieces = list(chunked_pcm(np.zeros(CHUNK_SAMPLES * 2 + 1, dtype=np.float32)))
        assert [len(piece) for piece in pieces] == [CHUNK_SAMPLES * 2, CHUNK_SAMPLES * 2, 2]
