"""The blend recipe's grammar. protocol.md § 7."""

from __future__ import annotations

import re

import pytest

from rhapsode_worker import BadRequest, parse_blend


class TestParsing:
    def test_reads_kokoro_fastapis_own_syntax(self) -> None:
        # What an operator coming from Kokoro-FastAPI already has typed into a config.
        assert parse_blend("af_bella(2)+af_sky(1)") == (("af_bella", 2 / 3), ("af_sky", 1 / 3))

    def test_an_absent_weight_is_one(self) -> None:
        assert parse_blend("a+b") == (("a", 0.5), ("b", 0.5))

    def test_shares_are_normalised(self) -> None:
        assert parse_blend("a(3)+b(1)") == (("a", 0.75), ("b", 0.25))

    def test_spaces_around_the_parts_are_tolerated(self) -> None:
        assert parse_blend(" a ( 1.5 ) + b ") == (("a", 0.6), ("b", 0.4))

    def test_one_voice_is_a_blend_of_one(self) -> None:
        assert parse_blend("af_heart") == (("af_heart", 1.0),)


class TestRefusals:
    @pytest.mark.parametrize(
        ("recipe", "message"),
        [
            ("", "is empty"),
            ("   ", "is empty"),
            ("a++b", "is not `name` or `name(weight)`"),
            ("a(1", "is not `name` or `name(weight)`"),
            ("a(x)", "is not a number"),
            ("a(0)+b", "must be a positive number"),
            ("a(-1)+b", "must be a positive number"),
            ("a(inf)", "must be a positive number"),
            ("a(nan)", "must be a positive number"),
            ("a+a", 'names "a" twice'),
        ],
    )
    def test_a_recipe_that_would_half_parse_is_refused(self, recipe: str, message: str) -> None:
        with pytest.raises(BadRequest, match=re.escape(message)):
            parse_blend(recipe)

    @pytest.mark.parametrize("name", ["../x", "*", "-x"])
    def test_every_name_is_a_voice_id(self, name: str) -> None:
        # A component is looked up by an adapter exactly as a voice is, so the § 7 rule applies.
        with pytest.raises(BadRequest, match="is not a name"):
            parse_blend(f"{name}+a")
