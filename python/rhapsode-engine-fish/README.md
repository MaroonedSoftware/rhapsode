# rhapsode-engine-fish

Fish Audio S2 Pro as a rhapsode engine.

S2 Pro is Fish Audio's dual-autoregressive model, released in March 2026: 4B parameters along time
and 400M across its codec's ten codebooks, trained on more than 10M hours in 80-odd languages. It is
the second-ranked open-weight model on the Artificial Analysis speech arena, and the most expressive:
its tags are free-form directions in brackets rather than a fixed list. Upstream recommends a 24 GB
card; community FP8 and INT4 builds exist for smaller ones, but none is what this package loads.

**The weights are for research and non-commercial use only**, under the Fish Audio Research License,
and so is upstream's `fish-speech` inference code. Commercial use needs a licence from Fish Audio. An
install has to accept it by name (protocol.md § 10).

This package so far holds what can be decided without the model: which cues it claims and how each is
spelled, every other bracket removed from anything a client wrote, the speaker framing, and how text
is cut into pieces.
