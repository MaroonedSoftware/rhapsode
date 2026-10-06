"""A cloned voice: a reference clip at the codec's rate, and the exact words spoken in it.

Upstream clones from both: the transcript and the clip's codes open the conversation every piece of a
request continues. A voice is both halves and neither is any use alone. On disk that is `<id>.wav`,
mono at 44.1 kHz, beside `<id>.json` holding the label and the transcript.
"""

from __future__ import annotations

import hashlib
import io
import json
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from rhapsode_worker import BadRequest, CreateVoiceRequest, Unsupported

#: What to clone from. Upstream names no length, so this is the range every other engine here asks
#: for until real weights say otherwise.
REFERENCE_SECONDS = (5.0, 10.0)

#: The longest clip taken. The clip opens every request's conversation at 21.5 codec frames a second,
#: so its length comes out of the room the request's own text has in `backends.CONTEXT`: 20 s is 430
#: frames, which still leaves the longest request room. Longer is refused rather than trimmed, because
#: a trimmed clip no longer matches its transcript, which clones worse without any error.
LONGEST_SECONDS = 20.0

#: The codec's rate. Upstream resamples whatever it is given; storing at this rate means it never has to.
SAMPLE_RATE = 44_100

#: What soundfile reads. MP3 needs libsndfile 1.1 or later, which its wheels have carried since 2022.
SUFFIXES = (".wav", ".mp3", ".flac", ".ogg")


@dataclass(frozen=True)
class Stored:
    clip: Path
    transcript: str
    label: str


def store(voice_dir: Path, request: CreateVoiceRequest) -> Path:
    """Decode, check and keep a reference. Returns the clip's path."""
    if request.transcript is None:
        raise BadRequest(
            "`transcript` is required: Fish clones from the clip and the exact words spoken in it"
        )
    suffix = Path(request.filename or "reference.wav").suffix.lower()
    if suffix not in SUFFIXES:
        raise Unsupported(f'reference audio must be one of {", ".join(SUFFIXES)}, not "{suffix}"')
    if not request.reference:
        raise BadRequest("the reference audio is empty")

    audio = _decoded(request.reference)
    seconds = audio.size / SAMPLE_RATE
    if seconds > LONGEST_SECONDS:
        raise BadRequest(
            f"the reference is {seconds:.1f} s; Fish takes at most {LONGEST_SECONDS:g} s, and "
            f"{REFERENCE_SECONDS[0]:g} to {REFERENCE_SECONDS[1]:g} s clones best"
        )

    voice_dir.mkdir(parents=True, exist_ok=True)
    clip = voice_dir / f"{request.id}.wav"
    clip.write_bytes(wav(audio))
    label = request.label or request.id.replace("_", " ").title()
    (voice_dir / f"{request.id}.json").write_text(
        json.dumps({"label": label, "transcript": request.transcript})
    )
    return clip


def load(clip: Path) -> Stored:
    details = json.loads(clip.with_suffix(".json").read_text())
    return Stored(clip=clip, transcript=details["transcript"], label=details["label"])


def clips(voice_dir: Path) -> list[Path]:
    """Every stored voice, which is every clip with its words beside it."""
    if not voice_dir.is_dir():
        return []
    return sorted(
        path for path in voice_dir.glob("*.wav") if path.is_file() and path.with_suffix(".json").is_file()
    )


def remove(clip: Path) -> None:
    clip.unlink()
    clip.with_suffix(".json").unlink(missing_ok=True)


def digest(clip: Path) -> str:
    """Changes when what the voice sounds like would: the clip, or the words it is told were said."""
    return hashlib.sha256(clip.read_bytes() + clip.with_suffix(".json").read_bytes()).hexdigest()[:12]


def wav(audio: np.ndarray) -> bytes:
    """Mono 16-bit WAV at the codec's rate, as bytes, which is what upstream's reference takes."""
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(pcm.tobytes())
    return buffer.getvalue()


def _decoded(data: bytes) -> np.ndarray:
    """Mono float32 at the codec's rate. The import is here so the adapter loads without soundfile."""
    import soundfile

    try:
        audio, rate = soundfile.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except Exception as error:
        raise BadRequest(f"the reference audio could not be read: {error}") from error
    mono = np.asarray(audio, dtype=np.float32).mean(axis=1)
    return _resampled(mono, int(rate))


def _resampled(audio: np.ndarray, rate: int) -> np.ndarray:
    """Linear interpolation to 44.1 kHz, once, when the voice is made. A reference is heard for its
    voice rather than its fidelity, and interpolating from 48 kHz folds nothing audible into a speaking
    voice, whose energy is far below the fold."""
    if rate == SAMPLE_RATE or audio.size == 0:
        return audio
    length = round(audio.size * SAMPLE_RATE / rate)
    positions = np.arange(length) * (rate / SAMPLE_RATE)
    return np.asarray(np.interp(positions, np.arange(audio.size), audio), dtype=np.float32)
