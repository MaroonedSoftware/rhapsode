"""Cloning: a clip at the model's rate and the words spoken in it, and speaking by continuing from both."""

from __future__ import annotations

import io
import json
import wave
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from harness.stubs import Recorder
from rhapsode_worker import BadRequest, CreateVoiceRequest, SpeakRequest, UnknownVoice, Unsupported
from rhapsode_worker.engine import Device

from rhapsode_engine_dia.engine import DiaEngine
from rhapsode_engine_dia.voices import LONGEST_SECONDS, SAMPLE_RATE

LONG = " ".join(["This sentence is exactly as long as it needs to be for the test."] * 10)


def clip(seconds: float = 6.0, rate: int = 24_000, channels: int = 1, hz: float = 220.0) -> bytes:
    times = np.arange(int(seconds * rate)) / rate
    tone = (0.25 * np.sin(2 * np.pi * hz * times) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(np.repeat(tone, channels).tobytes())
    return buffer.getvalue()


def engine(tmp_path: Path) -> DiaEngine:
    built = DiaEngine()
    built.device = Device(type="cpu", name="test")
    built.voice_dir = tmp_path
    built.variant = "1.6b"
    built.load("1.6b")
    return built


def create(built: DiaEngine, **overrides: Any) -> Any:
    request: dict[str, Any] = {
        "id": "narrator",
        "reference": clip(),
        "filename": "narrator.wav",
        "transcript": "Hello, this is how I sound.",
    }
    return built.create_voice(CreateVoiceRequest(**(request | overrides)))


def spoken(built: DiaEngine, text: str = "A line to read.", **overrides: Any) -> bytes:
    return b"".join(built.speak(SpeakRequest(text=text, **overrides)))


class TestCreating:
    def test_a_transcript_is_required_and_the_refusal_names_it(self, dia: Recorder, tmp_path: Path) -> None:
        with pytest.raises(BadRequest, match="`transcript`"):
            create(engine(tmp_path), transcript=None)
        assert list(tmp_path.iterdir()) == []

    def test_is_listed_with_its_label(self, dia: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        create(built, label="The Narrator")
        [voice] = built.voices()
        assert (voice.id, voice.label, voice.tags) == ("narrator", "The Narrator", ("cloned",))

    def test_is_kept_mono_at_the_models_rate(self, dia: Recorder, tmp_path: Path) -> None:
        create(engine(tmp_path), reference=clip(seconds=6.0, rate=48_000, channels=2))
        with wave.open(str(tmp_path / "narrator.wav"), "rb") as kept:
            assert (kept.getnchannels(), kept.getframerate()) == (1, SAMPLE_RATE)
            assert kept.getnframes() == 6 * SAMPLE_RATE

    def test_the_words_are_kept_beside_it(self, dia: Recorder, tmp_path: Path) -> None:
        create(engine(tmp_path))
        assert json.loads((tmp_path / "narrator.json").read_text())["transcript"] == (
            "Hello, this is how I sound."
        )

    def test_a_clip_too_long_to_leave_room_to_speak_is_refused_not_trimmed(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        # Trimming would leave a transcript that no longer matches the clip.
        with pytest.raises(BadRequest, match="at most"):
            create(engine(tmp_path), reference=clip(seconds=LONGEST_SECONDS + 1))
        assert list(tmp_path.iterdir()) == []

    def test_audio_that_cannot_be_read_is_a_bad_request(self, dia: Recorder, tmp_path: Path) -> None:
        with pytest.raises(BadRequest, match="could not be read"):
            create(engine(tmp_path), reference=b"not audio at all")

    def test_a_format_it_does_not_read_is_unsupported(self, dia: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported):
            create(engine(tmp_path), filename="narrator.aiff")

    def test_re_recording_changes_the_spec_and_so_does_changing_the_words(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        built = engine(tmp_path)
        first = create(built).spec
        second = create(built, reference=clip(hz=330.0)).spec
        third = create(built, reference=clip(hz=330.0), transcript="Other words entirely.").spec
        assert len({first, second, third}) == 3

    def test_deleting_removes_the_clip_and_its_words(self, dia: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        create(built)
        built.delete_voice("narrator")
        assert list(tmp_path.iterdir()) == []
        assert built.voices() == []


class TestSpeaking:
    def test_every_segment_continues_from_the_clip_and_its_words(self, dia: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        create(built)
        spoken(built, LONG, voice="narrator")
        assert len(dia.generations) > 1
        for generation in dia.generations:
            assert generation.prompt is not None
            assert generation.prompt.size == 6 * SAMPLE_RATE
            assert generation.text.startswith("[S1] Hello, this is how I sound. [S1] ")

    def test_a_clone_is_not_replaced_by_the_first_segment_as_the_prompt(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        built = engine(tmp_path)
        create(built)
        spoken(built, LONG, voice="narrator")
        prompts = {
            generation.prompt.tobytes() for generation in dia.generations if generation.prompt is not None
        }
        assert len(prompts) == 1

    def test_the_transcript_is_held_to_the_same_syntax_rules_as_the_text(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        built = engine(tmp_path)
        create(built, transcript="Ha [laugh] (burps) [S2] fine.")
        spoken(built, voice="narrator")
        assert dia.generations[0].text.startswith("[S1] Ha (laughs) fine. [S1] ")

    def test_a_voice_it_does_not_have_is_refused_not_substituted(self, dia: Recorder, tmp_path: Path) -> None:
        with pytest.raises(UnknownVoice):
            spoken(engine(tmp_path), voice="stranger")
        assert dia.generations == []

    def test_a_clip_whose_words_are_missing_is_not_a_voice(self, dia: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        create(built)
        (tmp_path / "narrator.json").unlink()
        assert built.voices() == []
        with pytest.raises(UnknownVoice):
            spoken(built, voice="narrator")

    def test_an_id_that_is_not_a_name_is_a_bad_request_not_an_unknown_voice(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        with pytest.raises(BadRequest):
            spoken(engine(tmp_path), voice="../escape")
