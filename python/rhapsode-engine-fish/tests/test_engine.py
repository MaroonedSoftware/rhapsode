"""The adapter's own decisions: what script, what reference, what sampling, and what comes back."""

from __future__ import annotations

import io
import wave
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from harness.stubs import HOP, Recorder
from rhapsode_worker import BadRequest, CreateVoiceRequest, Log, SpeakRequest, UnknownVoice, Unsupported
from rhapsode_worker.engine import Device

from rhapsode_engine_fish import upstream
from rhapsode_engine_fish.backends import CHUNK_BYTES, CONTEXT, MAX_NEW_TOKENS
from rhapsode_engine_fish.builds import FILES, REPOSITORY, REVISION
from rhapsode_engine_fish.engine import CHUNK_SAMPLES, FishEngine, pcm
from rhapsode_engine_fish.prompt import SEGMENT_CHARACTERS
from rhapsode_engine_fish.voices import LONGEST_SECONDS, SAMPLE_RATE


def engine(tmp_path: Path, device: str = "cuda") -> FishEngine:
    built = FishEngine()
    built.device = Device(type=device, name="test")
    built.voice_dir = tmp_path / "voices"
    built.log = Log(engine="fish")
    built.variant = None
    return built


def loaded(tmp_path: Path, device: str = "cuda") -> FishEngine:
    built = engine(tmp_path, device)
    built.load("s2-pro")
    built.variant = "s2-pro"
    return built


def spoken(built: FishEngine, text: str = "A line to read.", **overrides: Any) -> bytes:
    return b"".join(built.speak(SpeakRequest(text=text, **overrides)))


def clip(seconds: float, rate: int = SAMPLE_RATE) -> bytes:
    samples = (np.sin(np.arange(int(seconds * rate)) / 20) * 8000).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(samples.tobytes())
    return buffer.getvalue()


def cloned(built: FishEngine, voice: str = "narrator", transcript: str = "The words in the clip.") -> None:
    built.create_voice(CreateVoiceRequest(id=voice, reference=clip(6.0), transcript=transcript))


LONG = " ".join(["This sentence is exactly as long as it needs to be for the test."] * 12)


class TestLoading:
    @pytest.mark.parametrize(("device", "torch_device"), [("cuda", "cuda"), ("mps", "mps"), ("cpu", "cpu")])
    def test_loads_on_whatever_upstream_runs_on(
        self, fish: Recorder, tmp_path: Path, device: str, torch_device: str
    ) -> None:
        loaded(tmp_path, device)
        model = next(load for load in fish.loads if "model" in load)
        assert model["device"] == torch_device
        assert model["precision"] == ("float32" if device == "cpu" else "bfloat16")
        assert model["compile"] is False

    def test_the_cache_is_this_adapters_context_and_the_config_agrees(
        self, fish: Recorder, tmp_path: Path
    ) -> None:
        # 32,768 positions is 4.8 GB of cache, which does not fit beside the model on a 16 GB card.
        loaded(tmp_path)
        assert {"cache": CONTEXT, "config": CONTEXT} in fish.loads

    def test_loads_the_pinned_checkpoint_and_its_codec(self, fish: Recorder, tmp_path: Path) -> None:
        loaded(tmp_path)
        assert fish.downloads == [
            {"repo_id": REPOSITORY, "revision": REVISION, "allow_patterns": list(FILES), "token": None}
        ]
        codec = next(load for load in fish.loads if "codec" in load)
        assert codec == {
            "codec": f"/models/{REPOSITORY}/codec.pth",
            "config_name": "modded_dac_vq",
            "device": "cuda",
        }

    def test_upstreams_tree_is_put_first_on_the_path(self, fish: Recorder, tmp_path: Path) -> None:
        import sys

        loaded(tmp_path)
        assert sys.path[0] == str(upstream.source_dir())

    def test_a_build_this_engine_does_not_have_is_refused(self, fish: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no build"):
            engine(tmp_path).load("s2-mini")

    def test_speaking_before_loading_is_refused(self, fish: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no model"):
            spoken(engine(tmp_path))

    def test_unload_stops_the_model_thread(self, fish: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        thread = built._generator._thread  # type: ignore[union-attr]
        built.unload()
        built.unload()
        assert not thread.is_alive()
        with pytest.raises(Unsupported):
            spoken(built)


class TestFetching:
    def test_fetches_upstreams_code_and_exactly_the_checkpoint_the_load_resolves(
        self, fish: Recorder, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ensured: list[Path] = []
        real = upstream.ensure
        monkeypatch.setattr(upstream, "ensure", lambda: ensured.append(real()) or ensured[-1])
        engine(tmp_path).fetch("s2-pro")
        assert ensured == [upstream.source_dir()]
        loaded(tmp_path)
        first, second = fish.downloads
        assert (
            first
            == second
            == {
                "repo_id": REPOSITORY,
                "revision": REVISION,
                "allow_patterns": list(FILES),
                "token": None,
            }
        )

    def test_fetching_does_not_load(self, fish: Recorder, tmp_path: Path) -> None:
        engine(tmp_path).fetch("s2-pro")
        assert fish.loads == []

    def test_a_build_this_engine_does_not_have_is_not_fetched(self, fish: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no build"):
            engine(tmp_path).fetch("s2-mini")
        assert fish.downloads == []


class TestSpeaking:
    def test_a_line_is_one_turn_of_the_first_speaker(self, fish: Recorder, tmp_path: Path) -> None:
        audio = spoken(loaded(tmp_path), "Right. [laugh] Anyway.")
        (batch,) = fish.batches
        assert batch.text == "<|speaker:0|>Right. [laughing] Anyway."
        assert batch.prompt_texts == []
        assert len(audio) == batch.frames * HOP * 2

    def test_the_default_sampling_is_upstreams(self, fish: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path))
        assert fish.batches[0].sampling == {"temperature": 0.8, "top_p": 0.8, "repetition_penalty": 1.1}

    def test_dials_reach_the_model(self, fish: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), params={"temperature": 0.5, "topP": 0.9, "repetitionPenalty": 1.3})
        assert fish.batches[0].sampling == {"temperature": 0.5, "top_p": 0.9, "repetition_penalty": 1.3}

    def test_a_seed_is_set_once_for_the_request(self, fish: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), LONG, seed=7)
        assert {batch.seed for batch in fish.batches} == {7}

    def test_a_seed_reproduces_the_whole_request(self, fish: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        assert spoken(built, LONG, seed=3) == spoken(built, LONG, seed=3)
        assert spoken(built, LONG, seed=3) != spoken(built, LONG, seed=4)

    def test_nothing_left_to_say_is_a_bad_request(self, fish: Recorder, tmp_path: Path) -> None:
        with pytest.raises(BadRequest, match="nothing is left"):
            spoken(loaded(tmp_path), "[whisper] <|speaker:1|>")

    def test_audio_streams_as_each_batch_is_decoded(self, fish: Recorder, tmp_path: Path) -> None:
        # Each batch's audio is passed on as upstream decodes it, in pieces, rather than once the
        # request is whole. Upstream's model thread does not wait for the decoder, so it may well be
        # batches ahead by then; that is upstream's design, and why an abandoned request keeps the
        # model busy until its last batch.
        fish.frames = 30
        stream = loaded(tmp_path).speak(SpeakRequest(text=LONG))
        first = next(stream)
        assert len(first) == CHUNK_SAMPLES * 2
        rest = b"".join(stream)
        assert len(first) + len(rest) == len(fish.batches) * 30 * HOP * 2


class TestLongText:
    def test_every_piece_is_its_own_turn_and_its_own_batch(self, fish: Recorder, tmp_path: Path) -> None:
        # Upstream batches only at speaker tags: untagged, a long text would be one generation.
        spoken(loaded(tmp_path), LONG)
        assert len(fish.batches) > 1
        for batch in fish.batches:
            assert batch.text.startswith("<|speaker:0|>")
            assert batch.text.count("<|speaker:0|>") == 1
            assert len(batch.text.encode()) <= CHUNK_BYTES
            assert len(batch.text.removeprefix("<|speaker:0|>")) <= SEGMENT_CHARACTERS

    def test_every_word_is_spoken_once(self, fish: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), LONG)
        said = " ".join(batch.text.removeprefix("<|speaker:0|>") for batch in fish.batches)
        assert said == LONG

    def test_one_request_is_one_conversation(self, fish: Recorder, tmp_path: Path) -> None:
        # Every batch of one request came from one call to the model thread, so upstream carried the
        # earlier batches' audio into each later one. That is what holds the voice.
        built = loaded(tmp_path)
        spoken(built, LONG)
        first = len(fish.batches)
        spoken(built, LONG)
        assert len(fish.batches) == 2 * first

    def test_a_batch_is_given_upstreams_budget(self, fish: Recorder, tmp_path: Path) -> None:
        assert MAX_NEW_TOKENS == 1024


class TestVoices:
    def test_a_cloned_voice_is_the_reference_for_the_whole_request(
        self, fish: Recorder, tmp_path: Path
    ) -> None:
        built = loaded(tmp_path)
        cloned(built, transcript="The words [sigh] in the clip.")
        spoken(built, LONG, voice="narrator")
        clip_bytes = (tmp_path / "voices" / "narrator.wav").read_bytes()
        for batch in fish.batches:
            assert batch.prompt_texts == ["The words [sigh] in the clip."]
            assert batch.prompt_audio == [clip_bytes]

    def test_a_clone_needs_its_transcript(self, fish: Recorder, tmp_path: Path) -> None:
        with pytest.raises(BadRequest, match="transcript"):
            engine(tmp_path).create_voice(CreateVoiceRequest(id="narrator", reference=clip(6.0)))

    def test_a_clip_is_kept_at_the_codecs_rate(self, fish: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        built.create_voice(CreateVoiceRequest(id="narrator", reference=clip(6.0, 48_000), transcript="x"))
        with wave.open(str(tmp_path / "voices" / "narrator.wav"), "rb") as kept:
            assert kept.getframerate() == SAMPLE_RATE
            assert abs(kept.getnframes() - 6 * SAMPLE_RATE) <= 1

    def test_a_clip_too_long_is_refused(self, fish: Recorder, tmp_path: Path) -> None:
        with pytest.raises(BadRequest, match="at most"):
            engine(tmp_path).create_voice(
                CreateVoiceRequest(id="narrator", reference=clip(LONGEST_SECONDS + 1), transcript="x")
            )

    def test_voices_are_only_what_was_cloned(self, fish: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        assert built.voices() == []
        cloned(built)
        (voice,) = built.voices()
        assert (voice.id, voice.tags) == ("narrator", ("cloned",))

    def test_the_spec_changes_with_the_transcript(self, fish: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        cloned(built, transcript="one")
        before = built.voices()[0].spec
        cloned(built, transcript="two")
        assert built.voices()[0].spec != before

    def test_an_unknown_voice_is_never_substituted(self, fish: Recorder, tmp_path: Path) -> None:
        with pytest.raises(UnknownVoice):
            spoken(loaded(tmp_path), voice="nobody")

    def test_a_deleted_voice_is_gone(self, fish: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        cloned(built)
        built.delete_voice("narrator")
        assert built.voices() == []


class TestPcm:
    def test_out_of_range_samples_are_clipped_not_wrapped(self) -> None:
        (block,) = pcm(np.array([1.5, -1.5], dtype=np.float32))
        assert np.frombuffer(block, dtype="<i2").tolist() == [32767, -32767]
