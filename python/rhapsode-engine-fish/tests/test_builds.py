"""What the build claims."""

from __future__ import annotations

from rhapsode_engine_fish.builds import (
    CUE_TAGS,
    CUES,
    DEFAULT_VARIANT,
    DIALS,
    FILES,
    LANGUAGES,
    variants,
)


def test_one_build_named_as_upstream_names_it() -> None:
    assert list(variants()) == [DEFAULT_VARIANT] == ["s2-pro"]


def test_only_the_cues_the_cards_common_tags_cover_are_claimed() -> None:
    assert set(CUES) == {"laugh", "chuckle"}


def test_sigh_and_clear_throat_are_not_claimed_because_they_were_not_performed() -> None:
    # A listener heard neither [sigh] nor [clearing throat] performed on real weights. § 5.
    assert not {"sigh", "clear throat"} & set(CUES)
    assert not {"sigh", "clear throat"} & set(CUE_TAGS)
    assert set(CUE_TAGS) == set(CUES)
    for variant in variants().values():
        assert set(variant.cues) == set(CUES)


def test_every_tag_is_bracketed() -> None:
    for tag in CUE_TAGS.values():
        assert tag.startswith("[") and tag.endswith("]")


def test_no_deliveries_until_a_whisper_is_heard_to_hold() -> None:
    for variant in variants().values():
        assert variant.deliveries == ()


def test_the_dials_are_upstreams_own_bounds_and_defaults() -> None:
    assert DIALS == {
        "temperature": (0.1, 1.0, 0.8),
        "topP": (0.1, 1.0, 0.8),
        "repetitionPenalty": (0.9, 2.0, 1.1),
    }


def test_no_speed_dial_because_fish_has_none() -> None:
    # The OpenAI shim reaches a dial named `speed` and refuses a speed where there is none. § 11.
    assert "speed" not in DIALS


def test_the_cards_first_two_tiers_of_languages() -> None:
    assert len(LANGUAGES) == len(set(LANGUAGES)) == 10
    assert LANGUAGES[:3] == ("en", "zh", "ja")
    for variant in variants().values():
        assert variant.languages == LANGUAGES


def test_the_codec_is_fetched_with_the_model() -> None:
    assert "codec.pth" in FILES
    assert [name for name in FILES if name.startswith("model-")] == [
        "model-00001-of-00002.safetensors",
        "model-00002-of-00002.safetensors",
    ]
    assert "overview.png" not in FILES
