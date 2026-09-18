"""What each build claims, which is the whole reason the capability document has two levels."""

from __future__ import annotations

from rhapsode_engine_chatterbox.builds import CUES, clamp, variants


def test_turbo_has_cues_and_no_dials() -> None:
    # Upstream's ChatterboxTurboTTS.generate defaults both dials to 0.0 and logs that CFG, min_p and
    # exaggeration are unsupported if either arrives above it. Declaring them would be a claim the
    # weights cannot keep.
    turbo = variants()["turbo"]
    assert set(turbo.cues) == set(CUES)
    assert turbo.dials == {}
    assert turbo.deliveries == ()


def test_the_dialled_builds_have_dials_and_no_cues() -> None:
    for name in ("original", "multilingual"):
        variant = variants()[name]
        assert variant.cues == ()
        assert set(variant.dials) == {"exaggeration", "cfgWeight"}
        assert set(variant.deliveries) == {"hushed", "frantic"}


def test_you_get_cues_or_dials_and_never_both() -> None:
    # The proposition the whole two-level document exists to express. A flat capability list cannot
    # say this, and a client that assumed one would send dials that vanish without a word.
    for variant in variants().values():
        assert not (variant.cues and variant.dials)


def test_only_the_multilingual_build_claims_more_than_english() -> None:
    declared = variants()
    assert declared["turbo"].languages == ("en",)
    assert declared["original"].languages == ("en",)
    assert len(declared["multilingual"].languages) > 10
    assert "fr" in declared["multilingual"].languages


def test_clamping_rounds_away_a_float_s_idea_of_a_sum() -> None:
    assert clamp(0.8 + 0.4, 0.0, 2.0) == 1.2
    assert clamp(-1.0, 0.0, 2.0) == 0.0
    assert clamp(9.0, 0.0, 2.0) == 2.0
