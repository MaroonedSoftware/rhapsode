"""The adapter's own decisions: which files, what reaches the model, and what comes back."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest
from rhapsode_worker import Internal, SpeakRequest, UnknownVoice, Unsupported

from rhapsode_engine_kokoro import engine as module
from rhapsode_engine_kokoro.engine import (
    ENGLISH_VOICES,
    SENTENCE_PAUSE_SAMPLES,
    KokoroEngine,
    chunked_pcm,
    sentence_groups,
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

    def test_long_text_is_spoken_a_group_at_a_time_with_the_pause_put_back(
        self, loaded: KokoroEngine
    ) -> None:
        text = " ".join(f"Sentence number {n} is here." for n in range(20))
        audio = spoken(loaded, text=text)

        calls = loaded._model.calls
        assert len(calls) > 1
        assert " ".join(call.text for call in calls) == text
        expected = sum(max(2_400, len(call.text) * 1_200) for call in calls) + SENTENCE_PAUSE_SAMPLES * (
            len(calls) - 1
        )
        assert len(audio) == expected * 2

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

    def test_there_is_no_cloning(self, engine: KokoroEngine) -> None:
        assert not engine.supports_cloning


class TestSentenceGroups:
    def test_gathers_short_sentences_up_to_the_limit(self) -> None:
        assert list(sentence_groups("One. Two. Three.", limit=10)) == ["One. Two.", "Three."]

    def test_a_sentence_longer_than_the_limit_goes_alone_and_whole(self) -> None:
        long = "This sentence is much longer than the limit."
        assert list(sentence_groups(f"Hi. {long} Bye.", limit=10)) == ["Hi.", long, "Bye."]

    def test_text_with_no_sentence_end_is_one_group(self) -> None:
        assert list(sentence_groups("  no full stop at all  ")) == ["no full stop at all"]


class TestPcm:
    def test_clips_before_it_scales(self) -> None:
        # 1.2 would wrap to a large negative number as int16, which is a click.
        (block,) = list(chunked_pcm([0.0, 1.2, -1.2], chunk_samples=10))
        assert struct.unpack("<3h", block) == (0, 32767, -32767)
