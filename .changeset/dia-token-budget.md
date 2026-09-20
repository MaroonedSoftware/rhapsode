---
---

Each of Dia's generations is given a budget of decoder tokens from how much text it holds, because Dia does not always stop on its own: measured on an RTX 4070 Ti SUPER, "one" ran to 27 seconds of murmur where a ten-word line stopped by itself after 3.8 seconds, so a shorter text made more audio than a longer one. A piece that uses its whole budget is logged, as one that fills the decoder's positions already was.
