"""What a build is: its pinned files, and the catalog voices it can honestly claim."""

from __future__ import annotations

from pathlib import Path

import pytest
from conftest import Stubs
from harness import stub
from rhapsode_worker import Internal
from rhapsode_worker.engine import VOICE_ID

from rhapsode_engine_phonon import builds


class TestTheCatalog:
    def test_every_upstream_voice_is_a_valid_and_distinct_id(self) -> None:
        # Upstream's names have spaces and accents, and § 7 refuses both before an adapter is asked.
        # Two names folding onto one id would be one voice silently answering for another.
        ids = [voice.id for voice in builds.catalog()]
        assert len(ids) == 102
        assert len(set(ids)) == len(ids)
        assert all(VOICE_ID.fullmatch(voice) for voice in ids)

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("Zoey", "Zoey"),
            ("Elodie-Rose", "Elodie-Rose"),
            ("The Thing Under the Stairs", "The-Thing-Under-the-Stairs"),
            ("Lucía-Sol", "Lucia-Sol"),
            ("Maëlys", "Maelys"),
        ],
    )
    def test_a_name_becomes_an_id(self, name: str, expected: str) -> None:
        assert builds.voice_id(name) == expected

    def test_the_english_build_claims_only_english_voices(self) -> None:
        voices = builds.voices_for(builds.OPEN_BUILDS["31m"])
        assert len(voices) == 37
        assert {voice.language for voice in voices} == {"en"}
        assert "Zoey" in {voice.id for voice in voices}

    def test_every_language_has_voices_and_one_build_has_them_all(self) -> None:
        for name in ("en", "fr", "de", "es", "pt"):
            voices = builds.voices_for(builds.GATED_BUILDS[name])
            assert voices
            assert {voice.language for voice in voices} == {name}
        assert len(builds.voices_for(builds.GATED_BUILDS["multilingual"])) == 102


class TestDownloading:
    def test_it_asks_for_only_the_files_it_reads_at_pinned_revisions(self, stubs: Stubs) -> None:
        checkpoint, voices = builds.ensure(builds.OPEN_BUILDS["31m"])

        model, catalog = stubs.downloads
        assert model.repo_id == "gradium/phonon-31m-en"
        assert model.revision == builds.OPEN_BUILDS["31m"].revision
        assert model.allow_patterns == list(builds.CHECKPOINT_FILES)
        assert catalog.repo_id == builds.VOICES_REPOSITORY
        assert catalog.revision == builds.VOICES_REVISION
        # Named one by one, because the same repository holds about 2,100 audio samples as well.
        assert len(catalog.allow_patterns) == 37
        assert all(pattern.startswith("voices/") for pattern in catalog.allow_patterns)

        assert checkpoint.name == "phonon-31m-en"
        assert voices["Zoey"].name == "NbpkqMVS3CJeq2j8.safetensors"

    def test_a_token_reaches_both_downloads(self, stubs: Stubs, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HF_TOKEN", "hf_test")
        builds.ensure(builds.OPEN_BUILDS["31m"])
        assert [download.token for download in stubs.downloads] == ["hf_test", "hf_test"]

    def test_no_token_lets_the_library_use_the_saved_login(
        self, stubs: Stubs, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # An empty string would be sent as a token. None is what reaches ~/.cache/huggingface/token.
        monkeypatch.setenv("HF_TOKEN", "")
        builds.ensure(builds.GATED_BUILDS["de"])
        assert stubs.downloads[0].token is None

    @pytest.mark.parametrize("status", [401, 403])
    def test_a_gated_refusal_says_what_to_do(self, stubs: Stubs, tmp_path: Path, status: int) -> None:
        stub.install(tmp_path, refuse=status)
        with pytest.raises(Internal, match=r"huggingface\.co/gradium/phonon-40m-de.*hf auth login"):
            builds.ensure(builds.GATED_BUILDS["de"])

    def test_any_other_failure_is_left_alone(self, stubs: Stubs, tmp_path: Path) -> None:
        stub.install(tmp_path, refuse=500)
        with pytest.raises(stub.StubHfHubHTTPError):
            builds.ensure(builds.GATED_BUILDS["de"])
