"""The adapter's own decisions: which build, which voice, what sampling, and what comes back."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from harness.stubs import Recorder
from rhapsode_worker import Log, SpeakRequest, UnknownVoice, Unsupported
from rhapsode_worker.engine import Device

from rhapsode_engine_orpheus.builds import GGUF_FILES, GGUF_REPOSITORY, GGUF_REVISION, VOICES
from rhapsode_engine_orpheus.codes import SAMPLES_PER_FRAME
from rhapsode_engine_orpheus.engine import OrpheusEngine
from rhapsode_engine_orpheus.prompt import MAX_TOKENS, SEGMENT_CHARACTERS


class RecordingLog(Log):
    def __init__(self) -> None:
        super().__init__(engine="orpheus")
        self.warnings: list[tuple[str, dict[str, Any]]] = []

    def warn(self, message: str, /, **fields: Any) -> None:
        self.warnings.append((message, fields))


def engine(tmp_path: Path, device: str = "cpu") -> OrpheusEngine:
    built = OrpheusEngine()
    built.device = Device(type=device, name="test")
    built.voice_dir = tmp_path
    built.log = RecordingLog()
    built.variant = None
    return built


def loaded(tmp_path: Path, variant: str = "q8", device: str = "cpu") -> OrpheusEngine:
    built = engine(tmp_path, device)
    built.load(variant)
    built.variant = variant
    return built


def spoken(built: OrpheusEngine, text: str = "a line", **overrides: Any) -> bytes:
    return b"".join(built.speak(SpeakRequest(text=text, **overrides)))


def prompts(orpheus: Recorder) -> list[str]:
    return [bytes(generation.tokens[2:-4]).decode() for generation in orpheus.llamas[-1].generations]


class TestLoading:
    def test_each_build_loads_its_own_gguf_from_one_pinned_revision(
        self, orpheus: Recorder, tmp_path: Path
    ) -> None:
        for variant, filename in GGUF_FILES.items():
            loaded(tmp_path, variant)
            assert orpheus.llamas[-1].model_path == f"/models/{filename}"
        ggufs = [download for download in orpheus.downloads if "filename" in download]
        assert {download["repo_id"] for download in ggufs} == {GGUF_REPOSITORY}
        assert {download["revision"] for download in ggufs} == {GGUF_REVISION}

    def test_a_build_this_engine_does_not_have_is_refused(self, orpheus: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no build"):
            engine(tmp_path).load("q2")

    def test_a_mac_offloads_the_llama_and_decodes_on_the_cpu(self, orpheus: Recorder, tmp_path: Path) -> None:
        import snac

        loaded(tmp_path, device="mps")
        assert orpheus.llamas[-1].options["n_gpu_layers"] == -1
        assert snac.codec.device == "cpu"  # type: ignore[attr-defined]

    def test_a_cuda_card_runs_the_codec_beside_the_llama(self, orpheus: Recorder, tmp_path: Path) -> None:
        import snac

        loaded(tmp_path, device="cuda")
        assert snac.codec.device == "cuda"  # type: ignore[attr-defined]

    def test_unload_closes_the_model_and_may_be_repeated(self, orpheus: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        built.unload()
        built.unload()
        assert orpheus.llamas[-1].closed
        with pytest.raises(Unsupported, match="no model"):
            spoken(built)


class TestVoices:
    def test_the_finetunes_eight_and_no_cloning(self, orpheus: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        assert [voice.id for voice in built.voices()] == list(VOICES)
        assert not built.supports_cloning

    def test_the_spec_changes_with_the_build(self, orpheus: Recorder, tmp_path: Path) -> None:
        built = engine(tmp_path)
        before = {voice.spec for voice in built.voices()}
        built.variant = "q4"
        assert before.isdisjoint({voice.spec for voice in built.voices()})

    def test_no_voice_is_tara(self, orpheus: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path))
        assert prompts(orpheus) == ["tara: a line"]

    def test_a_named_voice_leads_the_prompt(self, orpheus: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), voice="leo")
        assert prompts(orpheus) == ["leo: a line"]

    def test_an_unknown_voice_is_refused_rather_than_substituted(
        self, orpheus: Recorder, tmp_path: Path
    ) -> None:
        with pytest.raises(UnknownVoice, match="narrator"):
            spoken(loaded(tmp_path), voice="narrator")


class TestSpeaking:
    def test_cues_reach_the_model_as_its_own_tags(self, orpheus: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), text="Well. [laugh] Fine. [sniff]")
        assert prompts(orpheus) == ["tara: Well. <laugh> Fine. <sniffle>"]

    def test_the_dials_reach_the_model(self, orpheus: Recorder, tmp_path: Path) -> None:
        spoken(loaded(tmp_path), params={"temperature": 0.9, "repetitionPenalty": 1.5})
        sampling = orpheus.llamas[-1].generations[0].sampling
        assert (sampling["temp"], sampling["top_p"], sampling["repeat_penalty"]) == (0.9, 0.8, 1.5)

    def test_every_frame_the_model_spoke_is_heard(self, orpheus: Recorder, tmp_path: Path) -> None:
        orpheus.frames = 9
        audio = spoken(loaded(tmp_path))
        assert len(audio) == 9 * SAMPLES_PER_FRAME * 2

    def test_audio_streams_as_frames_complete(self, orpheus: Recorder, tmp_path: Path) -> None:
        # Four frames make the first window, then one more piece per frame, then the tail.
        orpheus.frames = 9
        pieces = list(loaded(tmp_path).speak(SpeakRequest(text="a line")))
        assert len(pieces) == 1 + 5 + 1

    def test_long_text_is_several_generations_and_one_stream(self, orpheus: Recorder, tmp_path: Path) -> None:
        orpheus.frames = 5
        sentence = "This sentence is exactly as long as it needs to be for the test."
        audio = spoken(loaded(tmp_path), text=" ".join([sentence] * 8))
        generations = orpheus.llamas[-1].generations
        assert len(generations) > 1
        assert all(len(text) <= SEGMENT_CHARACTERS + len("tara: ") for text in prompts(orpheus))
        assert len(audio) == len(generations) * 5 * SAMPLES_PER_FRAME * 2

    def test_each_segment_gets_its_own_seed_from_the_requests(
        self, orpheus: Recorder, tmp_path: Path
    ) -> None:
        sentence = "This sentence is exactly as long as it needs to be for the test."
        spoken(loaded(tmp_path), text=" ".join([sentence] * 8), seed=100)
        seeds = [generation.seed for generation in orpheus.llamas[-1].generations]
        assert seeds == list(range(100, 100 + len(seeds)))

    def test_a_seed_reproduces_the_audio(self, orpheus: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        assert spoken(built, seed=5) == spoken(built, seed=5)
        assert spoken(built, seed=5) != spoken(built, seed=6)

    def test_a_segment_that_runs_out_of_tokens_is_logged(self, orpheus: Recorder, tmp_path: Path) -> None:
        orpheus.endless = True
        built = loaded(tmp_path)
        audio = spoken(built)
        assert len(audio) == (MAX_TOKENS // 7) * SAMPLES_PER_FRAME * 2
        assert [message for message, _ in built.log.warnings] == ["a segment ran out of tokens"]  # type: ignore[attr-defined]

    def test_a_segment_that_finishes_is_not_logged(self, orpheus: Recorder, tmp_path: Path) -> None:
        built = loaded(tmp_path)
        spoken(built)
        assert built.log.warnings == []  # type: ignore[attr-defined]
