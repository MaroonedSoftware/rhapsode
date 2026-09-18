"""Turning an engine's native PCM into what the client asked for. protocol.md § 8.

Without this every adapter reimplements format conversion and they all do it differently, which is
the single largest reduction in adapter burden in the design.

Two formats never touch ffmpeg. `pcm` is already what the engine yields. `wav` is a 44-byte header
followed by exactly those bytes, and writing it here is not an optimisation: it is the only way to
control precisely how the header is wrong when the length is not yet known.
"""

from __future__ import annotations

import asyncio
import functools
import os
import shutil
import struct
from collections.abc import AsyncIterator
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


@dataclass(frozen=True)
class Ffmpeg:
    """What this machine's ffmpeg is, and what it can actually do."""

    path: str | None
    encoders: frozenset[str]
    reason: str | None = None


#: Which ffmpeg encoder each format needs. Checking the binary alone is not enough: distribution
#: builds routinely ship without libopus, and finding that out on the first /speak instead of at
#: startup is precisely the failure this check exists to prevent.
REQUIRED_ENCODER = {"mp3": "libmp3lame", "opus": "libopus", "flac": "flac"}

#: How many of ffmpeg's own diagnostics to keep. A nonzero exit with no explanation attached is a
#: bug report nobody can act on.
STDERR_TAIL_BYTES = 8192


@functools.lru_cache(maxsize=1)
def probe() -> Ffmpeg:
    """Look once, at startup, and remember.

    Re-probing per request would be waste; an operator who installs ffmpeg restarts the worker, and
    the capability document is the thing that tells them they need to.
    """
    import subprocess

    path = shutil.which(os.environ.get("RHAPSODE_FFMPEG", "ffmpeg"))
    if path is None:
        return Ffmpeg(path=None, encoders=frozenset(), reason="ffmpeg is not on PATH")

    try:
        listed = subprocess.run(
            [path, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:  # pragma: no cover - a broken binary
        return Ffmpeg(path=None, encoders=frozenset(), reason=f"ffmpeg would not run: {error}")

    found = {name for name in REQUIRED_ENCODER.values() if name in listed.stdout}
    return Ffmpeg(path=path, encoders=frozenset(found))


def available_formats() -> list[str]:
    """What this worker can actually produce, here and now.

    Never empty: pcm and wav are framed by the SDK itself, and a worker that can only do those is
    still a useful worker. Advertising a format we cannot produce would be exactly the dishonesty
    the capability document exists to prevent.
    """
    found = probe()
    return [
        name
        for name, encoded in FORMATS.items()
        if not encoded.needs_ffmpeg or REQUIRED_ENCODER[name] in found.encoders
    ]


def why_unavailable(name: str) -> str:
    """Why a format is missing, in words that say which fix to reach for."""
    if name not in FORMATS:
        return f"no such format; this contract has {sorted(FORMATS)}"
    if not FORMATS[name].needs_ffmpeg:
        return "available"

    found = probe()
    if found.path is None:
        return found.reason or "ffmpeg is not available"
    return f"this ffmpeg has no {REQUIRED_ENCODER[name]} encoder"


def argv_for(name: str, sample_rate: int, channels: int) -> list[str]:
    """The command line for one format.

    `-nostdin` matters: without it ffmpeg installs a terminal handler on fd 0, which interferes when
    a worker is run from a shell during adapter development.
    """
    found = probe()
    assert found.path is not None
    common = [
        found.path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "s16le",
        "-ar",
        str(sample_rate),
        "-ac",
        str(channels),
        "-i",
        "pipe:0",
    ]
    tail = {
        "mp3": ["-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "pipe:1"],
        # -f opus is the Ogg-Opus muxer, and Ogg is page-oriented, which is why it streams at all.
        "opus": [
            "-c:a",
            "libopus",
            "-b:a",
            "64k",
            "-vbr",
            "on",
            "-application",
            "audio",
            "-f",
            "opus",
            "pipe:1",
        ],
        # Streaming FLAC writes total_samples = 0 in STREAMINFO, which is legal and which decoders
        # handle. The buffered path cannot do better: ffmpeg still cannot seek back on a pipe. If it
        # ever matters the cure is a temporary file, not a cleverer pipe.
        "flac": ["-c:a", "flac", "-compression_level", "5", "-f", "flac", "pipe:1"],
    }[name]
    return common + tail


class EncodeFailed(RuntimeError):
    """The encoder exited nonzero, and this carries what it said about why."""

    def __init__(self, returncode: int, stderr: str) -> None:
        super().__init__(f"the encoder exited {returncode}: {stderr.strip() or 'no diagnostics'}")
        self.returncode = returncode
        self.stderr = stderr


async def encode(
    name: str,
    pcm: AsyncIterator[bytes],
    *,
    sample_rate: int,
    channels: int,
    length: int | None = None,
) -> AsyncIterator[bytes]:
    """Native PCM in, the requested format out.

    `length` is the exact payload size when it is known, which is the `stream: false` case and the
    only case where a WAV header can be correct.
    """
    if name == "pcm":
        async for chunk in pcm:
            yield chunk
        return

    if name == "wav":
        yield wav_header(sample_rate, channels, length)
        async for chunk in pcm:
            yield chunk
        return

    async for chunk in _through_ffmpeg(name, pcm, sample_rate=sample_rate, channels=channels):
        yield chunk


async def _through_ffmpeg(
    name: str,
    pcm: AsyncIterator[bytes],
    *,
    sample_rate: int,
    channels: int,
) -> AsyncIterator[bytes]:
    """Three tasks and no intermediate buffer.

    The reader is this generator, the feeder is a background task writing to stdin, and a third
    task drains stderr. That third one is not optional: ffmpeg blocks writing to a full stderr pipe,
    which is a second and quieter deadlock than the obvious stdout one.

    Backpressure then works end to end for nothing. A slow reader stalls `stdout.read`, ffmpeg's
    stdout pipe fills, ffmpeg stops reading stdin, the feeder's `drain()` blocks, and the engine
    thread blocks at its next yield.
    """
    process = await asyncio.create_subprocess_exec(
        *argv_for(name, sample_rate, channels),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert process.stdin is not None and process.stdout is not None and process.stderr is not None

    diagnostics = bytearray()

    async def drain_stderr() -> None:
        assert process.stderr is not None
        while True:
            block = await process.stderr.read(4096)
            if not block:
                return
            diagnostics.extend(block)
            del diagnostics[:-STDERR_TAIL_BYTES]

    # Both spellings, because asyncio does not normalise EPIPE: the same broken pipe arrives as
    # ConnectionResetError on one path and BrokenPipeError on another. Catching only one turns a
    # real encoder crash into an unhandled exception in the logs while the abort never fires.
    EPIPE = (BrokenPipeError, ConnectionResetError)

    async def feed() -> BaseException | None:
        """Returns what the ENGINE raised, and nothing else.

        A broken stdin pipe is not the error, it is a symptom: the encoder is gone, and the encoder
        knows why. Reporting EPIPE here would replace `the encoder exited 3: <diagnostics>` with
        `[Errno 32] Broken pipe`, which says nothing an operator can act on.
        """
        assert process.stdin is not None
        try:
            async for chunk in pcm:
                process.stdin.write(chunk)
                await process.stdin.drain()
        except EPIPE:
            return None
        except BaseException as error:
            return error
        finally:
            try:
                process.stdin.close()
                await process.stdin.wait_closed()
            except EPIPE:
                pass
        return None

    stderr_task = asyncio.create_task(drain_stderr())
    feeder = asyncio.create_task(feed())

    try:
        while True:
            block = await process.stdout.read(65536)
            if not block:
                break
            yield block

        # EOF on stdout is not success. An encoder that died halfway closes its stdout exactly like
        # one that finished, so the exit code is the only thing that tells them apart.
        returncode = await process.wait()
        await stderr_task
        upstream = await feeder
        if upstream is not None:
            raise upstream
        if returncode != 0:
            raise EncodeFailed(returncode, diagnostics.decode("utf-8", "replace"))
        # rc == 0 having stopped reading its input is an encoder that decided it was finished, and
        # everything it produced is already on the wire. That is a success, not a truncation.
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
        for task in (feeder, stderr_task):
            if not task.done():
                task.cancel()
