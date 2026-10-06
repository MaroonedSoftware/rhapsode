---
---

Long Chinese and Japanese text is now split for engines that take it in pieces. The shared splitter
broke only at whitespace, so text written without spaces reached the model whole: 420 characters of
Chinese went to a 300-character engine as one piece. It now breaks after `。！？` and `，、；：` with
no space needed, keeps a closing `」` with its sentence, and as a last resort cuts a run of Han or
kana with no punctuation at the limit. A cue such as `[clear throat]` stays whole even with no space
around it. Latin text splits as before, and a single Latin word longer than the limit stays whole.
