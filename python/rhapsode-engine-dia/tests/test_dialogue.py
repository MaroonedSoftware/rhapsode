"""Two speakers in one pass: their tags, their voices, and a long conversation in windows."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from harness.stubs import HOP, Recorder
from rhapsode_worker import BadRequest, CreateVoiceRequest, DialogueRequest, DialogueTurn, UnknownVoice
from rhapsode_worker.engine import Device
from test_voices import clip

from rhapsode_engine_dia.engine import DiaEngine
from rhapsode_engine_dia.prompt import ANCHOR_CHARACTERS, room
from rhapsode_engine_dia.voices import SAMPLE_RATE

SENTENCE = "This sentence is exactly as long as it needs to be for the test."


def engine(tmp_path: Path) -> DiaEngine:
    built = DiaEngine()
    built.device = Device(type="cpu", name="test")
    built.voice_dir = tmp_path
    built.variant = "1.6b"
    built.load("1.6b")
    return built


def clone(built: DiaEngine, voice: str, transcript: str, seconds: float = 6.0) -> None:
    built.create_voice(
        CreateVoiceRequest(
            id=voice, reference=clip(seconds=seconds), filename="clip.wav", transcript=transcript
        )
    )


def talk(built: DiaEngine, *turns: tuple[str, str], **overrides: Any) -> bytes:
    request = DialogueRequest(
        turns=tuple(DialogueTurn(speaker, text) for speaker, text in turns), **overrides
    )
    return b"".join(built.dialogue(request))


class TestTags:
    def test_two_speakers_are_s1_and_s2_in_the_order_they_speak(self, dia: Recorder, tmp_path: Path) -> None:
        talk(engine(tmp_path), ("anna", "Hello."), ("ben", "Hi."), ("anna", "Well then."))
        assert dia.generations[0].text == "[S1] Hello. [S2] Hi. [S1] Well then."

    def test_one_speaker_going_on_is_one_turn_because_the_tags_must_alternate(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        talk(engine(tmp_path), ("anna", "Hello."), ("anna", "Anyone there?"), ("ben", "Yes."))
        assert dia.generations[0].text == "[S1] Hello. Anyone there? [S2] Yes."

    def test_cues_are_dias_and_a_hand_written_tag_is_not_a_back_door(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        talk(engine(tmp_path), ("anna", "Ha [laugh] (burps) [S2] fine."), ("ben", "[sigh] Right."))
        assert dia.generations[0].text == "[S1] Ha (laughs) fine. [S2] (sighs) Right."

    def test_a_turn_that_is_nothing_but_dias_own_tags_is_dropped(self, dia: Recorder, tmp_path: Path) -> None:
        talk(engine(tmp_path), ("anna", "Hello."), ("ben", "(burps)"), ("anna", "Charming."))
        assert dia.generations[0].text == "[S1] Hello. Charming."

    def test_a_conversation_of_nothing_is_a_bad_request(self, dia: Recorder, tmp_path: Path) -> None:
        with pytest.raises(BadRequest):
            talk(engine(tmp_path), ("anna", "(burps)"), ("ben", "(sneezes)"))


class TestWindows:
    def test_a_long_conversation_is_several_generations_of_whole_turns(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        turns = [("anna" if index % 2 == 0 else "ben", SENTENCE) for index in range(12)]
        talk(engine(tmp_path), *turns)
        assert len(dia.generations) > 1
        first, *rest = dia.generations
        assert len(first.text.replace("[S1] ", "").replace("[S2] ", "")) <= ANCHOR_CHARACTERS
        fits = room(first.frames * HOP / SAMPLE_RATE)
        for generation in rest:
            # Each continues from the first window, its words ahead of the new ones.
            assert generation.text.startswith(first.text + " ")
            new = generation.text[len(first.text) + 1 :]
            assert len(new.replace("[S1] ", "").replace("[S2] ", "")) <= fits

    def test_a_turn_too_long_for_a_window_is_broken_and_keeps_its_speaker(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        talk(engine(tmp_path), ("anna", "Hi."), ("ben", " ".join([SENTENCE] * 8)))
        later = [generation.text for generation in dia.generations[1:]]
        assert later
        assert all(" [S2] " in text for text in later)

    def test_a_seed_reproduces_the_conversation(self, dia: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        turns = [("anna" if index % 2 == 0 else "ben", SENTENCE) for index in range(8)]
        assert talk(built, *turns, seed=5) == talk(built, *turns, seed=5)
        assert talk(built, *turns, seed=5) != talk(built, *turns, seed=6)


class TestVoices:
    def test_a_voiced_speaker_is_s1_and_their_clip_and_words_lead(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        built = engine(tmp_path)
        clone(built, "narrator", "This is how I sound.")
        # ben speaks second, but is the one with a voice, so ben is [S1] and the text still begins
        # with [S1], as upstream requires.
        talk(built, ("anna", "Hello."), ("ben", "Hi."), voices={"ben": "narrator"})
        [generation] = dia.generations
        assert generation.prompt is not None
        assert generation.prompt.size == 6 * SAMPLE_RATE
        assert generation.text == "[S1] This is how I sound. [S2] Hello. [S1] Hi."

    def test_two_voices_are_both_clips_one_after_the_other(self, dia: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        clone(built, "one", "First voice.", seconds=6.0)
        clone(built, "two", "Second voice.", seconds=7.0)
        talk(built, ("anna", "Hello."), ("ben", "Hi."), voices={"anna": "one", "ben": "two"})
        [generation] = dia.generations
        assert generation.prompt is not None
        assert generation.prompt.size == 13 * SAMPLE_RATE
        assert generation.text.startswith("[S1] First voice. [S2] Second voice. [S1] Hello.")

    def test_two_clips_too_long_to_leave_room_to_speak_are_refused(
        self, dia: Recorder, tmp_path: Path
    ) -> None:
        built = engine(tmp_path)
        clone(built, "one", "First voice.", seconds=15.0)
        clone(built, "two", "Second voice.", seconds=15.0)
        with pytest.raises(BadRequest, match="no room to speak"):
            talk(built, ("anna", "Hello."), ("ben", "Hi."), voices={"anna": "one", "ben": "two"})
        assert dia.generations == []

    def test_a_voice_it_does_not_have_is_refused_not_substituted(self, dia: Recorder, tmp_path: Path) -> None:
        with pytest.raises(UnknownVoice):
            talk(engine(tmp_path), ("anna", "Hello."), voices={"anna": "stranger"})
        assert dia.generations == []


def test_declares_two_speakers() -> None:
    assert DiaEngine.max_speakers == 2
    assert DiaEngine().supports_dialogue
