---
---

The Engines page gains "On the card": what this server has loaded, how big each model is, when it
expires, and a button to unload it now (`protocol.md` § 3). It is the one polled query in the page,
because a keep-alive runs out without anything here asking it to, and a row left on screen minutes
after its model has gone is worse than no row. A model with a request still speaking it shows what
is holding it and its button is disabled rather than offered and refused, since the core answers a
`409` there. A size nothing could measure shows as a dash, never as zero. A page opened from another
machine reads the panel and is not offered the buttons, which is the same rule the install actions
already follow.
