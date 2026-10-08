"""What turns phonemes and a style into a waveform: the one place torch and upstream's code are touched.

Upstream's code is the tree `upstream.py` fetched, put on the import path before anything here
imports it. The inference is upstream's own `Demo/Inference_LibriTTS.ipynb`, which is the only
inference upstream publishes: the same phonemizer settings, the same sampler, the same style mixing
and the same 50 samples trimmed from the end. With the same seed on the CPU its audio is bit for
bit the notebook's.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import re
from collections.abc import Iterator
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from rhapsode_worker import Internal

from . import upstream
from .builds import CHECKPOINT, CONFIG, SAMPLE_RATE, SHA256

#: The most phoneme tokens one generation takes, the leading pad included: PL-BERT's position
#: embeddings stop at 512, and past them upstream fails with "The expanded size of the tensor (589)
#: must match the existing size (512)". A 400-character English sentence measured 473 tokens and a
#: 500-character one 589, about 1.18 to a character, but figures spell out far longer: `$1,234,567.89`
#: is 13 characters and 100 tokens.
TOKEN_LIMIT = 512

#: eSpeak NG exits the whole process, with no exception for Python to catch, when its data directory's
#: path is longer than this. Measured by the Kokoro adapter with espeakng-loader 0.2.4: 159 works, 160
#: does not, which a virtualenv under a long home directory can reach.
ESPEAK_PATH_LIMIT = 159

#: Upstream trims this many samples from every generation for "a weird pulse at the end of the
#: model". 2 ms at 24 kHz.
TRAILING_PULSE = 50


@dataclass(frozen=True)
class Dials:
    alpha: float
    beta: float
    diffusion_steps: int
    embedding_scale: float


class Synthesiser(Protocol):
    def tokens(self, text: str) -> list[int]:
        """The text as the model reads it: eSpeak's phonemes, as indices, after the pad."""
        ...

    def style(self, clip: Path) -> Any:
        """A clip's style vector: its timbre and its prosody, 256 numbers."""
        ...

    def synthesise(self, tokens: list[int], style: Any, dials: Dials, seed: int | None) -> np.ndarray:
        """Float audio at 24 kHz for one generation's tokens."""
        ...


class UpstreamStyleTTS2:
    """StyleTTS 2 as upstream's demo runs it.

    The imports are here rather than at module scope so the adapter is importable, and testable,
    without torch or upstream's tree.
    """

    def __init__(self, source: Path, weights: Path, device: str) -> None:
        upstream.activate(source)
        for name, expected in SHA256.items():
            verify(weights / name, expected)

        import phonemizer
        import torch
        import torchaudio
        import yaml
        from models import build_model, load_ASR_models, load_F0_models
        from Modules.diffusion.sampler import ADPM2Sampler, DiffusionSampler, KarrasSchedule
        from munch import Munch
        from phonemizer.backend.espeak.wrapper import EspeakWrapper
        from text_utils import TextCleaner
        from Utils.PLBERT.util import load_plbert

        self._torch = torch
        self._device = device

        library, data = espeak_paths()
        EspeakWrapper.set_library(library)
        EspeakWrapper.set_data_path(data)
        self._phonemizer = phonemizer.backend.EspeakBackend(
            language="en-us", preserve_punctuation=True, with_stress=True
        )
        # Upstream's cleaner prints the size of its vocabulary when it is made, and every text with a
        # symbol it has no index for when it is called. A worker's stdout is where its handshake went
        # (protocol.md § 2), so neither is let through to it.
        with contextlib.redirect_stdout(io.StringIO()):
            self._cleaner = TextCleaner()

        def munch(value: Any) -> Any:
            if isinstance(value, dict):
                return Munch((key, munch(item)) for key, item in value.items())
            if isinstance(value, list):
                return [munch(item) for item in value]
            return value

        config = yaml.safe_load((weights / CONFIG).read_text())
        self._params = munch(config["model_params"])
        with trusted_loads(torch):
            model = build_model(
                self._params,
                load_ASR_models(str(source / config["ASR_path"]), str(source / config["ASR_config"])),
                load_F0_models(str(source / config["F0_path"])),
                load_plbert(str(source / config["PLBERT_dir"])),
            )
            state = torch.load(str(weights / CHECKPOINT), map_location="cpu")["net"]
        for key in model:
            if key not in state:
                continue
            try:
                model[key].load_state_dict(state[key])
            except RuntimeError:
                # Saved from DataParallel, so every key carries `module.`. Upstream's demo does the same.
                model[key].load_state_dict(
                    {name[7:]: value for name, value in state[key].items()}, strict=False
                )
        for key in model:
            model[key].eval().to(device)
        self._model = model
        self._sampler = DiffusionSampler(
            model.diffusion.diffusion,
            sampler=ADPM2Sampler(),
            sigma_schedule=KarrasSchedule(sigma_min=0.0001, sigma_max=3.0, rho=9.0),
            clamp=False,
        )
        self._mel = torchaudio.transforms.MelSpectrogram(
            n_mels=80, n_fft=2048, win_length=1200, hop_length=300
        )

    def tokens(self, text: str) -> list[int]:
        phonemes = self._phonemizer.phonemize([text.strip()])[0]
        # Upstream joins NLTK's word_tokenize with spaces. On eSpeak's output that is words and
        # punctuation apart, which this does without NLTK and its separately downloaded data: the
        # token ids were identical on upstream's demo sentence.
        spaced = " ".join(re.findall(r"\w+|[^\w\s]", phonemes))
        with contextlib.redirect_stdout(io.StringIO()):
            return [0, *self._cleaner(spaced)]

    def style(self, clip: Path) -> Any:
        import librosa

        torch = self._torch
        audio, _ = librosa.load(str(clip), sr=SAMPLE_RATE)
        audio, _ = librosa.effects.trim(audio, top_db=30)
        mel = (torch.log(1e-5 + self._mel(torch.from_numpy(audio).float()).unsqueeze(0)) + 4) / 4
        mel = mel.to(self._device).unsqueeze(1)
        with torch.no_grad():
            return torch.cat([self._model.style_encoder(mel), self._model.predictor_encoder(mel)], dim=1)

    def synthesise(self, tokens: list[int], style: Any, dials: Dials, seed: int | None) -> np.ndarray:
        torch, model, device = self._torch, self._model, self._device
        if seed is not None:
            torch.manual_seed(seed)
        with torch.no_grad():
            ids = torch.LongTensor(tokens).to(device).unsqueeze(0)
            lengths = torch.LongTensor([ids.shape[-1]]).to(device)
            mask = (torch.arange(ids.shape[-1]).unsqueeze(0).to(device) + 1) > lengths.unsqueeze(1)

            text = model.text_encoder(ids, lengths, mask)
            bert = model.bert(ids, attention_mask=(~mask).int())
            duration_encoding = model.bert_encoder(bert).transpose(-1, -2)

            predicted = self._sampler(
                noise=torch.randn((1, 256)).unsqueeze(1).to(device),
                embedding=bert,
                embedding_scale=dials.embedding_scale,
                features=style,
                num_steps=dials.diffusion_steps,
            ).squeeze(1)
            timbre = dials.alpha * predicted[:, :128] + (1 - dials.alpha) * style[:, :128]
            prosody = dials.beta * predicted[:, 128:] + (1 - dials.beta) * style[:, 128:]

            encoded = model.predictor.text_encoder(duration_encoding, prosody, lengths, mask)
            hidden, _ = model.predictor.lstm(encoded)
            durations = torch.sigmoid(model.predictor.duration_proj(hidden)).sum(axis=-1)
            frames = torch.round(durations.squeeze(0)).clamp(min=1).long().cpu()
            alignment = torch.repeat_interleave(torch.eye(len(tokens)), frames, dim=1).unsqueeze(0).to(device)

            prosody_frames = shifted(encoded.transpose(-1, -2) @ alignment, self._params.decoder.type)
            pitch, energy = model.predictor.F0Ntrain(prosody_frames, prosody)
            text_frames = shifted(text @ alignment, self._params.decoder.type)
            audio = model.decoder(text_frames, pitch, energy, timbre.squeeze().unsqueeze(0))
        return np.asarray(audio.squeeze().cpu().numpy())[..., :-TRAILING_PULSE]


def shifted(frames: Any, decoder: str) -> Any:
    """Each frame moved one later, the first repeated: the HiFi-GAN decoder was trained on that."""
    if decoder != "hifigan":
        return frames
    import torch

    return torch.cat([frames[:, :, :1], frames[:, :, :-1]], dim=2)


def verify(path: Path, expected: str) -> None:
    """Refuse a weights file whose bytes are not the pinned ones, before anything unpickles it."""
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(partial(file.read, 1 << 20), b""):
            digest.update(block)
    if digest.hexdigest() != expected:
        raise Internal(f"{path.name} has SHA-256 {digest.hexdigest()}; expected {expected}")


@contextlib.contextmanager
def trusted_loads(torch: Any) -> Iterator[None]:
    """`torch.load` as it was before 2.6, for upstream's loaders, which call it without saying.

    Only around files whose bytes are pinned: the tree by `upstream.TREE_DIGEST` and the weights by
    `SHA256`. Upstream's checkpoints pickle `getattr` and a `OneCycleLR`, which the safe loader
    refuses.
    """
    original = torch.load
    torch.load = partial(original, weights_only=False)
    try:
        yield
    finally:
        torch.load = original


def espeak_paths() -> tuple[str, str]:
    """espeakng-loader's eSpeak NG, refused here if eSpeak would exit the process over its data path."""
    import espeakng_loader

    data = str(espeakng_loader.get_data_path())
    if len(data) > ESPEAK_PATH_LIMIT:
        raise Internal(
            f"eSpeak NG's data is at a path {len(data)} characters long and eSpeak exits the process "
            f"above {ESPEAK_PATH_LIMIT}: {data}. Install this engine's virtualenv somewhere shorter "
            "(install.venvDir)."
        )
    return str(espeakng_loader.get_library_path()), data
