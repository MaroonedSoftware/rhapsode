---
---

The web page has a **Settings** page (`protocol.md` § 10, "Settings"): every setting in cards by what
it is for, each saying whether its value came from `rhapsode.config.json`, the default, or a change
made here, and whether a change applies now or at the next restart. A card saves only what was changed
in it, **Reset** puts a setting back to the file's value or the default, and the changes waiting for
a restart are listed at the top. The management token is never shown: the page says whether one is
set, takes a new one or generates it in the browser, and asks before removing it. A page opened from
another machine is told that settings are only for the machine running rhapsode, as it is for
installs. On a phone the header shows the mark without the name, so all four pages fit.
