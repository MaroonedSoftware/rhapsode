"""The class an adapter author subclasses. protocol.md § 8.

An adapter writes one class and never learns what the core is written in. Everything the SDK can
derive it derives, so that the list of things an adapter must get right by hand stays exactly one
item long: claim only what the loaded variant can actually perform.
"""

from __future__ import annotations

import platform
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar

from .errors import BadRequest, UnknownVoice, Unsupported

DEFAULT_MAX_CHARACTERS = 4096


@dataclass(frozen=True)
class NativeFormat:
    """What `speak()` yields. The SDK encodes from here to everything else."""

    encoding: str = "pcm_s16le"
    sample_rate: int = 24_000
    channels: int = 1

    def __post_init__(self) -> None:
        if self.encoding != "pcm_s16le":
            raise ValueError(f"contract 1 accepts pcm_s16le and nothing else, not {self.encoding!r}")


@dataclass(frozen=True)
class Variant:
    """What one build of an engine can perform.

    Claiming a cue you cannot perform is the only way to break the guarantee that an engine never
    reads the word "laugh" out loud, which makes it the one thing nothing else can check for you.
    """

    cues: tuple[str, ...] = ()
    deliveries: tuple[str, ...] = ()
    #: name -> (min, max, default)
    dials: dict[str, tuple[float, float, float]] = field(default_factory=dict)
    languages: tuple[str, ...] = ("en",)
    max_characters: int | None = None

    def document(self) -> dict[str, Any]:
        return {
            "cues": list(self.cues),
            "deliveries": list(self.deliveries),
            "dials": {
                name: {"min": low, "max": high, "default": default}
                for name, (low, high, default) in self.dials.items()
            },
            "languages": list(self.languages),
            **({} if self.max_characters is None else {"maxCharacters": self.max_characters}),
        }


@dataclass(frozen=True)
class Voice:
    id: str
    label: str
    #: Opaque, and changes whenever the rendering would. Clients key cached previews on it, which
    #: only works because the engine mints it: an id is exactly the part that does NOT change when
    #: somebody edits what is under it.
    spec: str
    description: str | None = None
    tags: tuple[str, ...] = ()

    def document(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "spec": self.spec,
            **({} if self.description is None else {"description": self.description}),
            **({} if not self.tags else {"tags": list(self.tags)}),
            "previewUrl": f"/voices/{self.id}/preview",
        }


@dataclass(frozen=True)
class SpeakRequest:
    """A request the SDK has already validated against what this variant claims."""

    text: str
    voice: str | None = None
    variant: str | None = None
    format: str = "wav"
    delivery: str | None = None
    params: dict[str, float] = field(default_factory=dict)
    seed: int | None = None
    stream: bool = True


@dataclass(frozen=True)
class CreateVoiceRequest:
    id: str
    reference: bytes
    label: str | None = None
    filename: str | None = None


@dataclass(frozen=True)
class Device:
    type: str
    name: str
    vram_bytes: int | None = None

    def document(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "name": self.name,
            **({} if self.vram_bytes is None else {"vramBytes": self.vram_bytes}),
        }


def detect_device() -> Device:
    """Best effort, and torch is optional.

    An ONNX or pure-CPU adapter has no torch and must still install this SDK, so the import is
    inside a try and a failure is a cpu answer rather than an error.
    """
    try:  # pragma: no cover - depends on what the adapter's venv happens to hold
        import torch

        if torch.cuda.is_available():
            index = torch.cuda.current_device()
            properties = torch.cuda.get_device_properties(index)
            kind = "rocm" if getattr(torch.version, "hip", None) else "cuda"
            return Device(type=kind, name=properties.name, vram_bytes=properties.total_memory)
        if torch.backends.mps.is_available():
            return Device(type="mps", name=platform.processor() or "Apple Silicon")
    except Exception:
        pass

    return Device(type="cpu", name=platform.processor() or platform.machine() or "cpu")


class Engine:
    """Subclass this.

    Everything below with a default is optional. `variants`, `load`, `unload`, `voices` and `speak`
    are not.
    """

    id: str = ""
    display_name: str = ""
    license: ClassVar[dict[str, Any]] = {}
    native_format: NativeFormat = NativeFormat()
    #: One model, one utterance at a time is the correct default for a GPU. An engine that can
    #: genuinely batch raises this and takes responsibility for what happens.
    concurrency: int = 1
    max_characters: int = DEFAULT_MAX_CHARACTERS
    adapter_version: str = "0.0.0"
    upstream_version: str | None = None
    default_variant: str | None = None

    # Filled in by the SDK before anything else runs.
    device: Device
    voice_dir: Path
    log: Any
    variant: str | None = None

    # ---------------------------------------------------------------- the five an adapter writes

    def variants(self) -> dict[str, Variant]:
        raise NotImplementedError

    def load(self, variant: str) -> None:
        raise NotImplementedError

    def unload(self) -> None:
        raise NotImplementedError

    def voices(self) -> list[Voice]:
        raise NotImplementedError

    def speak(self, request: SpeakRequest) -> Iterator[bytes]:
        raise NotImplementedError

    # ---------------------------------------------------------------- optional, and derived from

    def create_voice(self, request: CreateVoiceRequest) -> Voice:
        raise Unsupported("this engine does not clone voices")

    def delete_voice(self, voice_id: str) -> None:
        raise Unsupported("this engine does not clone voices")

    def preview(self, voice_id: str) -> Iterator[bytes]:
        """A fixed line in the named voice, so `previewUrl` works for every engine for free."""
        return self.speak(SpeakRequest(text=PREVIEW_TEXT, voice=voice_id, format="wav", stream=False))

    @property
    def supports_cloning(self) -> bool:
        """Derived, so an adapter cannot advertise cloning it did not implement, or the reverse."""
        return type(self).create_voice is not Engine.create_voice

    def reference_seconds(self) -> tuple[float, float] | None:
        """Usable reference audio, when this engine clones. Override alongside `create_voice`."""
        return (5.0, 10.0) if self.supports_cloning else None

    # ---------------------------------------------------------------- what the SDK provides

    def apply_delivery(self, delivery: str | None, dials: dict[str, float]) -> dict[str, float]:
        """Turn a word into numbers, relative to the voice rather than to a fixed point.

        The SDK cannot do this: it does not know the voice's character. An adapter that hard-codes
        `exaggeration = 0.2` for hushed has thrown away whatever made that voice itself, and a voice
        that is intense at rest should still be more intense than its neighbours when hushed.

        The default is identity, which is the honest answer for an engine that declares no
        deliveries. An engine that declares any must override this.
        """
        return dials

    def dials_for(self, request: SpeakRequest) -> dict[str, float]:
        """Declared defaults, overlaid with the request's validated params, then the delivery hook."""
        variant = self.variants()[self.effective_variant(request.variant)]
        dials = {name: default for name, (_, _, default) in variant.dials.items()}
        dials.update(request.params)
        return self.apply_delivery(request.delivery, dials)

    def effective_variant(self, requested: str | None) -> str:
        """What the request is actually about. protocol.md § 4, as amended.

        The request's own choice, then whatever is loaded, then the engine's default. Total, which
        `current` is not: `current` is absent while nothing is resident.
        """
        declared = self.variants()

        # A variant the request named and this engine does not have is refused, and the order
        # matters: falling through to the default would produce audio the caller did not ask for
        # and has no way to notice, which is the same silent discard the whole document argues
        # against. Only an ABSENT variant falls back.
        if requested is not None:
            if requested not in declared:
                raise Unsupported(f'no variant "{requested}"; this engine has {sorted(declared)}')
            return requested

        for candidate in (self.variant, self.default_variant):
            if candidate is not None and candidate in declared:
                return candidate
        return next(iter(declared))

    def path_for(self, voice: str | None) -> Path:
        """Resolve a voice id to a file, with the traversal check in one place rather than in each adapter."""
        if voice is None:
            raise UnknownVoice("this request named no voice and this engine has no default")
        if "/" in voice or "\\" in voice or voice in {".", ".."}:
            raise BadRequest(f'voice id "{voice}" is not a name')

        root = self.voice_dir.resolve()
        for candidate in sorted(root.glob(f"{voice}.*")) if root.is_dir() else []:
            resolved = candidate.resolve()
            if resolved.is_relative_to(root):
                return resolved
        raise UnknownVoice(f'no voice "{voice}"')


#: What `preview()` says. Short enough to synthesise quickly, long enough to hear a voice in.
PREVIEW_TEXT = "The quick brown fox jumps over the lazy dog."
