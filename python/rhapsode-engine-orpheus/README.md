# rhapsode-engine-orpheus

Orpheus as a rhapsode engine.

Orpheus is a Llama 3.2 3B finetuned by Canopy Labs to emit SNAC audio codes instead of text. Its
tags perform seven of the eight standard cues, which makes it the second engine here that can laugh,
and it generates token by token, so it streams audio as it goes, not by chunking a finished waveform.

Not yet servable: this package holds the adapter's pure logic (prompt, cue tags, SNAC framing and
what each variant claims), and the engine class arrives with its first backend.
