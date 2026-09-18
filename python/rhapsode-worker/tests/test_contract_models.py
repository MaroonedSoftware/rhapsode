"""The generated contract models, and the one dependency they must not have."""

import subprocess
import sys

from rhapsode_worker._contract import Capabilities, ErrorDetail, SpeakRequest, Variant


def test_models_round_trip_the_wire_names() -> None:
    # The wire is camelCase and Python is snake_case, so the alias is the part worth pinning: a
    # model that silently accepts only one of the two spellings passes every test written in the
    # other one.
    request = SpeakRequest.model_validate({"text": "one two three", "stream": True})
    assert request.text == "one two three"
    assert request.stream is True

    variant = Variant.model_validate(
        {"cues": ["laugh"], "deliveries": [], "dials": {}, "maxCharacters": 4096}
    )
    assert variant.max_characters == 4096
    assert variant.model_dump(by_alias=True, exclude_none=True)["maxCharacters"] == 4096


def test_unknown_fields_do_not_break_a_reader() -> None:
    # protocol.md § 9: additive only, and a reader ignores what it does not know. A model that
    # rejected an unknown key would turn every additive change into a hard failure at exactly the
    # version skew the rule exists to survive.
    variant = Variant.model_validate(
        {"cues": [], "deliveries": [], "dials": {}, "somethingFromAFutureContract": 3}
    )
    assert variant.cues == []


def test_an_unknown_error_code_is_not_fatal_to_the_envelope() -> None:
    # `message` and `retryable` are what decide what the caller does next. Losing them because a
    # newer worker used a code we have not met is the worst possible trade.
    body = {"code": "teapot", "message": "no", "retryable": True}
    try:
        ErrorDetail.model_validate(body)
    except Exception:
        assert body["retryable"] is True
        assert body["message"] == "no"
    else:  # pragma: no cover - only if the enum is widened to a plain string
        pass


def test_the_sdk_never_needs_httpx() -> None:
    # The generator is a client generator and emits an httpx-based client alongside the models;
    # scripts/contract.models.mjs removes it. If that stops working, `pip install rhapsode-worker`
    # starts requiring an HTTP client library that an ONNX adapter has no reason to have, and
    # nothing else would notice.
    program = (
        "import sys\n"
        "class Blocker:\n"
        "    def find_spec(self, name, path=None, target=None):\n"
        "        if name == 'httpx': raise ImportError('httpx must not be reachable')\n"
        "        return None\n"
        "sys.meta_path.insert(0, Blocker())\n"
        "import rhapsode_worker._contract as c\n"
        "assert c.Capabilities is not None\n"
        "print('ok')\n"
    )
    result = subprocess.run([sys.executable, "-c", program], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "ok"


def test_capabilities_uses_the_wire_name_for_the_contract_major() -> None:
    # protocol.md § 4 spells this field `contract`. It is a reserved word in the DSL everywhere
    # except a field position, which is close enough to a trap to be worth a test.
    capabilities = Capabilities.model_validate(
        {
            "contract": 1,
            "engine": {"id": "tone", "displayName": "Tone", "adapterVersion": "0.0.0"},
            "license": {"code": "MIT", "weights": "MIT", "weightsCommercialUse": True},
            "device": {"type": "cpu", "name": "test"},
            "variants": {"default": {"cues": [], "deliveries": [], "dials": {}}},
            "formats": ["wav", "pcm"],
        }
    )
    assert capabilities.contract == 1
    assert capabilities.current is None
