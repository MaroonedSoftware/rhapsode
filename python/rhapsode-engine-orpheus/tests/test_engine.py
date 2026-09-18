"""The adapter's own decisions: which build, which voice, what sampling, and what comes back."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest
from harness.stubs import Recorder
from rhapsode_worker import Log, SpeakRequest, UnknownVoice, Unsupported
from rhapsode_worker.engine import Device

from rhapsode_engine_orpheus.builds import (
    FULL_FILES,
    FULL_REPOSITORY,
    FULL_REVISION,
    GGUF_FILES,
    GGUF_REPOSITORY,
    GGUF_REVISION,
    SNAC_REPOSITORY,
    SNAC_REVISION,
    VOICES,
)
from rhapsode_engine_orpheus.codes import SAMPLES_PER_FRAME
from rhapsode_engine_orpheus.engine import OrpheusEngine, memory_fraction
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

    def test_a_mac_runs_both_on_metal(self, orpheus: Recorder, tmp_path: Path) -> None:
        # The codec on the CPU took 102 ms a window against 85 ms of audio, on MPS 7.8 ms.
        import snac

        loaded(tmp_path, device="mps")
        assert orpheus.llamas[-1].options["n_gpu_layers"] == -1
        assert snac.codec.device == "mps"  # type: ignore[attr-defined]

    def test_a_box_with_no_accelerator_runs_both_on_the_cpu(self, orpheus: Recorder, tmp_path: Path) -> None:
        import snac

        loaded(tmp_path, device="cpu")
        assert orpheus.llamas[-1].options["n_gpu_layers"] == 0
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
        # Two things had to be pinned for this, and on the real weights neither was: llama.cpp's
        # prompt cache (see the backend) and SNAC's decoder, which adds noise from torch's generator.
        built = loaded(tmp_path)
        assert spoken(built, seed=5) == spoken(built, seed=5)
        assert spoken(built, seed=5) != spoken(built, seed=6)

    def test_each_window_of_a_seeded_request_seeds_the_codec_differently(
        self, orpheus: Recorder, tmp_path: Path
    ) -> None:
        # One seed for every window would lay the same noise down every 85 ms, a buzz at 11.7 Hz.
        import snac

        orpheus.frames = 9
        spoken(loaded(tmp_path), seed=5)
        seeds = snac.codec.seeds  # type: ignore[attr-defined]
        assert None not in seeds
        assert len(set(seeds)) == len(seeds) > 1

    def test_an_unseeded_request_leaves_the_codec_its_own_noise(
        self, orpheus: Recorder, tmp_path: Path
    ) -> None:
        import snac

        spoken(loaded(tmp_path))
        assert set(snac.codec.seeds) == {None}  # type: ignore[attr-defined]

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


class TestFetching:
    def test_fetch_downloads_the_build_and_the_codec_at_their_revisions(
        self, orpheus: Recorder, tmp_path: Path
    ) -> None:
        engine(tmp_path).fetch("q4")
        fetched = {
            (download["repo_id"], download["filename"], download["revision"])
            for download in orpheus.downloads
        }
        assert fetched == {
            (GGUF_REPOSITORY, GGUF_FILES["q4"], GGUF_REVISION),
            (SNAC_REPOSITORY, "config.json", SNAC_REVISION),
            (SNAC_REPOSITORY, "pytorch_model.bin", SNAC_REVISION),
        }

    def test_fetch_loads_nothing(self, orpheus: Recorder, tmp_path: Path) -> None:
        engine(tmp_path).fetch("q8")
        assert orpheus.llamas == []

    def test_fetch_refuses_a_build_this_engine_does_not_have(self, orpheus: Recorder, tmp_path: Path) -> None:
        with pytest.raises(Unsupported, match="no build"):
            engine(tmp_path).fetch("q2")


class TestFull:
    """The `full` build, which exists only where vLLM can run it."""

    def test_declared_on_a_cuda_card_with_vllm(self, orpheus: Recorder, tmp_path: Path) -> None:
        assert "full" in engine(tmp_path, "cuda").variants()

    def test_not_declared_on_a_mac(self, orpheus: Recorder, tmp_path: Path) -> None:
        assert "full" not in engine(tmp_path, "mps").variants()

    def test_not_declared_without_vllm(
        self, orpheus: Recorder, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delitem(sys.modules, "vllm")
        assert "full" not in engine(tmp_path, "cuda").variants()

    def test_loading_it_where_it_is_not_declared_says_what_it_needs(
        self, orpheus: Recorder, tmp_path: Path
    ) -> None:
        with pytest.raises(Unsupported, match=r"CUDA card.*\[vllm\]"):
            engine(tmp_path, "mps").load("full")

    def test_it_claims_what_the_ggufs_claim(self, orpheus: Recorder, tmp_path: Path) -> None:
        declared = engine(tmp_path, "cuda").variants()
        assert declared["full"] == declared["q8"]

    def test_it_loads_canopys_weights_file_by_file_and_never_the_training_state(
        self, orpheus: Recorder, tmp_path: Path
    ) -> None:
        loaded(tmp_path, "full", device="cuda")
        fetched = [download for download in orpheus.downloads if download.get("repo_id") == FULL_REPOSITORY]
        assert [download["filename"] for download in fetched] == list(FULL_FILES)
        assert {download["revision"] for download in fetched} == {FULL_REVISION}
        assert not any("optimizer" in name or "fsdp" in name for name in FULL_FILES)
        assert orpheus.vllms[0].arguments.options["model"] == "/models"

    def test_it_speaks(self, orpheus: Recorder, tmp_path: Path) -> None:
        orpheus.frames = 6
        audio = spoken(loaded(tmp_path, "full", device="cuda"), text="Hi. [laugh]")
        assert len(audio) == 6 * SAMPLES_PER_FRAME * 2
        assert orpheus.llamas == []

    def test_a_gated_refusal_says_how_to_get_in(
        self, orpheus: Recorder, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import huggingface_hub
        from harness.stubs import GatedRepoError

        def refuse(**arguments: Any) -> str:
            raise GatedRepoError("401")

        monkeypatch.setattr(huggingface_hub, "hf_hub_download", refuse)
        with pytest.raises(Unsupported, match=r"gated.*HF_TOKEN"):
            engine(tmp_path, "cuda").fetch("full")


class TestMemoryFraction:
    def test_the_budget_over_the_card(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("RHAPSODE_ORPHEUS_GPU_MEMORY", raising=False)
        assert memory_fraction(Device("cuda", "4090", vram_bytes=24 * 2**30)) == round(10 / 24, 3)

    def test_never_more_than_vllms_own_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("RHAPSODE_ORPHEUS_GPU_MEMORY", raising=False)
        assert memory_fraction(Device("cuda", "small", vram_bytes=8 * 2**30)) == 0.9
        assert memory_fraction(Device("cuda", "unknown")) == 0.9

    def test_the_operator_overrides_it(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RHAPSODE_ORPHEUS_GPU_MEMORY", "0.55")
        assert memory_fraction(Device("cuda", "4090", vram_bytes=24 * 2**30)) == 0.55
