"""Breaking text where a reader would pause. protocol.md § 8."""

from __future__ import annotations

from rhapsode_worker.text import _IS_CJK, segments


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


def _rejoined(pieces: list[str]) -> str:
    """The pieces glued back the way `_pack` glues them: nothing between two CJK characters."""
    text = pieces[0]
    for piece in pieces[1:]:
        text += piece if _IS_CJK.match(text[-1]) and _IS_CJK.match(piece[0]) else f" {piece}"
    return text


def test_chinese_breaks_after_a_full_stop_with_no_space():
    """Before this, 420 characters of it came back as one piece of 420 against a limit of 300."""
    text = "今天天气很好。" * 60
    pieces = segments(text, 300)
    assert len(pieces) == 2
    assert all(len(piece) <= 300 for piece in pieces)
    assert all(piece.endswith("。") for piece in pieces)
    assert "".join(pieces) == text


def test_japanese_breaks_after_its_stops():
    text = "今日はいい天気ですね！散歩に行きませんか？行きましょう。"
    assert segments(text, 12) == ["今日はいい天気ですね！", "散歩に行きませんか？", "行きましょう。"]


def test_a_closing_quote_stays_with_its_sentence():
    assert segments("他说：「今天天气很好。」然后走了。", 12) == ["他说：「今天天气很好。」", "然后走了。"]


def test_two_stops_together_are_one_ending():
    """`？！` is one ending; breaking between its marks would start a piece with a `！`."""
    assert segments("真的吗？！是的。", 5) == ["真的吗？！", "是的。"]


def test_a_long_chinese_sentence_falls_back_to_its_commas():
    text = "我们去了公园，看了很多花，吃了一顿午饭，然后回家了。"
    assert segments(text, 10) == ["我们去了公园，", "看了很多花，", "吃了一顿午饭，", "然后回家了。"]


def test_the_enumeration_comma_semicolon_and_colon_break_too():
    assert segments("我们，你们、他们；它们：大家。", 4) == ["我们，", "你们、", "他们；", "它们：", "大家。"]


def test_a_cjk_run_with_no_break_point_is_cut_at_the_limit():
    """The last resort, and only for CJK: every character there is a place a word can end, and the
    alternative is one piece of any length."""
    pieces = segments("今" * 700, 300)
    assert [len(piece) for piece in pieces] == [300, 300, 100]


def test_a_cut_never_starts_a_piece_with_punctuation():
    assert segments("好……今天很好。", 4) == ["好……", "今天很", "好。"]


def test_a_cut_keeps_a_latin_name_whole_and_adds_no_spaces():
    pieces = segments("东京とiPhoneの" * 30, 25)
    assert all(len(piece) <= 25 for piece in pieces)
    assert "".join(pieces) == "东京とiPhoneの" * 30
    assert all("iPhone" in piece or "Phone" not in piece for piece in pieces)


def test_a_cue_inside_chinese_is_never_split():
    """Chinese puts no space either side of a cue, so the cue is inside a word rather than one."""
    text = "今天[clear throat]很好" * 30
    pieces = segments(text, 40)
    assert all(len(piece) <= 40 for piece in pieces)
    for piece in pieces:
        assert piece.count("[") == piece.count("]") == piece.count("[clear throat]")


def test_mixed_text_loses_nothing():
    text = " ".join(["The station said: 今天天气很好。明天也是。", "Then it went on, and on."] * 20)
    pieces = segments(text, 40)
    assert all(len(piece) <= 40 for piece in pieces)
    assert _rejoined(pieces).replace(" ", "") == text.replace(" ", "")


def test_korean_still_breaks_at_its_spaces():
    """Hangul is not in the CJK class: Korean spaces its words, and gluing two of them would fuse
    them."""
    text = "오늘은 날씨가 좋습니다. 내일도 좋을 것입니다."
    assert segments(text, 16) == ["오늘은 날씨가 좋습니다.", "내일도 좋을 것입니다."]
    assert segments("가나다라마바사 아자차카타파하", 8) == ["가나다라마바사", "아자차카타파하"]


def test_a_latin_ellipsis_with_no_space_still_does_not_break():
    assert segments("Well…I suppose so.", 14) == ["Well…I suppose", "so."]
