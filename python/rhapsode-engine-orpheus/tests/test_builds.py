"""What each build claims."""

from __future__ import annotations

from rhapsode_engine_orpheus.builds import CUE_TAGS, CUES, DIALS, GGUF_FILES, VOICES, variants


def test_every_build_claims_the_same_because_every_build_is_the_same_finetune() -> None:
    declared = variants()
    assert set(declared) == set(GGUF_FILES) == {"q8", "q4"}
    assert declared["q8"] == declared["q4"]


def test_clear_throat_is_not_claimed() -> None:
    # Orpheus has no tag for it. Claiming it would have the model read "clear throat" out loud, which
    # is the one failure the capability document cannot catch for an adapter.
    for variant in variants().values():
        assert "clear throat" not in variant.cues
        assert set(variant.cues) == set(CUES)


def test_seven_of_the_eight_standard_cues_are_performed() -> None:
    assert len(CUES) == 7
    assert set(CUE_TAGS) == set(CUES)


def test_no_deliveries_because_orpheus_cannot_whisper() -> None:
    for variant in variants().values():
        assert variant.deliveries == ()


def test_the_dials_are_upstreams_sampling_and_respect_its_floor() -> None:
    assert set(DIALS) == {"temperature", "topP", "repetitionPenalty"}
    low, high, default = DIALS["repetitionPenalty"]
    # "repetition_penalty>=1.1 is required for stable generations", upstream's README.
    assert low == 1.1
    assert (default, DIALS["temperature"][2], DIALS["topP"][2]) == (1.3, 0.6, 0.8)
    for low, high, default in DIALS.values():
        assert low <= default <= high


def test_english_only() -> None:
    for variant in variants().values():
        assert variant.languages == ("en",)


def test_tara_is_first_because_upstream_ranks_it_most_realistic() -> None:
    assert VOICES[0] == "tara"
    assert len(VOICES) == len(set(VOICES)) == 8
