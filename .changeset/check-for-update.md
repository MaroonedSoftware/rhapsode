---
---

`POST /update/check` asks GitHub for the latest release now rather than waiting out the day the core keeps an answer, and answers with the same document as `GET /update` once GitHub has. It is open to every caller and returns an answer under five minutes old as it is, so it cannot make the box ask more than twelve times an hour, and it asks nothing while the check is turned off. `protocol.md` § 9.
