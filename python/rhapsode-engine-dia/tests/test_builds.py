"""What the build claims."""

from __future__ import annotations

from rhapsode_engine_dia.builds import (
    CODEC_FILES,
    CUE_TAGS,
    CUES,
    DEFAULT_VARIANT,
    DIALS,
    FILES,
    NATIVE_TAGS,
    variants,
)


def test_one_build_named_for_its_size() -> None:
    assert list(variants()) == [DEFAULT_VARIANT] == ["1.6b"]


def test_all_eight_standard_cues_are_performed() -> None:
    assert len(CUES) == 8
    assert set(CUE_TAGS) == set(CUES)
    for variant in variants().values():
        assert set(variant.cues) == set(CUES)


def test_every_tag_a_cue_becomes_is_one_upstream_lists() -> None:
    # A tag upstream does not list is read out loud, or worse. Its README warns that unlisted
    # nonverbals "may cause weird artifacts".
    for tag in CUE_TAGS.values():
        assert tag.startswith("(") and tag.endswith(")")
        assert tag[1:-1] in NATIVE_TAGS


def test_upstreams_list_is_all_twenty_one() -> None:
    assert len(NATIVE_TAGS) == len(set(NATIVE_TAGS)) == 21


def test_no_deliveries_because_dia_cannot_whisper() -> None:
    for variant in variants().values():
        assert variant.deliveries == ()


def test_the_dials_are_the_checkpoints_own_sampling() -> None:
    assert set(DIALS) == {"cfgScale", "temperature", "topP"}
    assert (DIALS["cfgScale"][2], DIALS["temperature"][2], DIALS["topP"][2]) == (3.0, 1.8, 0.9)
    for low, high, default in DIALS.values():
        assert low <= default <= high


def test_no_speed_dial_because_dia_has_none() -> None:
    # The OpenAI shim reaches a dial named `speed` and refuses a speed where there is none. One that
    # existed here without changing the pace would be the silent discard § 11 refuses.
    assert "speed" not in DIALS


def test_english_only() -> None:
    for variant in variants().values():
        assert variant.languages == ("en",)


def test_the_weights_are_fetched_once_not_three_times() -> None:
    assert "dia-v1.pth" not in FILES
    assert "pytorch_model.bin" not in FILES
    assert [name for name in FILES if name.endswith(".safetensors")] == [
        "model-00001-of-00002.safetensors",
        "model-00002-of-00002.safetensors",
    ]
    assert "model.safetensors" in CODEC_FILES
