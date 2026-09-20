"""The adapter's own decisions: which files, what reaches the model, and what comes back."""

from __future__ import annotations

import struct
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from harness import voicepacks
from rhapsode_worker import (
    BadRequest,
    BlendRequest,
    CreateVoiceRequest,
    Internal,
    SpeakRequest,
    UnknownVoice,
    Unsupported,
    Voice,
    parse_blend,
)

from rhapsode_engine_kokoro import engine as module
from rhapsode_engine_kokoro import styles
from rhapsode_engine_kokoro.engine import (
    ENGLISH_VOICES,
    GROUP_CHARACTERS,
    SEGMENT_PAUSE_MS,
    KokoroEngine,
    chunked_pcm,
)


@pytest.fixture
def weighed(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """`weights.ensure` without files: records the variant and answers with two paths."""
    asked: list[str] = []

    def ensure(variant: str) -> tuple[Path, Path]:
        asked.append(variant)
        return Path(f"/w/{variant}.onnx"), Path("/w/voices.bin")

    monkeypatch.setattr(module.weights, "ensure", ensure)
    return asked


def spoken(built: KokoroEngine, text: str = "A line.", **overrides: object) -> bytes:
    return b"".join(built.speak(SpeakRequest(text=text, **overrides)))  # type: ignore[arg-type]


class TestWhatItClaims:
    def test_three_precisions_of_one_model_claim_the_same_things(self, engine: KokoroEngine) -> None:
        variants = engine.variants()
        assert sorted(variants) == ["fp16", "fp32", "int8"]
        assert len({variant.document().__repr__() for variant in variants.values()}) == 1

    def test_speed_is_the_one_dial_and_there_are_no_cues(self, engine: KokoroEngine) -> None:
        claims = engine.variants()["fp16"]
        assert claims.dials == {"speed": (0.5, 2.0, 1.0)}
        assert claims.cues == () and claims.deliveries == ()
        assert claims.languages == ("en",)

    def test_the_licence_is_what_the_process_runs_not_what_the_package_is(self) -> None:
        # § 4: kokoro-onnx is MIT and phonemizes through GPL code. A scanner reading this package
        # would say MIT, and be wrong in the way that matters.
        assert KokoroEngine.license["code"] == "GPL-3.0-or-later"
        assert KokoroEngine.license["weights"] == "Apache-2.0"
        assert "eSpeak NG" in KokoroEngine.license["notes"]


class TestLoading:
    def test_a_variant_loads_its_own_graph_and_the_shared_voices(
        self, engine: KokoroEngine, kokoro: list, weighed: list[str]
    ) -> None:
        engine.load("int8")
        assert weighed == ["int8"]
        assert (kokoro[0].model_path, kokoro[0].voices_path) == ("/w/int8.onnx", "/w/voices.bin")
        assert kokoro[0].espeak_config.data_path == "/short/espeak-ng-data"

    def test_a_data_path_espeak_would_exit_over_is_refused_before_espeak_sees_it(
        self, engine: KokoroEngine, kokoro: list, weighed: list[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # At 160 characters eSpeak NG calls exit(1) on its first phonemization, and the worker dies
        # with no exception to catch. Refusing at load is a 500 with a reason instead.
        import espeakng_loader

        monkeypatch.setattr(espeakng_loader, "get_data_path", lambda: "/" + "x" * 159)
        with pytest.raises(Internal, match="160 characters long"):
            engine.load("fp16")
        assert kokoro == []

    def test_the_longest_path_espeak_takes_is_allowed(
        self, engine: KokoroEngine, kokoro: list, weighed: list[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import espeakng_loader

        monkeypatch.setattr(espeakng_loader, "get_data_path", lambda: "/" + "x" * 158)
        engine.load("fp16")
        assert len(kokoro) == 1

    def test_unload_drops_the_model(self, engine: KokoroEngine, kokoro: list, weighed: list[str]) -> None:
        engine.load("fp16")
        engine.unload()
        assert engine._model is None


class TestSpeaking:
    @pytest.fixture
    def loaded(self, engine: KokoroEngine, kokoro: list, weighed: list[str]) -> KokoroEngine:
        engine.load("fp16")
        engine.variant = "fp16"
        return engine

    def test_no_voice_means_af_heart(self, loaded: KokoroEngine) -> None:
        spoken(loaded)
        assert loaded._model.calls[0].voice == "af_heart"

    def test_the_voice_decides_the_accent(self, loaded: KokoroEngine) -> None:
        spoken(loaded, voice="bm_george")
        spoken(loaded, voice="am_adam")
        assert [call.lang for call in loaded._model.calls] == ["en-gb", "en-us"]

    def test_a_voice_kokoro_has_but_this_adapter_does_not_claim_is_unknown(
        self, loaded: KokoroEngine
    ) -> None:
        # ff_siwis is in the voices file. It is French, and this adapter claims English only, so it
        # is refused rather than read out in English phonemes.
        with pytest.raises(UnknownVoice):
            spoken(loaded, voice="ff_siwis")

    def test_speed_reaches_the_model_and_defaults_to_one(self, loaded: KokoroEngine) -> None:
        spoken(loaded)
        spoken(loaded, params={"speed": 1.5})
        assert [call.speed for call in loaded._model.calls] == [1.0, 1.5]

    def test_one_call_says_one_piece(self, loaded: KokoroEngine) -> None:
        """The SDK splits long text and joins the pieces (protocol.md § 8), so this adapter is one
        `create` per request and the loop it used to carry is gone."""
        text = " ".join(f"Sentence number {n} is here." for n in range(20))
        audio = spoken(loaded, text=text)

        calls = loaded._model.calls
        assert [call.text for call in calls] == [text]
        assert len(audio) == max(2_400, len(text) * 1_200) * 2

    def test_the_split_is_declared_for_the_sdk_to_make(self, engine: KokoroEngine) -> None:
        """The numbers are this engine's; the splitting is not. protocol.md § 8."""
        assert engine.segment_characters == GROUP_CHARACTERS
        assert engine.segment_pause_ms == SEGMENT_PAUSE_MS
        assert engine.splits_own_text is False

    def test_speaking_with_nothing_loaded_is_refused(self, engine: KokoroEngine) -> None:
        with pytest.raises(Unsupported, match="no model"):
            spoken(engine)


class TestVoices:
    def test_every_english_voice_with_its_accent_and_sex(self, engine: KokoroEngine) -> None:
        voices = {voice.id: voice for voice in engine.voices()}
        assert len(voices) == len(ENGLISH_VOICES) == 28
        assert voices["bf_emma"].label == "Emma"
        assert voices["bf_emma"].description == "British English, female"
        assert voices["am_adam"].tags == ("en", "en-us", "male")

    def test_the_spec_changes_with_the_precision(self, engine: KokoroEngine) -> None:
        # § 7: the spec changes whenever the rendering would, and int8 does not sound like fp32.
        engine.variant = "int8"
        quiet = {voice.id: voice.spec for voice in engine.voices()}
        engine.variant = "fp32"
        full = {voice.id: voice.spec for voice in engine.voices()}
        assert quiet["af_heart"] != full["af_heart"]

    def test_a_voice_is_made_from_a_style_vector_or_a_blend(self, engine: KokoroEngine) -> None:
        assert engine.supports_cloning and engine.supports_blending
        assert engine.reference_formats() == ("npy", "pt")
        # A style vector has no duration to advise on, so the capability document says nothing.
        assert engine.reference_seconds() is None


@pytest.fixture
def pack(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """A voices file of three built-in voices, where `weights.ensure_voices` will find it."""
    built = {name: voicepacks.style(seed) for seed, name in enumerate(("af_bella", "af_sky", "bm_george"))}
    path = tmp_path / "voices-v1.0.bin"
    with path.open("wb") as target:
        np.savez(target, **built)
    monkeypatch.setattr(module.weights, "ensure_voices", lambda: path)
    return built


def upload(built: KokoroEngine, voice_id: str, value: Any, filename: str = "am_x.pt") -> Voice:
    return built.create_voice(
        CreateVoiceRequest(id=voice_id, reference=voicepacks.at_start(value), filename=filename)
    )


def blend(built: KokoroEngine, voice_id: str, recipe: str) -> Voice:
    return built.blend_voice(BlendRequest(id=voice_id, components=parse_blend(recipe), recipe=recipe))


class TestCreatedVoices:
    @pytest.fixture
    def made(self, engine: KokoroEngine, tmp_path: Path) -> KokoroEngine:
        engine.voice_dir = tmp_path / "voices"
        return engine

    def test_a_blend_is_the_weighted_mix_of_its_parts(self, made: KokoroEngine, pack: dict[str, Any]) -> None:
        voice = blend(made, "host", "af_bella(3)+af_sky(1)")
        assert voice.tags == ("en", "en-us", "blended")
        assert voice.description == "Blended from af_bella(3)+af_sky(1)"
        stored, _ = styles.load(made.voice_dir / "host.npz")
        assert np.allclose(stored, pack["af_bella"] * 0.75 + pack["af_sky"] * 0.25)

    def test_a_blend_reads_in_its_heaviest_parts_accent(
        self, made: KokoroEngine, pack: dict[str, Any]
    ) -> None:
        assert blend(made, "host", "af_bella+bm_george(2)").tags[1] == "en-gb"

    def test_a_blend_can_use_a_created_voice(self, made: KokoroEngine, pack: dict[str, Any]) -> None:
        upload(made, "gurney", voicepacks.style(9))
        stored_gurney, _ = styles.load(made.voice_dir / "gurney.npz")
        blend(made, "mix", "gurney+af_sky")
        mixed, _ = styles.load(made.voice_dir / "mix.npz")
        assert np.allclose(mixed, stored_gurney * 0.5 + pack["af_sky"] * 0.5)

    def test_a_part_it_does_not_have_is_unknown(self, made: KokoroEngine, pack: dict[str, Any]) -> None:
        with pytest.raises(UnknownVoice):
            blend(made, "host", "af_bella+nobody")

    def test_the_spec_follows_the_vector_not_the_recipe(
        self, made: KokoroEngine, pack: dict[str, Any]
    ) -> None:
        # The same recipe over a re-uploaded part renders differently, so it must mint a new spec.
        upload(made, "part", voicepacks.style(10))
        first = blend(made, "mix", "part+af_sky").spec
        upload(made, "part", voicepacks.style(11))
        assert blend(made, "mix", "part+af_sky").spec != first

    def test_an_upload_keeps_kokoros_own_accent_naming(self, made: KokoroEngine) -> None:
        assert upload(made, "one", voicepacks.style(), filename="bm_v0lewis.pt").tags == (
            "en",
            "en-gb",
            "uploaded",
        )
        assert upload(made, "two", voicepacks.style(), filename="gurney.pt").tags[1] == "en-us"

    def test_a_built_in_id_cannot_be_taken(self, made: KokoroEngine) -> None:
        # speak() resolves a built-in first, so a created voice named af_heart would never be heard.
        with pytest.raises(BadRequest, match="own voices"):
            upload(made, "af_heart", voicepacks.style())

    def test_it_is_listed_and_deleted(self, made: KokoroEngine) -> None:
        upload(made, "gurney", voicepacks.style())
        assert "gurney" in {voice.id for voice in made.voices()}
        made.delete_voice("gurney")
        assert "gurney" not in {voice.id for voice in made.voices()}
        with pytest.raises(Unsupported):
            made.delete_voice("af_heart")

    def test_it_is_spoken_as_its_array_in_its_accent(
        self, made: KokoroEngine, kokoro: list, weighed: list[str]
    ) -> None:
        value = voicepacks.style(12)
        upload(made, "gurney", value, filename="bm_gurney.pt")
        made.load("fp16")
        spoken(made, voice="gurney")
        call = made._model.calls[0]
        assert np.array_equal(call.voice, value) and call.lang == "en-gb"

    def test_a_created_voice_that_is_gone_is_unknown(
        self, made: KokoroEngine, kokoro: list, weighed: list[str]
    ) -> None:
        made.load("fp16")
        with pytest.raises(UnknownVoice):
            spoken(made, voice="gurney")


class TestPcm:
    def test_clips_before_it_scales(self) -> None:
        # 1.2 would wrap to a large negative number as int16, which is a click.
        (block,) = list(chunked_pcm([0.0, 1.2, -1.2], chunk_samples=10))
        assert struct.unpack("<3h", block) == (0, 32767, -32767)
