"""Turning an engine's native PCM into what the client asked for. protocol.md § 8.

Without this every adapter reimplements format conversion and they all do it differently, which is
the single largest reduction in adapter burden in the design.

Two formats never touch ffmpeg. `pcm` is already what the engine yields. `wav` is a 44-byte header
followed by exactly those bytes, and writing it here is not an optimisation: it is the only way to
control precisely how the header is wrong when the length is not yet known.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

#: What goes in a streaming WAV's two size fields. A streaming WAV header cannot be correct, so the
#: choice is which way to be wrong: an unknown-length marker that readers treat as unbounded, or a
#: zero that says "no samples" and stops a strict reader dead.
UNKNOWN_SIZE = 0xFFFFFFFF

WAV_HEADER_BYTES = 44


@dataclass(frozen=True)
class Encoded:
    """A format the SDK can produce, and the Content-Type that describes it."""

    name: str
    content_type: str
    needs_ffmpeg: bool


FORMATS: dict[str, Encoded] = {
    "pcm": Encoded("pcm", "audio/L16", needs_ffmpeg=False),
    "wav": Encoded("wav", "audio/wav", needs_ffmpeg=False),
    "mp3": Encoded("mp3", "audio/mpeg", needs_ffmpeg=True),
    # Strictly this is Ogg-encapsulated Opus, for which `audio/ogg; codecs=opus` is the precise
    # label. The contract says `audio/opus`, every client in this space sends and accepts it, and
    # the response's own Content-Type is authoritative in any case. protocol.md § 6.
    "opus": Encoded("opus", "audio/opus", needs_ffmpeg=True),
    "flac": Encoded("flac", "audio/flac", needs_ffmpeg=True),
}


def content_type_for(name: str, sample_rate: int, channels: int) -> str:
    """The Content-Type for a format, with the parameters raw PCM cannot do without."""
    encoded = FORMATS[name]
    if encoded.name != "pcm":
        return encoded.content_type
    # Raw PCM with no rate and no channel count is not playable by anything, so the parameters are
    # not decoration: they are the only description the bytes get.
    return f"audio/L16; rate={sample_rate}; channels={channels}"


def wav_header(sample_rate: int, channels: int, data_bytes: int | None = None) -> bytes:
    """A canonical 44-byte PCM WAV header.

    `data_bytes` is the exact payload length when it is known, which is the `stream: false` case,
    and None while streaming. The two differ only in the two size fields.
    """
    bits = 16
    block_align = channels * bits // 8
    byte_rate = sample_rate * block_align
    payload = UNKNOWN_SIZE if data_bytes is None else data_bytes
    riff = UNKNOWN_SIZE if data_bytes is None else data_bytes + WAV_HEADER_BYTES - 8

    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        riff,
        b"WAVE",
        b"fmt ",
        16,  # PCM fmt chunk length
        1,  # PCM
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits,
        b"data",
        payload,
    )


def available_formats() -> list[str]:
    """What this worker can actually produce, here and now.

    Only ever the two the SDK frames itself, until the ffmpeg pipeline exists. A worker that
    advertised `opus` and then could not produce it would be exactly the dishonesty the capability
    document is for.
    """
    return [name for name, encoded in FORMATS.items() if not encoded.needs_ffmpeg]


def why_unavailable(name: str) -> str:
    """Why a declared format is missing, in words an operator can act on."""
    if name not in FORMATS:
        return f"no such format; this contract has {sorted(FORMATS)}"
    if FORMATS[name].needs_ffmpeg:
        return "this build of the SDK has no encoder for it yet"
    return "available"
