---
---

`POST /installs/outdated` queues a reinstall for every `outdated` engine this API installed and answers with the jobs and what it skipped: an engine whose weights licence needs accepting again, one that already has a job, or one the catalog no longer has. It never refuses as a whole, and nothing behind is `jobs: []`, so `curl -X POST http://127.0.0.1:8081/api/installs/outdated` can end an unattended upgrade. `protocol.md` § 10.
