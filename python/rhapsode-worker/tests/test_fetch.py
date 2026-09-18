"""`fetch`: weights downloaded ahead of a load. protocol.md § 8."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import pytest
from conftest import RunningWorker, await_handshake, spawn, stop, url_for


def call(base: str, path: str, body: dict[str, Any] | None = None, method: str = "POST") -> tuple[int, bytes]:
    request = urllib.request.Request(
        f"{base}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={} if body is None else {"content-type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


@pytest.fixture
def failing(tmp_path: Path):
    started: list = []

    def start(mode: str = "ok") -> tuple[str, Path]:
        progress = tmp_path / "progress"
        process = spawn(
            module="engines.failing",
            engine="failing",
            env={"RHAPSODE_TEST_MODE": mode, "RHAPSODE_TEST_PROGRESS": str(progress)},
        )
        started.append(process)
        return url_for(await_handshake(process)), progress

    yield start
    for process in started:
        stop(process)


class TestAnEngineWithoutWeights:
    def test_is_unsupported_rather_than_a_silent_success(self, worker: RunningWorker) -> None:
        # Tone has no weights. Answering 204 would tell a caller the next load will be fast for a
        # reason that does not exist, so the default is to say it does not do this.
        status, body = call(worker.base_url, "/fetch", {"variant": "plain"})
        assert status == 422
        assert json.loads(body)["error"]["code"] == "unsupported"

    def test_names_the_variant_it_does_not_have(self, worker: RunningWorker) -> None:
        status, body = call(worker.base_url, "/fetch", {"variant": "enormous"})
        assert status == 422
        assert "no variant" in json.loads(body)["error"]["message"]

    def test_requires_a_variant(self, worker: RunningWorker) -> None:
        # There is no loaded variant to fall back on for weights that are not loaded yet.
        status, _ = call(worker.base_url, "/fetch", {})
        assert status == 400


class TestAnEngineThatFetches:
    def test_fetches_without_loading(self, failing) -> None:
        base, progress = failing()
        status, _ = call(base, "/fetch", {"variant": "only"})

        assert status == 204
        assert progress.read_text() == "fetched only\n"
        _, health = call(base, "/health", method="GET")
        assert json.loads(health)["model"] == "unloaded"

    def test_a_download_library_that_throws_is_internal(self, failing) -> None:
        # The caller named a variant and nothing else, the same reasoning a load gets.
        base, _ = failing("fetch_type_error")
        status, body = call(base, "/fetch", {"variant": "only"})
        assert status == 500
        assert json.loads(body)["error"]["code"] == "internal"
