"""What the build claims."""

from __future__ import annotations

from rhapsode_engine_breeze.builds import (
    CUE_TAGS,
    CUES,
    DEFAULT_VARIANT,
    DIALS,
    FILES,
    NATIVE_TAGS_EN,
    NATIVE_TAGS_ZH,
    variants,
)


def test_one_build_named_for_the_release() -> None:
    assert list(variants()) == [DEFAULT_VARIANT] == ["2"]


def test_only_the_cues_the_open_card_names_are_claimed() -> None:
    assert set(CUES) == {"laugh", "sigh", "cough", "clear throat"}
    for variant in variants().values():
        assert set(variant.cues) == set(CUES)


def test_every_claimed_cue_has_a_tag_in_every_language_spoken() -> None:
    for variant in variants().values():
        for language in variant.languages:
            assert set(CUE_TAGS[language]) == set(CUES)


def test_english_tags_are_parenthesised_and_chinese_bracketed() -> None:
    # The card's rule, and the one a mix-up would break: a bracketed tag in English is read out.
    for tag in CUE_TAGS["en"].values():
        assert tag.startswith("(") and tag.endswith(")")
        assert tag[1:-1] in NATIVE_TAGS_EN
    for tag in CUE_TAGS["zh"].values():
        assert tag.startswith("[") and tag.endswith("]")
        assert tag[1:-1] in NATIVE_TAGS_ZH


def test_the_native_lists_have_no_repeats() -> None:
    assert len(NATIVE_TAGS_EN) == len(set(NATIVE_TAGS_EN))
    assert len(NATIVE_TAGS_ZH) == len(set(NATIVE_TAGS_ZH))


def test_no_deliveries_until_an_instruction_is_heard_to_hold() -> None:
    for variant in variants().values():
        assert variant.deliveries == ()


def test_the_dials_are_upstreams_sampling() -> None:
    assert set(DIALS) == {"temperature", "topP"}
    assert (DIALS["temperature"][2], DIALS["topP"][2]) == (0.9, 1.0)
    for low, high, default in DIALS.values():
        assert low <= default <= high


def test_no_guidance_dial_because_no_request_can_use_one() -> None:
    # Upstream's plain and cloning templates raise on any guidance scale but 1.
    assert "cfgScale" not in DIALS


def test_no_speed_dial_because_breeze_has_none() -> None:
    # The OpenAI shim reaches a dial named `speed` and refuses a speed where there is none. § 11.
    assert "speed" not in DIALS


def test_english_and_chinese() -> None:
    for variant in variants().values():
        assert variant.languages == ("en", "zh")


def test_the_audio_tokenizer_is_fetched_with_the_model() -> None:
    # Upstream refuses to load without `audio_tokenizer/`, so a pull that left it out would fail on
    # first load rather than at install.
    assert "audio_tokenizer/model.safetensors" in FILES
    assert [name for name in FILES if name.startswith("model-")] == [
        "model-00001-of-00002.safetensors",
        "model-00002-of-00002.safetensors",
    ]
    assert not any(name.startswith("assets/") for name in FILES)
