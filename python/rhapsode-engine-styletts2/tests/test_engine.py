"""The adapter against a synthesiser that is not StyleTTS 2 (`harness/stubs.py`)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from harness.stubs import SAMPLES_PER_TOKEN, Recorder, clip
from rhapsode_worker import BadRequest, CreateVoiceRequest, Log, SpeakRequest, UnknownVoice, Unsupported
from rhapsode_worker.engine import Device

from rhapsode_engine_styletts2 import builds, upstream
from rhapsode_engine_styletts2.backends import TOKEN_LIMIT, Dials
from rhapsode_engine_styletts2.engine import StyleTTS2Engine, pcm


def engine(tmp_path: Path, device: str = "cpu") -> StyleTTS2Engine:
    built = StyleTTS2Engine()
    built.device = Device(type=device, name="test")
    built.voice_dir = tmp_path / "voices"
    built.log = Log(engine="styletts2")
    built.variant = None
    return built


def loaded(tmp_path: Path) -> StyleTTS2Engine:
    built = engine(tmp_path)
    built.load("libritts")
    built.variant = "libritts"
    return built


def spoken(built: StyleTTS2Engine, **overrides: Any) -> bytes:
    request = SpeakRequest(**{"text": "a line", **overrides})
    return b"".join(built.speak(request))


class TestLoading:
    def test_the_load_hands_upstream_the_fetched_tree_and_the_pinned_weights(
        self, styletts2: Recorder, tmp_path: Path
    ) -> None:
        loaded(tmp_path)
        assert styletts2.loads[0]["source"] == upstream.source_dir()
        assert styletts2.downloads[0] == {
            "repo_id": builds.REPOSITORY,
            "revision": builds.REVISION,
            "allow_patterns": list(builds.FILES),
            "token": None,
        }

    @pytest.mark.parametrize(
        ("detected", "torch"), [("cuda", "cuda"), ("rocm", "cuda"), ("mps", "mps"), ("cpu", "cpu")]
    )
    def test_the_device_is_torchs_name_for_it(
        self, styletts2: Recorder, tmp_path: Path, detected: str, torch: str
    ) -> None:
        engine(tmp_path, detected).load("libritts")
        assert styletts2.loads[0]["device"] == torch

    def test_a_build_it_does_not_have_is_refused(self, styletts2: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no build"):
            engine(tmp_path).load("ljspeech")

    def test_nothing_speaks_once_unloaded(self, styletts2: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        built.unload()
        with pytest.raises(Unsupported, match="no model"):
            spoken(built)

    def test_fetch_downloads_without_loading(self, styletts2: Recorder, tmp_path: Path) -> None:
        engine(tmp_path).fetch("libritts")
        assert styletts2.downloads and not styletts2.loads


class TestWhatReachesTheModel:
    def test_the_dials_default_to_upstreams_demo(self, styletts2: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path))
        assert styletts2.generations[0].dials == Dials(
            alpha=0.3, beta=0.7, diffusion_steps=5, embedding_scale=1.0
        )

    def test_each_dial_reaches_the_model_and_steps_are_whole(
        self, styletts2: Recorder, tmp_path: Path
    ) -> None:
        params = {"alpha": 0.1, "beta": 0.9, "diffusionSteps": 7.6, "embeddingScale": 2.0}
        spoken(loaded(tmp_path), params=params)
        assert styletts2.generations[0].dials == Dials(
            alpha=0.1, beta=0.9, diffusion_steps=8, embedding_scale=2.0
        )

    def test_a_dial_changes_the_audio(self, styletts2: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        assert spoken(built, seed=1) != spoken(built, seed=1, params={"alpha": 0.9})

    def test_the_seed_reaches_the_model(self, styletts2: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        assert spoken(built, seed=3) == spoken(built, seed=3)
        assert [generation.seed for generation in styletts2.generations] == [3, 3]

    def test_no_voice_is_upstreams_demo_speaker(self, styletts2: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path))
        assert styletts2.styles == [builds.STOCK[builds.DEFAULT_VOICE]]

    def test_the_style_is_read_on_every_request(self, styletts2: Recorder, tmp_path: Path) -> None:
        # Measured cheap enough not to keep: 10 ms on Metal, 70 ms on the CPU.
        built = loaded(tmp_path)
        spoken(built)
        spoken(built)
        assert len(styletts2.styles) == 2


class TestLongText:
    def test_text_within_the_limit_is_one_generation(self, styletts2: Recorder, tmp_path: Path) -> None:
        # The fake reads one token a character, after the pad.
        audio = spoken(loaded(tmp_path), text="x" * (TOKEN_LIMIT - 1))
        assert len(styletts2.generations) == 1
        assert len(audio) == TOKEN_LIMIT * SAMPLES_PER_TOKEN * 2

    def test_text_over_the_limit_is_cut_where_a_reader_would_pause(
        self, styletts2: Recorder, tmp_path: Path
    ) -> None:
        sentence = "This sentence is about fifty characters in length. "
        spoken(loaded(tmp_path), text=sentence * 12)
        assert len(styletts2.generations) > 1
        assert all(len(generation.tokens) <= TOKEN_LIMIT for generation in styletts2.generations)

    def test_one_word_longer_than_the_limit_is_refused(self, styletts2: Recorder, tmp_path: Path) -> None:
        with pytest.raises(BadRequest, match="phonemes"):
            spoken(loaded(tmp_path), text="x" * (TOKEN_LIMIT + 10))

    def test_the_sdk_cuts_well_under_the_limit(self) -> None:
        # 300 characters measured 356 tokens on real weights, which leaves room for text that spells
        # out long. The fake cannot say that; this keeps the declaration honest about the margin.
        assert StyleTTS2Engine.segment_characters is not None
        assert StyleTTS2Engine.segment_characters * 1.18 < TOKEN_LIMIT * 0.75


class TestVoices:
    def test_the_stock_voices_are_the_training_speakers(self, styletts2: Recorder, tmp_path: Path) -> None:
        voices = engine(tmp_path).voices()
        assert [voice.id for voice in voices] == list(builds.STOCK)
        assert all("stock" in voice.tags for voice in voices)

    def test_a_stock_voice_reads_its_own_clip(self, styletts2: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), voice="librispeech_908")
        assert styletts2.styles == ["908-157963-0027.wav"]

    def test_only_the_named_clips_are_unpacked(self, styletts2: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path))
        unpacked = sorted(path.name for path in (upstream.source_dir().parent).glob("references-*/*"))
        assert unpacked == sorted(builds.STOCK.values())

    def test_a_clone_is_stored_listed_and_spoken(self, styletts2: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        voice = built.create_voice(CreateVoiceRequest(id="narrator", reference=clip(), filename="take.wav"))
        assert voice.id == "narrator" and "cloned" in voice.tags
        assert [listed.id for listed in built.voices()][-1] == "narrator"
        spoken(built, voice="narrator")
        assert styletts2.styles == ["narrator.wav"]

    def test_a_re_recording_replaces_whatever_it_was_called(
        self, styletts2: Recorder, tmp_path: Path
    ) -> None:
        built = loaded(tmp_path)
        before = built.create_voice(CreateVoiceRequest(id="narrator", reference=clip(), filename="a.wav"))
        after = built.create_voice(
            CreateVoiceRequest(id="narrator", reference=clip(pitch=7), filename="b.flac")
        )
        assert sorted(path.name for path in built.voice_dir.iterdir()) == ["narrator.flac"]
        assert before.spec != after.spec

    def test_a_stock_id_cannot_be_cloned_over_or_deleted(self, styletts2: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        with pytest.raises(BadRequest, match="own voices"):
            built.create_voice(CreateVoiceRequest(id="libritts_696", reference=clip(), filename="a.wav"))
        with pytest.raises(Unsupported, match="cannot be deleted"):
            built.delete_voice("libritts_696")

    def test_a_deleted_clone_is_gone(self, styletts2: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        built.create_voice(CreateVoiceRequest(id="narrator", reference=clip(), filename="a.wav"))
        built.delete_voice("narrator")
        with pytest.raises(UnknownVoice):
            spoken(built, voice="narrator")

    def test_an_unknown_voice_is_refused_not_substituted(self, styletts2: Recorder, tmp_path: Path) -> None:
        with pytest.raises(UnknownVoice):
            spoken(loaded(tmp_path), voice="nobody")
        assert styletts2.generations == []

    def test_a_reference_it_cannot_read_is_refused(self, styletts2: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        with pytest.raises(Unsupported, match="must be one of"):
            built.create_voice(CreateVoiceRequest(id="narrator", reference=b"x", filename="a.aiff"))
        with pytest.raises(BadRequest, match="empty"):
            built.create_voice(CreateVoiceRequest(id="narrator", reference=b"", filename="a.wav"))


class TestPcm:
    def test_float_audio_becomes_little_endian_s16_clipped_first(self) -> None:
        audio = np.array([0.0, 0.5, -0.5, 1.5, -1.5], dtype=np.float32)
        samples = np.frombuffer(b"".join(pcm(audio)), dtype="<i2")
        assert samples.tolist() == [0, 16383, -16383, 32767, -32767]

    def test_it_comes_in_pieces(self) -> None:
        assert len(list(pcm(np.zeros(5_000, dtype=np.float32), chunk_samples=2_400))) == 3
