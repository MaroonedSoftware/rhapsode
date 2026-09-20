"""Breaking text where a reader would pause. protocol.md § 8."""

from __future__ import annotations

from rhapsode_worker.text import segments


def test_short_text_is_one_piece():
    assert segments("Right, that was The Verve Pipe.", 200) == ["Right, that was The Verve Pipe."]


def test_sentences_are_packed_up_to_the_limit():
    """A run of short sentences is one generation rather than several, which is the whole reason
    this packs rather than simply splitting."""
    text = "One two. Three four. Five six. Seven eight."
    assert segments(text, 22) == ["One two. Three four.", "Five six. Seven eight."]


def test_every_piece_is_within_the_limit():
    text = " ".join(f"Sentence number {index} says something." for index in range(40))
    assert all(len(piece) <= 60 for piece in segments(text, 60))


def test_nothing_is_lost():
    text = " ".join(f"Sentence number {index} says something." for index in range(40))
    assert " ".join(segments(text, 60)) == text


def test_a_long_sentence_falls_back_to_clauses():
    text = "It went on, and on, and on, and on, and on, and on, and then it stopped."
    pieces = segments(text, 30)
    assert len(pieces) > 1
    assert all(len(piece) <= 30 for piece in pieces)


def test_a_long_clause_falls_back_to_words():
    text = "alpha bravo charlie delta echo foxtrot golf hotel india juliett"
    pieces = segments(text, 20)
    assert len(pieces) > 1
    assert all(len(piece) <= 20 for piece in pieces)


def test_a_single_word_longer_than_the_limit_stays_whole():
    """Splitting it would have the model read two halves of a word, which is worse than a piece
    over the limit."""
    assert segments("x" * 50, 20) == ["x" * 50]


def test_the_ellipsis_ends_a_sentence():
    """Kokoro's private copy matched `[.!?]` and not the ellipsis, so text punctuated with one was
    a single unbreakable sentence that then fell through to the clause pass."""
    assert segments("Well… I suppose so.", 14) == ["Well…", "I suppose so."]


def test_a_two_word_cue_is_never_split():
    """The word pass is the only place a cue can be torn, and § 5 writes one with a space in it.

    Orpheus and Dia never needed this because both translate cues into a space-free spelling before
    splitting. The SDK splits what the core passed down, where the cue is still `[clear throat]`.
    """
    text = "aaaaaaaaaa [clear throat] bbbbbbbbbb"
    for piece in segments(text, 12):
        assert "[clear" not in piece or "[clear throat]" in piece


def test_surrounding_whitespace_does_not_make_an_empty_piece():
    assert segments("  One two.  ", 200) == ["One two."]
