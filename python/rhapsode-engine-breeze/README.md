# rhapsode-engine-breeze

Breeze TTS 2 as a rhapsode engine.

Breeze TTS 2 is BreezeBlue's 3B model, released in August 2026, and the highest-ranked open-weight
model on the Artificial Analysis speech arena, ahead of ElevenLabs' Eleven v3. It speaks English and
Chinese, clones from a clip and its exact transcript, and needs a CUDA card: about 7.7 GiB for
eager inference, so 12 GB is upstream's minimum. There is no Apple Silicon path.

**The weights are for research and non-commercial use only**, and so is what you make with them on
your own hardware. The inference code is Apache-2.0; the BreezeBlue Research and Non-Commercial
License governs the weights, derivative models and self-hosted outputs. An install has to accept it
by name (protocol.md § 10).

This package so far holds what can be decided without the model: which cues it claims and how each is
spelled in each language, the model's own syntax removed from anything a client wrote, and how text
is cut into pieces.
