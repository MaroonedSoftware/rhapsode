"""What the model is given: its tags, its speaker, and text in pieces it reads well."""

from __future__ import annotations

from rhapsode_engine_dia.builds import CUES, NATIVE_TAGS
from rhapsode_engine_dia.prompt import (
    FEWEST_CHARACTERS,
    GENERATION_SECONDS,
    SEGMENT_CHARACTERS,
    line,
    rendered,
    room,
    script,
    segments,
    take,
    translate_cues,
    windows,
)


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


class TestRoom:
    def test_a_short_prompt_leaves_room_for_a_whole_piece(self) -> None:
        assert room(5.0) == SEGMENT_CHARACTERS

    def test_a_long_prompt_leaves_less(self) -> None:
        assert FEWEST_CHARACTERS < room(20.0) < SEGMENT_CHARACTERS

    def test_a_prompt_that_fills_the_generation_still_leaves_something(self) -> None:
        assert room(GENERATION_SECONDS) == FEWEST_CHARACTERS

    def test_less_room_as_the_prompt_grows(self) -> None:
        assert room(8.0) >= room(12.0) >= room(16.0) >= room(20.0)


TAGS = {"a": "[S1]", "b": "[S2]"}


class TestScript:
    def test_under_each_speakers_tag_with_a_speaker_going_on_kept_as_one(self) -> None:
        said = script([("a", "One."), ("a", "Two."), ("b", "Three.")], TAGS)
        assert said == [("[S1]", "One. Two."), ("[S2]", "Three.")]
        assert rendered(said) == "[S1] One. Two. [S2] Three."


class TestWindows:
    def test_whole_turns_until_the_next_would_not_fit(self) -> None:
        said = [("[S1]", "x" * 40), ("[S2]", "y" * 40), ("[S1]", "z" * 40)]
        piece, rest = take(said, 90)
        assert piece == said[:2]
        assert rest == said[2:]

    def test_a_turn_too_long_to_fit_alone_is_broken_and_its_remainder_leads_what_is_left(self) -> None:
        long = "Short one. " + "And then a much longer sentence follows it here."
        piece, rest = take([("[S2]", long), ("[S1]", "Right.")], 20)
        assert piece == [("[S2]", "Short one.")]
        assert rest[0] == ("[S2]", "And then a much longer sentence follows it here.")
        assert rest[1] == ("[S1]", "Right.")

    def test_every_word_is_in_exactly_one_window(self) -> None:
        said = [
            ("[S1]" if index % 2 == 0 else "[S2]", f"Sentence number {index} is here.") for index in range(30)
        ]
        pieces = windows(said, 100)
        assert len(pieces) > 1
        assert [words for piece in pieces for _, words in piece] == [words for _, words in said]
