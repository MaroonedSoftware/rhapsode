"""The adapter's own decisions: what it claims, what reaches the runtime, and what comes back."""

from __future__ import annotations

import numpy as np
import pytest
from conftest import Stubs
from rhapsode_worker import BadRequest, SpeakRequest, UnknownVoice, Unsupported

from rhapsode_engine_phonon.engine import CHUNK_SAMPLES, DEFAULT_VOICE, PhononEngine, chunked_pcm


def spoken(built: PhononEngine, text: str = "A line.", **overrides: object) -> bytes:
    return b"".join(built.speak(SpeakRequest(text=text, **overrides)))  # type: ignore[arg-type]


class TestWhatItClaims:
    def test_one_build_with_two_dials_and_no_cues(self, engine: PhononEngine) -> None:
        claims = engine.variants()["31m"]
        assert list(engine.variants()) == ["31m"]
        assert claims.cues == () and claims.deliveries == ()
        assert claims.languages == ("en",)
        assert claims.dials == {"durationDelta": (-0.5, 0.5, 0.0), "temperature": (0.0, 1.0, 0.3)}

    def test_speed_is_not_claimed(self, engine: PhononEngine) -> None:
        # The OpenAI shim maps its `speed` to a dial of that name. duration_delta is not a ratio, so
        # claiming it as one would have a client ask for 2x and get about 1.4x.
        assert "speed" not in engine.variants()["31m"].dials

    def test_the_licence_says_the_weights_are_commercial(self) -> None:
        assert PhononEngine.license["weights"] == "Apache-2.0"
        assert PhononEngine.license["weights_commercial_use"] is True
        assert PhononEngine.license["code"] == "MIT OR Apache-2.0"

    def test_it_does_not_clone_or_blend(self, engine: PhononEngine) -> None:
        assert not engine.supports_cloning
        assert not engine.supports_blending

    def test_the_voices_are_the_checkpoints_own_and_the_english_catalog(self, engine: PhononEngine) -> None:
        voices = engine.voices()
        assert voices[0].id == DEFAULT_VOICE
        assert len(voices) == 38
        zoey = next(voice for voice in voices if voice.id == "Zoey")
        assert zoey.tags == ("en", "en-us", "female")
        assert zoey.description is not None

    def test_a_character_voice_has_an_id_and_keeps_its_name(self, engine: PhononEngine) -> None:
        thing = next(voice for voice in engine.voices() if voice.id == "The-Thing-Under-the-Stairs")
        assert thing.label == "The Thing Under the Stairs"
        assert thing.tags == ("en", "characters")

    def test_listing_voices_needs_no_model_and_no_network(self, engine: PhononEngine, stubs: Stubs) -> None:
        engine.voices()
        assert stubs.downloads == []
        assert stubs.built == []


class TestResidency:
    def test_load_pins_the_cpu_and_the_format(self, engine: PhononEngine, stubs: Stubs) -> None:
        engine.load("31m")
        model = stubs.built[0]
        assert (model.device, model.quant, model.lang) == ("cpu", "q8", "en")
        assert model.model.endswith("phonon-31m-en")

    def test_load_registers_every_voice_under_its_own_id(self, engine: PhononEngine, stubs: Stubs) -> None:
        engine.load("31m")
        added = stubs.built[0].added
        assert len(added) == 37
        assert added["Zoey"].endswith("NbpkqMVS3CJeq2j8.safetensors")
        assert "The-Thing-Under-the-Stairs" in added

    def test_the_thread_pool_is_sized_once(self, engine: PhononEngine, stubs: Stubs) -> None:
        # It is a global pool the runtime builds once, and residency reloads a model many times.
        engine.load("31m")
        engine.unload()
        engine.load("31m")
        assert len(stubs.threads) == 1
        assert 1 <= stubs.threads[0] <= 4

    def test_fetch_downloads_without_loading(self, engine: PhononEngine, stubs: Stubs) -> None:
        engine.fetch("31m")
        assert len(stubs.downloads) == 2
        assert stubs.built == []

    def test_unload_lets_go(self, engine: PhononEngine, stubs: Stubs) -> None:
        engine.load("31m")
        engine.unload()
        with pytest.raises(Unsupported, match="no model"):
            spoken(engine)


class TestSpeaking:
    def test_no_voice_is_the_checkpoints_own(self, engine: PhononEngine, stubs: Stubs) -> None:
        engine.load("31m")
        assert spoken(engine)
        assert stubs.built[0].calls[0].voice == DEFAULT_VOICE

    def test_the_dials_reach_the_runtime_under_its_names(self, engine: PhononEngine, stubs: Stubs) -> None:
        engine.load("31m")
        spoken(engine, voice="Zoey", params={"durationDelta": -0.3, "temperature": 0.7}, seed=7)
        call = stubs.built[0].calls[0]
        assert call.voice == "Zoey"
        assert call.temperature == 0.7
        assert call.seed == 7
        assert call.conditions == {"duration_delta": -0.3}

    def test_a_dial_does_not_outlive_its_request(self, engine: PhononEngine, stubs: Stubs) -> None:
        # Conditions are state on the model, and the next caller did not ask for the last one's pace.
        engine.load("31m")
        spoken(engine, params={"durationDelta": 0.5})
        spoken(engine)
        assert stubs.built[0].calls[1].conditions == {"duration_delta": 0.0}

    def test_a_voice_it_lacks_never_reaches_the_runtime(self, engine: PhononEngine, stubs: Stubs) -> None:
        # The runtime would look the name up in its catalog online and download what it found.
        engine.load("31m")
        with pytest.raises(UnknownVoice):
            spoken(engine, voice="Nobody")
        assert stubs.built[0].calls == []

    def test_a_voice_from_another_language_is_refused(self, engine: PhononEngine, stubs: Stubs) -> None:
        engine.load("31m")
        with pytest.raises(UnknownVoice):
            spoken(engine, voice="Nele")

    def test_an_unknown_voice_is_a_404_whatever_is_resident(self, engine: PhononEngine) -> None:
        with pytest.raises(UnknownVoice):
            spoken(engine, voice="Nobody")

    def test_text_with_nothing_to_say_is_the_callers_fault(self, engine: PhononEngine, stubs: Stubs) -> None:
        engine.load("31m")
        with pytest.raises(BadRequest, match="nothing to synthesize"):
            spoken(engine, text="🙂")

    def test_a_caller_leaving_stops_the_generation(self, engine: PhononEngine, stubs: Stubs) -> None:
        # The runtime's workers keep generating until the stream is closed.
        engine.load("31m")
        pieces = engine.speak(SpeakRequest(text="A much longer line than the shortest one could be."))
        next(pieces)
        pieces.close()
        assert stubs.built[0].streams[0].closed


class TestPcm:
    def test_chunks_are_cut_to_the_sdks_slice(self) -> None:
        pieces = list(chunked_pcm(np.zeros(CHUNK_SAMPLES * 2 + 10, dtype=np.float32)))
        assert [len(piece) // 2 for piece in pieces] == [CHUNK_SAMPLES, CHUNK_SAMPLES, 10]

    def test_an_overshoot_is_clipped_rather_than_wrapped(self) -> None:
        pcm = b"".join(chunked_pcm(np.array([1.5, -1.5], dtype=np.float32)))
        assert list(np.frombuffer(pcm, dtype="<i2")) == [32767, -32767]
