"""The adapter's own decisions: which build, what arguments, and what comes back."""

from __future__ import annotations

import struct
from pathlib import Path
from typing import Any

import pytest
from rhapsode_worker import BadRequest, CreateVoiceRequest, Log, SpeakRequest, Unsupported
from rhapsode_worker.engine import Device

from rhapsode_engine_chatterbox.builds import CFG_WEIGHT_RANGE, EXAGGERATION_RANGE
from rhapsode_engine_chatterbox.engine import SAMPLE_RATE, ChatterboxEngine, chunked_pcm


def engine(tmp_path: Path) -> ChatterboxEngine:
    built = ChatterboxEngine()
    built.device = Device(type="cpu", name="test")
    built.voice_dir = tmp_path
    built.log = Log(engine="chatterbox")
    built.variant = None
    return built


def spoken(built: ChatterboxEngine, **overrides: Any) -> list[bytes]:
    request = SpeakRequest(text="a line", **overrides)
    return list(built.speak(request))


class TestLoading:
    def test_each_variant_loads_its_own_upstream_class(self, chatterbox, tmp_path: Path) -> None:
        # Upstream ships a class per build rather than one class with a variant argument, which is a
        # fact about this engine and not about the protocol. Nano is the one exception, below.
        built = engine(tmp_path)
        for name in ("turbo", "nano", "original", "multilingual"):
            built.load(name)
            assert chatterbox[name].name == name

    def test_nano_is_turbo_s_class_asked_for_nano(self, chatterbox, tmp_path: Path) -> None:
        # Without the flag upstream loads turbo's 3.8 GB, and nothing downstream could tell.
        engine(tmp_path).load("nano")
        assert "nano" in chatterbox
        assert "turbo" not in chatterbox

    def test_the_device_reaches_upstream_as_a_string(self, chatterbox, tmp_path: Path) -> None:
        # Upstream picks its checkpoint map_location with `device in ["cpu", "mps"]`. A torch.device
        # fails that comparison, and on Apple Silicon the load died deserializing onto CUDA.
        built = engine(tmp_path)
        built.device = Device(type="mps", name="test")
        built.load("turbo")
        assert chatterbox["turbo"].device == "mps"

    def test_a_build_this_engine_does_not_have_is_refused(self, chatterbox, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no build"):
            engine(tmp_path).load("enormous")

    def test_unload_drops_the_model_and_never_throws(self, chatterbox, tmp_path: Path) -> None:
        # Freeing memory is an optimisation and must not fail a render that already succeeded.
        built = engine(tmp_path)
        built.load("turbo")
        built.unload()
        built.unload()
        assert built._model is None


class TestWhatReachesGenerate:
    def test_turbo_is_sent_zeroes_so_upstream_does_not_warn(self, chatterbox, tmp_path: Path) -> None:
        # Anything above zero makes upstream log that CFG, min_p and exaggeration are unsupported and
        # then ignore them. The capability document already says this build has no dials, so a
        # non-zero value here could only mean something upstream of here ignored that.
        built = engine(tmp_path)
        built.load("turbo")
        built.variant = "turbo"
        spoken(built, variant="turbo")

        arguments = chatterbox["turbo"].calls[-1].arguments
        assert arguments["exaggeration"] == 0.0
        assert arguments["cfg_weight"] == 0.0
        assert arguments["min_p"] == 0.0

    def test_nano_is_sent_zeroes_too(self, chatterbox, tmp_path: Path) -> None:
        # Nano generates with turbo's method, which warns about the same three arguments by name.
        built = engine(tmp_path)
        built.load("nano")
        built.variant = "nano"
        spoken(built, variant="nano")

        arguments = chatterbox["nano"].calls[-1].arguments
        assert (arguments["exaggeration"], arguments["cfg_weight"], arguments["min_p"]) == (0.0, 0.0, 0.0)

    def test_the_dialled_build_is_sent_the_dials_it_declares(self, chatterbox, tmp_path: Path) -> None:
        built = engine(tmp_path)
        built.load("original")
        built.variant = "original"
        spoken(built, variant="original", params={"exaggeration": 0.9, "cfgWeight": 0.3})

        arguments = chatterbox["original"].calls[-1].arguments
        assert arguments["exaggeration"] == 0.9
        # The wire spells it cfgWeight and upstream spells it cfg_weight; translating between the two
        # is the adapter's job and nobody else's.
        assert arguments["cfg_weight"] == 0.3

    def test_defaults_are_upstream_s_neutral_when_the_request_says_nothing(
        self, chatterbox, tmp_path: Path
    ) -> None:
        built = engine(tmp_path)
        built.load("original")
        built.variant = "original"
        spoken(built, variant="original")

        arguments = chatterbox["original"].calls[-1].arguments
        assert arguments["exaggeration"] == EXAGGERATION_RANGE[2]
        assert arguments["cfg_weight"] == CFG_WEIGHT_RANGE[2]

    def test_only_the_multilingual_build_is_told_a_language(self, chatterbox, tmp_path: Path) -> None:
        built = engine(tmp_path)
        built.load("multilingual")
        built.variant = "multilingual"
        spoken(built, variant="multilingual", language="fr")
        assert chatterbox["multilingual"].calls[-1].arguments["language_id"] == "fr"

        built.load("original")
        built.variant = "original"
        spoken(built, variant="original", language="en")
        assert "language_id" not in chatterbox["original"].calls[-1].arguments

    def test_a_voice_becomes_a_reference_audio_path(self, chatterbox, tmp_path: Path) -> None:
        (tmp_path / "narrator.wav").write_bytes(b"RIFF" + b"\0" * 64)
        built = engine(tmp_path)
        built.load("turbo")
        built.variant = "turbo"
        spoken(built, variant="turbo", voice="narrator")

        assert chatterbox["turbo"].calls[-1].arguments["audio_prompt_path"].endswith("narrator.wav")

    def test_no_voice_speaks_as_the_build_after_a_clone_has(self, chatterbox, tmp_path: Path) -> None:
        # Upstream keeps one `conds` per model and a clone overwrites it, so every request without a
        # voice after the first clone spoke as that clone. Measured on nano with seed 7: the stock
        # line reproduced exactly until a clone ran, and never again after it.
        (tmp_path / "narrator.wav").write_bytes(b"RIFF" + b"\0" * 64)
        built = engine(tmp_path)
        for name in ("turbo", "original"):
            built.load(name)
            built.variant = name
            spoken(built, variant=name, voice="narrator")
            spoken(built, variant=name)
            assert chatterbox[name].calls[-1].conds == "stock"

    def test_a_voice_that_does_not_exist_is_refused_before_anything_is_generated(
        self, chatterbox, tmp_path: Path
    ) -> None:
        built = engine(tmp_path)
        built.load("turbo")
        built.variant = "turbo"
        with pytest.raises(Exception, match="narrator_99"):
            spoken(built, variant="turbo", voice="narrator_99")
        assert chatterbox["turbo"].calls == []


class TestDeliveries:
    def test_a_delivery_moves_the_voice_rather_than_replacing_it(self, tmp_path: Path) -> None:
        # The rule section 5 states and the one an adapter is most likely to get wrong. A voice that
        # is intense at rest must still be more intense than its neighbours when hushed.
        built = engine(tmp_path)
        intense = built.apply_delivery("hushed", {"exaggeration": 1.4, "cfgWeight": 0.8})
        calm = built.apply_delivery("hushed", {"exaggeration": 0.3, "cfgWeight": 0.4})

        assert intense["exaggeration"] > calm["exaggeration"]
        assert intense["exaggeration"] < 1.4
        assert calm["exaggeration"] < 0.3

    def test_frantic_raises_expression_and_leaves_pacing_alone(self, tmp_path: Path) -> None:
        # More exaggeration speeds a reading up, and the pace it gains is part of what makes it
        # frantic. Lowering CFG weight as well would slow it back down.
        built = engine(tmp_path)
        moved = built.apply_delivery("frantic", {"exaggeration": 0.5, "cfgWeight": 0.5})
        assert moved["exaggeration"] > 0.5
        assert moved["cfgWeight"] == 0.5

    def test_hushed_lowers_both(self, tmp_path: Path) -> None:
        built = engine(tmp_path)
        moved = built.apply_delivery("hushed", {"exaggeration": 0.5, "cfgWeight": 0.5})
        assert moved["exaggeration"] < 0.5
        assert moved["cfgWeight"] < 0.5

    def test_no_delivery_changes_nothing(self, tmp_path: Path) -> None:
        # A request with no delivery is the voice's own ordinary reading, which is what nearly every
        # line should be.
        built = engine(tmp_path)
        dials = {"exaggeration": 0.7, "cfgWeight": 0.4}
        assert built.apply_delivery(None, dict(dials)) == dials

    def test_an_offset_cannot_push_a_dial_out_of_its_declared_range(self, tmp_path: Path) -> None:
        built = engine(tmp_path)
        assert built.apply_delivery("hushed", {"exaggeration": 0.1, "cfgWeight": 0.05})["cfgWeight"] == 0.0
        assert built.apply_delivery("frantic", {"exaggeration": 1.9, "cfgWeight": 0.5})["exaggeration"] <= 2.0


class TestVoices:
    def test_a_cloned_voice_is_a_file(self, tmp_path: Path) -> None:
        built = engine(tmp_path)
        voice = built.create_voice(
            CreateVoiceRequest(
                id="narrator_03", reference=b"RIFF" + b"\0" * 64, label="Narrator 03", filename="clip.wav"
            )
        )

        assert (tmp_path / "narrator_03.wav").exists()
        assert voice.id == "narrator_03"
        assert [found.id for found in built.voices()] == ["narrator_03"]

    def test_the_spec_names_the_build_that_would_render_it(self, tmp_path: Path) -> None:
        # The same reference read by turbo and by original are two different renderings, so a client
        # keying a cached preview on the id alone would serve the wrong one forever.
        built = engine(tmp_path)
        built.create_voice(CreateVoiceRequest(id="one", reference=b"RIFF" + b"\0" * 64, filename="a.wav"))

        built.variant = "turbo"
        turbo = built.voices()[0].spec
        built.variant = "original"
        assert built.voices()[0].spec != turbo

    def test_reference_audio_has_to_be_audio(self, tmp_path: Path) -> None:
        built = engine(tmp_path)
        with pytest.raises(Unsupported, match="reference audio"):
            built.create_voice(CreateVoiceRequest(id="x", reference=b"nope", filename="notes.txt"))

    def test_empty_reference_audio_is_refused(self, tmp_path: Path) -> None:
        built = engine(tmp_path)
        with pytest.raises(BadRequest):
            built.create_voice(CreateVoiceRequest(id="x", reference=b"", filename="clip.wav"))

    def test_deleting_a_voice_removes_the_file(self, tmp_path: Path) -> None:
        built = engine(tmp_path)
        built.create_voice(CreateVoiceRequest(id="gone", reference=b"RIFF" + b"\0" * 64, filename="a.wav"))
        built.delete_voice("gone")
        assert built.voices() == []

    def test_cloning_is_advertised_because_it_is_implemented(self, tmp_path: Path) -> None:
        # Derived by the SDK from whether the methods were overridden, so an adapter cannot advertise
        # cloning it did not write or forget to advertise cloning it did.
        assert engine(tmp_path).supports_cloning is True


class TestPcm:
    def test_a_waveform_becomes_little_endian_signed_16_bit(self) -> None:
        chunks = list(chunked_pcm([[0.0, 1.0, -1.0]], chunk_samples=8))
        assert struct.unpack("<3h", b"".join(chunks)) == (0, 32767, -32767)

    def test_it_clips_before_scaling_rather_than_after(self) -> None:
        # A value slightly outside the range wraps to full scale of the opposite sign once it is an
        # integer, so a moment of loudness becomes a click. Nobody hears that until it airs.
        chunks = b"".join(chunked_pcm([[1.4, -1.4]], chunk_samples=8))
        assert struct.unpack("<2h", chunks) == (32767, -32767)

    def test_it_arrives_in_pieces(self) -> None:
        pieces = list(chunked_pcm([[0.0] * 10_000], chunk_samples=1_000))
        assert len(pieces) == 10
        assert all(len(piece) == 2_000 for piece in pieces)

    def test_the_last_piece_is_whatever_is_left(self) -> None:
        pieces = list(chunked_pcm([[0.0] * 2_500], chunk_samples=1_000))
        assert [len(piece) for piece in pieces] == [2_000, 2_000, 1_000]

    def test_speaking_produces_a_second_of_audio_per_second_of_waveform(
        self, chatterbox, tmp_path: Path
    ) -> None:
        built = engine(tmp_path)
        built.load("turbo")
        built.variant = "turbo"
        total = sum(len(chunk) for chunk in spoken(built, variant="turbo"))
        assert total == SAMPLE_RATE * 2  # 24000 samples, two bytes each


class TestFetching:
    def test_every_build_knows_where_its_weights_are(self) -> None:
        # A variant without an entry here would fail its fetch with a KeyError, which the SDK
        # reports as internal. Better to fail here, where the missing name is obvious.
        from rhapsode_engine_chatterbox.builds import WEIGHTS, variants

        assert set(WEIGHTS) == set(variants())

    def test_asks_for_the_files_the_build_loads_and_no_more(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # original and multilingual share a repository. Downloading it whole for either would
        # fetch both, which is most of the 9.7 GB all three came to.
        import sys
        import types

        asked: list[dict[str, Any]] = []
        hub = types.ModuleType("huggingface_hub")
        hub.snapshot_download = lambda **arguments: asked.append(arguments) or str(tmp_path)  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
        monkeypatch.delenv("HF_TOKEN", raising=False)

        engine(tmp_path).fetch("original")

        assert asked == [
            {
                "repo_id": "ResembleAI/chatterbox",
                "allow_patterns": [
                    "ve.safetensors",
                    "t3_cfg.safetensors",
                    "s3gen.safetensors",
                    "tokenizer.json",
                    "conds.pt",
                ],
                "token": None,
            }
        ]

    def test_nano_fetches_from_its_own_repository(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # Same class and patterns as turbo, different weights. Fetching turbo's repository here would
        # succeed, download 3.8 GB, and leave the load that follows to download nano all over again.
        import sys
        import types

        asked: list[dict[str, Any]] = []
        hub = types.ModuleType("huggingface_hub")
        hub.snapshot_download = lambda **arguments: asked.append(arguments) or str(tmp_path)  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "huggingface_hub", hub)

        engine(tmp_path).fetch("nano")

        assert asked[0]["repo_id"] == "ResembleAI/chatterbox-nano"

    def test_does_not_load_anything(
        self, chatterbox, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        import sys
        import types

        hub = types.ModuleType("huggingface_hub")
        hub.snapshot_download = lambda **arguments: str(tmp_path)  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "huggingface_hub", hub)

        built = engine(tmp_path)
        built.fetch("turbo")
        assert built._model is None
        assert "turbo" not in chatterbox


class TestCloningOnAppleSilicon:
    def test_turbo_loudness_comes_back_as_float32(self) -> None:
        # pyloudnorm returns float64 and MPS cannot hold it, so every clone failed on a Mac.
        import numpy as np

        from rhapsode_engine_chatterbox.engine import _float32_loudness

        class Turbo:
            def norm_loudness(self, wav: Any, sr: int) -> Any:
                return wav.astype("float64") * 2

        model = Turbo()
        _float32_loudness(model)
        out = model.norm_loudness(np.ones(4, dtype="float32"), 24_000)
        assert out.dtype == np.float32
        assert list(out) == [2.0, 2.0, 2.0, 2.0]

    def test_a_build_without_the_step_is_left_alone(self) -> None:
        from rhapsode_engine_chatterbox.engine import _float32_loudness

        class Original:
            pass

        model = Original()
        _float32_loudness(model)
        assert not hasattr(model, "norm_loudness")
