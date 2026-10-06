"""What the model is given: its tags, its speaker, and text in pieces."""

from __future__ import annotations

from rhapsode_engine_fish.builds import CUES
from rhapsode_engine_fish.prompt import SEGMENT_CHARACTERS, SPEAKER, line, segments, translate_cues


class TestCues:
    def test_each_claimed_cue_becomes_its_tag(self) -> None:
        assert translate_cues("Right. [laugh] Anyway.") == "Right. [laughing] Anyway."
        assert translate_cues("[chuckle] Sure.") == "[chuckle] Sure."

    def test_an_unclaimed_cue_that_reaches_it_is_removed(self) -> None:
        # The core strips these first; were one to arrive, it is a bracket like any other.
        assert translate_cues("[sigh] Fine.") == "Fine."

    def test_clear_throat_keeps_its_space(self) -> None:
        assert translate_cues("[clear throat] Ahem.") == "[clears throat] Ahem."

    def test_every_claimed_cue_has_a_tag(self) -> None:
        for cue in CUES:
            assert translate_cues(f"[{cue}]").startswith("[")

    def test_a_cue_spelled_like_the_models_own_tag_survives(self) -> None:
        # `[chuckle]` is both, so a strip that ran before translation would have removed it.
        assert translate_cues("[chuckle]") == "[chuckle]"

    def test_the_models_own_directions_are_not_a_back_door(self) -> None:
        # A client that could write [whisper in small voice] here would be tied to this engine. § 5.
        assert translate_cues("well [whisper in small voice] hello") == "well hello"
        assert translate_cues("[laughing] [excited tone] yes") == "yes"

    def test_brackets_that_are_prose_are_removed_too(self) -> None:
        # Unlike most engines, here a bracket is never prose: the model would perform `[redacted]`.
        assert translate_cues("the [redacted] file") == "the file"

    def test_a_cue_is_matched_exactly(self) -> None:
        assert translate_cues("[Laugh] [laugh ]") == ""

    def test_special_tokens_written_by_hand_are_removed(self) -> None:
        # A speaker tag would hand the rest of the line to somebody else.
        assert translate_cues("<|speaker:1|>Hi. <|im_end|>there") == "Hi. there"

    def test_whitespace_is_collapsed(self) -> None:
        assert translate_cues("  a \n\n b\t c ") == "a b c"


class TestSegments:
    def test_short_text_is_one_segment(self) -> None:
        assert segments("Hello there. How are you?") == ["Hello there. How are you?"]

    def test_long_text_is_broken_between_sentences(self) -> None:
        sentence = "This sentence is about forty characters. "
        pieces = segments(sentence * 20)
        assert len(pieces) > 1
        assert all(len(piece) <= SEGMENT_CHARACTERS for piece in pieces)
        assert all(piece.endswith(".") for piece in pieces)

    def test_a_translated_cue_is_not_split(self) -> None:
        text = translate_cues(("word " * 37) + "[laugh] " + ("word " * 20))
        assert any("[laughing]" in piece for piece in segments(text))


class TestLine:
    def test_a_line_is_spoken_by_the_first_speaker(self) -> None:
        assert line("Hello.") == f"{SPEAKER}Hello." == "<|speaker:0|>Hello."
