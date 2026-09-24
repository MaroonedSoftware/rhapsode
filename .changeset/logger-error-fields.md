---
---

A log line written with an error as one of its fields, such as `logger.error('failed', error)`,
now includes the error's name, message, stack and cause under `extra`. Before this fix, the error
was left out of the line.
