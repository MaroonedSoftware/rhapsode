"""What the model is given: its tags, in the language spoken, and text in pieces."""

from __future__ import annotations

import pytest

from rhapsode_engine_breeze.builds import CUES, NATIVE_TAGS_EN, NATIVE_TAGS_ZH
from rhapsode_engine_breeze.prompt import SEGMENT_CHARACTERS, segments, translate_cues


class TestCues:
    def test_each_claimed_cue_becomes_its_english_tag(self) -> None:
        assert translate_cues("Right. [sigh] Anyway.") == "Right. (sigh) Anyway."
        assert translate_cues("[sigh] [cough]") == "(sigh) (cough)"
        assert translate_cues("Right. [laugh] Anyway.") == "Right. (laughs) Anyway."

    def test_clear_throat_keeps_its_space(self) -> None:
        assert translate_cues("[clear throat] Ahem.") == "(clears throat) Ahem."

    def test_chinese_gets_chinese_tags(self) -> None:
        assert translate_cues("[sigh] 没想到。", "zh") == "[叹气] 没想到。"
        assert translate_cues("[clear throat]", "zh") == "[清嗓子]"
        assert translate_cues("[laugh]", "zh") == "[笑]"

    def test_every_claimed_cue_has_a_tag_in_both_languages(self) -> None:
        for cue in CUES:
            assert translate_cues(f"[{cue}]", "en").startswith("(")
            assert translate_cues(f"[{cue}]", "zh").startswith("[")

    def test_a_language_the_build_does_not_speak_is_a_bug(self) -> None:
        # The core refuses it before dispatch (§ 6), so reaching here means something upstream broke.
        with pytest.raises(KeyError):
            translate_cues("hello", "fr")

    def test_the_models_own_syntax_is_not_a_back_door(self) -> None:
        # A client that could write (burps) here would be tied to this engine. § 5.
        assert translate_cues("well (burps) excuse me") == "well excuse me"
        assert translate_cues("so (Laughs) there") == "so there"
        for tag in NATIVE_TAGS_EN:
            assert translate_cues(f"a ({tag}) b") == "a b"

    def test_chinese_tags_are_removed_from_english_too(self) -> None:
        assert translate_cues("a [笑] b") == "a b"
        for tag in NATIVE_TAGS_ZH:
            assert translate_cues(f"a [{tag}] b", "zh") == "a b"

    def test_a_translated_cue_survives_the_stripping(self) -> None:
        # The stripping runs first, so `[sigh]` becoming `(sigh)` is not then removed as native.
        assert translate_cues("[sigh]") == "(sigh)"
        assert translate_cues("[sigh]", "zh") == "[叹气]"

    def test_a_parenthesis_that_is_prose_is_left_as_text(self) -> None:
        assert translate_cues("He left (finally) at noon.") == "He left (finally) at noon."

    def test_brackets_that_are_not_cues_are_left_as_text(self) -> None:
        assert translate_cues("the [redacted] file") == "the [redacted] file"

    def test_speaker_tags_written_by_hand_are_removed(self) -> None:
        # Upstream's templates write `[S0]`; another number would start somebody else talking.
        assert translate_cues("[S0] Hello. [S1] Hi.") == "Hello. Hi."

    def test_special_tokens_written_by_hand_are_removed(self) -> None:
        # `<ins_bos>` would make the rest of the line a direction to the model, not words to say.
        assert translate_cues("say <ins_bos>shout<ins_eos> this") == "say shout this"
        assert translate_cues("a <|AUDIO|><|audio_eos|> b") == "a b"

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
        text = translate_cues(("word " * 59) + "[clear throat] " + ("word " * 20))
        assert any("(clears throat)" in piece for piece in segments(text))
