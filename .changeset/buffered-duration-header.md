---
---

`rhapsode-worker`: a `stream: false` answer to `/speak` carries `X-Rhapsode-Duration-Ms`, the length of the take in milliseconds, as protocol § 6 says it does. It is computed from the PCM, so it is right for mp3 and opus as well as wav and pcm.
