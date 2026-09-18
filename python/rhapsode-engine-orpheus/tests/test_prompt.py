"""What the model is given: its tags, its special tokens, and text in pieces it can finish."""

from __future__ import annotations

from rhapsode_engine_orpheus.builds import CUES
from rhapsode_engine_orpheus.prompt import (
    END_OF_PROMPT,
    SEGMENT_CHARACTERS,
    START_OF_HUMAN,
    framed,
    prompt,
    segments,
    translate_cues,
)


class TestCues:
    def test_each_claimed_cue_becomes_its_tag(self) -> None:
        assert translate_cues("Right. [laugh] Anyway.") == "Right. <laugh> Anyway."
        assert translate_cues("[chuckle] [sigh] [gasp]") == "<chuckle> <sigh> <gasp>"

    def test_sniff_is_upstreams_sniffle(self) -> None:
        assert translate_cues("[sniff]") == "<sniffle>"

    def test_every_claimed_cue_has_a_tag(self) -> None:
        for cue in CUES:
            assert translate_cues(f"[{cue}]").startswith("<")

    def test_the_models_own_syntax_is_not_a_back_door(self) -> None:
        # A client that could write <yawn> here would be tied to this engine. § 5.
        assert translate_cues("so tired <yawn> goodnight") == "so tired goodnight"

    def test_brackets_that_are_not_cues_are_left_as_text(self) -> None:
        assert translate_cues("the [redacted] file") == "the [redacted] file"

    def test_whitespace_is_collapsed(self) -> None:
        assert translate_cues("  a \n\n b\t c ") == "a b c"


class TestSegments:
    def test_short_text_is_one_segment(self) -> None:
        assert segments("One. Two. Three.") == ["One. Two. Three."]

    def test_long_text_breaks_between_sentences(self) -> None:
        sentence = "This sentence is exactly as long as it needs to be for the test."
        text = " ".join([sentence] * 6)
        pieces = segments(text)
        assert len(pieces) > 1
        assert all(len(piece) <= SEGMENT_CHARACTERS for piece in pieces)
        assert all(piece.endswith(".") for piece in pieces)
        assert " ".join(pieces) == text

    def test_a_long_sentence_breaks_at_a_clause_before_a_word(self) -> None:
        clause = "and then there was another thing that happened after that"
        text = ", ".join([clause] * 5) + "."
        pieces = segments(text, limit=120)
        assert all(len(piece) <= 120 for piece in pieces)
        assert all(piece.endswith((",", ".")) for piece in pieces)

    def test_a_sentence_with_no_pauses_breaks_between_words(self) -> None:
        text = " ".join(["word"] * 100)
        pieces = segments(text, limit=50)
        assert all(len(piece) <= 50 for piece in pieces)
        assert " ".join(pieces) == text

    def test_a_word_longer_than_the_limit_is_never_cut(self) -> None:
        assert segments("a " + "x" * 30 + " b", limit=10) == ["a", "x" * 30, "b"]

    def test_a_tag_stays_with_the_text_it_follows(self) -> None:
        assert segments("Ha. <laugh> Right then.", limit=12) == ["Ha. <laugh>", "Right then."]

    def test_nothing_is_no_segments(self) -> None:
        assert segments("") == []


class TestPrompt:
    def test_the_voice_leads_the_text(self) -> None:
        assert prompt("tara", "Hello there.") == "tara: Hello there."

    def test_the_special_tokens_are_upstreams(self) -> None:
        assert framed([1, 2, 3]) == [START_OF_HUMAN, 1, 2, 3, *END_OF_PROMPT]
        assert START_OF_HUMAN == 128259
        assert END_OF_PROMPT == (128009, 128260, 128261, 128257)
