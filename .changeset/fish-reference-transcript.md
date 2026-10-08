---
---

Fish now speaks a cloned voice with the transcript it was last given. Re-creating a voice from the same audio with its words corrected used to keep the old words until the model unloaded, and two voices cloned from one clip both spoke the first one's words, because upstream's cache kept the transcript beside the encoded clip and keyed both on the audio alone. The adapter now keeps the encoded clip in the SDK's `ReferenceCache` and reads the transcript on every request. A cloned voice's later requests still skip the encoding, which took 1.9 s of a 13.2 s first request on an M5 Pro.
