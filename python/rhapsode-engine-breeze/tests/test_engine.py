"""The adapter's own decisions: what text, template and sampling, what it clones from, what comes back."""

from __future__ import annotations

import io
import wave
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from harness.stubs import SAMPLES_PER_FRAME, Recorder
from rhapsode_worker import BadRequest, CreateVoiceRequest, Log, SpeakRequest, UnknownVoice, Unsupported
from rhapsode_worker.engine import Device
from rhapsode_worker.listen import StartupError

from rhapsode_engine_breeze.backends import MAX_NEW_TOKENS, MAX_SEQ_LEN
from rhapsode_engine_breeze.builds import FILES, REPOSITORY, REVISION
from rhapsode_engine_breeze.engine import CHUNK_SAMPLES, BreezeEngine, pcm
from rhapsode_engine_breeze.prompt import ANCHOR_CHARACTERS, SEGMENT_CHARACTERS
from rhapsode_engine_breeze.voices import LONGEST_SECONDS, SAMPLE_RATE


class RecordingLog(Log):
    def __init__(self) -> None:
        super().__init__(engine="breeze")
        self.warnings: list[tuple[str, dict[str, Any]]] = []

    def warn(self, message: str, /, **fields: Any) -> None:
        self.warnings.append((message, fields))


def engine(tmp_path: Path, device: str = "cuda") -> BreezeEngine:
    built = BreezeEngine()
    built.device = Device(type=device, name="test")
    built.voice_dir = tmp_path
    built.log = RecordingLog()
    built.variant = None
    return built


def loaded(tmp_path: Path) -> BreezeEngine:
    built = engine(tmp_path)
    built.load("2")
    built.variant = "2"
    return built


def spoken(built: BreezeEngine, text: str = "A line to read.", **overrides: Any) -> bytes:
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


def cloned(built: BreezeEngine, voice: str = "narrator", transcript: str = "The words in the clip.") -> None:
    built.create_voice(CreateVoiceRequest(id=voice, reference=clip(6.0), transcript=transcript))


LONG = " ".join(["This sentence is exactly as long as it needs to be for the test."] * 12)


class TestDevice:
    def test_on_an_nvidia_card_the_one_build_is_declared(self, breeze: Recorder, tmp_path: Path) -> None:
        assert list(engine(tmp_path).variants()) == ["2"]

    @pytest.mark.parametrize("device", ["cpu", "mps", "rocm"])
    def test_anywhere_else_the_worker_says_which_card_it_needs(
        self, breeze: Recorder, tmp_path: Path, device: str
    ) -> None:
        # Upstream's runtime raises on anything but CUDA, and an engine with no variants cannot start.
        with pytest.raises(StartupError, match="needs an NVIDIA card"):
            engine(tmp_path, device).variants()


class TestLoading:
    def test_loads_the_pinned_checkpoint_eagerly_on_the_card(self, breeze: Recorder, tmp_path: Path) -> None:
        loaded(tmp_path)
        assert breeze.downloads == [
            {"repo_id": REPOSITORY, "revision": REVISION, "allow_patterns": list(FILES), "token": None}
        ]
        load = next(load for load in breeze.loads if "checkpoint" in load)
        assert load == {"checkpoint": Path(f"/models/{REPOSITORY}"), "device": "cuda", "attention": "eager"}

    def test_the_runtime_is_upstreams_eager_path_at_its_own_limits(
        self, breeze: Recorder, tmp_path: Path
    ) -> None:
        loaded(tmp_path)
        config = next(load["runtime"] for load in breeze.loads if "runtime" in load)
        assert (config.fast_all, config.max_new_tokens, config.max_seq_len) == (
            False,
            MAX_NEW_TOKENS,
            MAX_SEQ_LEN,
        )
        assert config.repetition_penalty == 1.1

    def test_a_build_this_engine_does_not_have_is_refused(self, breeze: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no build"):
            engine(tmp_path).load("multilingual")

    def test_speaking_before_loading_is_refused(self, breeze: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no model"):
            spoken(engine(tmp_path))

    def test_unload_lets_go_of_the_model(self, breeze: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        built.unload()
        built.unload()
        with pytest.raises(Unsupported):
            spoken(built)


class TestSpeaking:
    def test_a_short_line_is_one_plain_generation(self, breeze: Recorder, tmp_path: Path) -> None:
        audio = spoken(loaded(tmp_path), "Right. [laugh] Anyway.")
        (generation,) = breeze.generations
        assert generation.template == "tts_plain"
        assert generation.text == "[S0]Right. (laugh) Anyway."
        assert len(audio) == generation.frames * SAMPLES_PER_FRAME * 2

    def test_chinese_cues_are_written_in_chinese(self, breeze: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), "[sigh] 没想到。", language="zh")
        assert breeze.generations[0].text == "[S0][叹气] 没想到。"

    def test_the_default_sampling_is_upstreams(self, breeze: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path))
        assert breeze.generations[0].sampling == {"temperature": 0.9, "top_p": 1.0}

    def test_dials_reach_the_runtime(self, breeze: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), params={"temperature": 0.7, "topP": 0.8})
        assert breeze.generations[0].sampling == {"temperature": 0.7, "top_p": 0.8}

    def test_nothing_left_to_say_is_a_bad_request(self, breeze: Recorder, tmp_path: Path) -> None:
        with pytest.raises(BadRequest, match="nothing is left"):
            spoken(loaded(tmp_path), "(burps) <ins_bos>")

    def test_audio_streams_as_the_model_makes_it(self, breeze: Recorder, tmp_path: Path) -> None:
        # The first bytes are out before the generation has finished: a chunk of upstream's is
        # passed on as soon as it arrives.
        breeze.frames = 40
        stream = loaded(tmp_path).speak(SpeakRequest(text="A line to read."))
        first = next(stream)
        assert len(first) == CHUNK_SAMPLES * 2
        rest = b"".join(stream)
        assert len(first) + len(rest) == 40 * SAMPLES_PER_FRAME * 2


class TestLongText:
    def test_with_no_voice_every_later_piece_clones_the_first(self, breeze: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), LONG)
        first, *later = breeze.generations
        assert first.template == "tts_plain"
        assert len(first.text) - len("[S0]") <= ANCHOR_CHARACTERS["en"]
        assert later and all(generation.template == "ref_clone_tata" for generation in later)
        # Each later piece clones from the first piece's own words and audio.
        assert {generation.ref_text for generation in later} == {first.text.removeprefix("[S0]")}
        anchor = later[0].ref_audio
        assert anchor is not None
        with wave.open(io.BytesIO(anchor), "rb") as heard:
            assert heard.getframerate() == SAMPLE_RATE
            assert heard.getnframes() == first.frames * SAMPLES_PER_FRAME
        assert all(generation.ref_audio == anchor for generation in later)

    def test_later_pieces_are_at_most_a_segment(self, breeze: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), LONG)
        for generation in breeze.generations[1:]:
            assert len(generation.text) - len("[S0]") <= SEGMENT_CHARACTERS

    def test_every_word_is_spoken_once(self, breeze: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), LONG)
        said = " ".join(generation.text.removeprefix("[S0]") for generation in breeze.generations)
        assert said == LONG

    def test_a_seed_is_offset_per_piece(self, breeze: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), LONG, seed=7)
        assert [generation.seed for generation in breeze.generations] == list(
            range(7, 7 + len(breeze.generations))
        )

    def test_a_seed_reproduces_the_whole_request(self, breeze: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        assert spoken(built, LONG, seed=3) == spoken(built, LONG, seed=3)
        assert spoken(built, LONG, seed=3) != spoken(built, LONG, seed=4)

    def test_a_piece_that_runs_to_the_limit_is_logged(self, breeze: Recorder, tmp_path: Path) -> None:
        breeze.frames = MAX_NEW_TOKENS
        built = loaded(tmp_path)
        spoken(built, "one")
        assert [message for message, _ in built.log.warnings] == ["a piece ran to the frame limit"]  # type: ignore[attr-defined]


class TestVoices:
    def test_a_cloned_voice_is_the_prompt_for_every_piece(self, breeze: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        cloned(built, transcript="The words [laugh] in the clip.")
        spoken(built, LONG, voice="narrator")
        assert len(breeze.generations) > 1
        assert all(generation.template == "ref_clone_tata" for generation in breeze.generations)
        assert {generation.ref_text for generation in breeze.generations} == {
            "The words (laugh) in the clip."
        }
        assert all(
            generation.ref_audio == (tmp_path / "narrator.wav").read_bytes()
            for generation in breeze.generations
        )

    def test_a_clone_needs_its_transcript(self, breeze: Recorder, tmp_path: Path) -> None:
        with pytest.raises(BadRequest, match="transcript"):
            loaded(tmp_path).create_voice(CreateVoiceRequest(id="narrator", reference=clip(6.0)))

    def test_a_clip_is_kept_at_the_models_rate(self, breeze: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        built.create_voice(CreateVoiceRequest(id="narrator", reference=clip(6.0, 48_000), transcript="x"))
        with wave.open(str(tmp_path / "narrator.wav"), "rb") as kept:
            assert kept.getframerate() == SAMPLE_RATE
            assert abs(kept.getnframes() - 6 * SAMPLE_RATE) <= 1

    def test_a_clip_too_long_to_leave_room_is_refused(self, breeze: Recorder, tmp_path: Path) -> None:
        with pytest.raises(BadRequest, match="at most"):
            engine(tmp_path).create_voice(
                CreateVoiceRequest(id="narrator", reference=clip(LONGEST_SECONDS + 1), transcript="x")
            )

    def test_voices_are_only_what_was_cloned(self, breeze: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        assert built.voices() == []
        cloned(built)
        (voice,) = built.voices()
        assert (voice.id, voice.tags) == ("narrator", ("cloned",))

    def test_the_spec_changes_with_the_transcript(self, breeze: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        cloned(built, transcript="one")
        before = built.voices()[0].spec
        cloned(built, transcript="two")
        assert built.voices()[0].spec != before

    def test_an_unknown_voice_is_never_substituted(self, breeze: Recorder, tmp_path: Path) -> None:
        with pytest.raises(UnknownVoice):
            spoken(loaded(tmp_path), voice="nobody")

    def test_a_deleted_voice_is_gone(self, breeze: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        cloned(built)
        built.delete_voice("narrator")
        assert built.voices() == []
        assert not list(tmp_path.iterdir())


class TestPcm:
    def test_out_of_range_samples_are_clipped_not_wrapped(self) -> None:
        (block,) = pcm(np.array([1.5, -1.5], dtype=np.float32))
        assert np.frombuffer(block, dtype="<i2").tolist() == [32767, -32767]
