"""A worker built against a contract this core has never heard of. protocol.md § 9.

The core and its workers ship separately, so they will disagree in the field. This is what that
disagreement looks like from the core's side, and it has to be a clear refusal naming both numbers
rather than a confusing failure later.
"""

from __future__ import annotations

import json
import os
import socket
import sys

# Deliberately not using serve(): the SDK correctly refuses to claim a contract above what it
# speaks, which is the behaviour being worked around here to produce a worker the core must reject.
listen = os.environ["RHAPSODE_WORKER_LISTEN"]
path = listen[len("unix:") :]
sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.bind(path)
sock.listen(8)

line = json.dumps(
    {"ready": True, "contract": 99, "engine": os.environ["RHAPSODE_WORKER_ENGINE"], "listen": listen}
)
sys.stdout.write(line + "\n")
sys.stdout.flush()

# Answer nothing. The core should never get as far as asking.
while True:
    connection, _ = sock.accept()
    connection.close()
