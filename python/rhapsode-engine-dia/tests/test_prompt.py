"""What the model is given: its tags, its speaker, and text in pieces it reads well."""

from __future__ import annotations

from rhapsode_engine_dia.builds import CUES, NATIVE_TAGS
from rhapsode_engine_dia.prompt import SEGMENT_CHARACTERS, line, segments, translate_cues


class TestCues:
    def test_each_claimed_cue_becomes_its_tag(self) -> None:
        assert translate_cues("Right. [laugh] Anyway.") == "Right. (laughs) Anyway."
        assert translate_cues("[chuckle] [sigh] [gasp]") == "(chuckle) (sighs) (gasps)"

    def test_clear_throat_keeps_its_space(self) -> None:
        assert translate_cues("[clear throat] Ahem.") == "(clears throat) Ahem."

    def test_every_claimed_cue_has_a_tag(self) -> None:
        for cue in CUES:
            assert translate_cues(f"[{cue}]").startswith("(")

    def test_the_models_own_syntax_is_not_a_back_door(self) -> None:
        # A client that could write (burps) here would be tied to this engine. § 5.
        assert translate_cues("well (burps) excuse me") == "well excuse me"
        assert translate_cues("so (Laughs) there") == "so there"
        for tag in NATIVE_TAGS:
            assert translate_cues(f"a ({tag}) b") == "a b"

    def test_a_translated_cue_survives_the_stripping(self) -> None:
        # The stripping runs first, so `[laugh]` becoming `(laughs)` is not then removed as native.
        assert translate_cues("[laugh]") == "(laughs)"

    def test_a_parenthesis_that_is_prose_is_left_as_text(self) -> None:
        assert translate_cues("He left (finally) at noon.") == "He left (finally) at noon."

    def test_speaker_tags_written_by_hand_are_removed(self) -> None:
        # In a line spoken by one voice, an [S2] would hand the rest of it to somebody else.
        assert translate_cues("[S1] Hello. [S2] Hi.") == "Hello. Hi."
        assert translate_cues("[S3] stays") == "[S3] stays"

    def test_brackets_that_are_not_cues_are_left_as_text(self) -> None:
        assert translate_cues("the [redacted] file") == "the [redacted] file"

    def test_whitespace_is_collapsed(self) -> None:
        assert translate_cues("  a \n\n b\t c ") == "a b c"


class TestSegments:
    def test_short_text_is_one_segment(self) -> None:
        assert segments("One. Two. Three.") == ["One. Two. Three."]

    def test_long_text_breaks_between_sentences(self) -> None:
        sentence = "This sentence is exactly as long as it needs to be for the test."
        text = " ".join([sentence] * 10)
        pieces = segments(text)
        assert len(pieces) > 1
        assert all(len(piece) <= SEGMENT_CHARACTERS for piece in pieces)
        assert all(piece.endswith(".") for piece in pieces)
        assert " ".join(pieces) == text

    def test_short_sentences_are_packed_so_no_generation_is_needlessly_short(self) -> None:
        text = " ".join(["Yes."] * 40)
        assert segments(text, limit=100) == [" ".join(["Yes."] * 20)] * 2

    def test_a_long_sentence_breaks_at_a_clause_before_a_word(self) -> None:
        clause = "and then there was another thing that happened after that"
        text = ", ".join([clause] * 5) + "."
        pieces = segments(text, limit=120)
        assert all(len(piece) <= 120 for piece in pieces)
        assert all(piece.endswith((",", ".")) for piece in pieces)

    def test_a_word_longer_than_the_limit_is_never_cut(self) -> None:
        assert segments("a " + "x" * 30 + " b", limit=10) == ["a", "x" * 30, "b"]

    def test_a_tag_stays_with_the_text_it_follows(self) -> None:
        assert segments("Ha. (laughs) Right then.", limit=13) == ["Ha. (laughs)", "Right then."]

    def test_nothing_is_no_segments(self) -> None:
        assert segments("") == []

    def test_a_segment_fits_the_encoder(self) -> None:
        # The tokenizer reads bytes and truncates past 1024 of them without a word.
        assert len(line("x" * SEGMENT_CHARACTERS).encode()) < 1024


class TestLine:
    def test_the_first_speaker_leads(self) -> None:
        assert line("Hello there.") == "[S1] Hello there."
