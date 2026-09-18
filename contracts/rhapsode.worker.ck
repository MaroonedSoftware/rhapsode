options {
    keys: {
        area: worker
    }
}

# The worker surface: the engine-scoped subset of the public API, plus the residency verbs the core
# owns the policy for. protocol.md § 1.
#
# An engine author reads this file and `rhapsode.types.ck` and nothing else. There is no second
# protocol, and the core is not a dependency of writing an adapter.
#
# Note what is NOT generated from these declarations: a router. `/speak` streams, ContractKit has no
# way to say so, and a generated handler would assign a materialized value to the body, which for a
# five-minute synthesis means buffering it. Both `/speak` routes are hand-written. What the
# declarations are for is the request schemas, the error envelope, the OpenAPI document, and the
# Python client the conformance suite drives a worker with.

operation /health: {
    get: {                          # Answers while unloaded, and while draining.
        sdk: workerHealth
        response: {
            200: { application/json: WorkerHealth }
        }
    }
}

operation /capabilities: {
    get: {
        sdk: workerCapabilities
        response: {
            200: { application/json: Capabilities }
        }
    }
}

operation /voices: {
    get: {
        sdk: workerVoices
        response: {
            200: { application/json: array(Voice) }
        }
    }
    post: {                         # Cloning, where the variant supports it.
        sdk: workerCreateVoice
        request: {
            multipart/form-data: CreateVoiceForm
        }
        response: {
            201: { application/json: Voice }
            422: { application/json: ErrorBody }
        }
    }
}

operation /voices/{voice}: {
    params: {
        voice: string
    }
    delete: {
        sdk: workerDeleteVoice
        response: {
            204:
            404: { application/json: ErrorBody }
        }
    }
}

operation /voices/{voice}/preview: {
    params: {
        voice: string
    }
    get: {
        sdk: workerVoicePreview
        response: {
            200: {
                audio/wav: binary
            }
            404: { application/json: ErrorBody }
        }
    }
}

operation /load: {
    post: {
        sdk: workerLoad
        request: {
            application/json: LoadRequest
        }
        response: {
            200: { application/json: WorkerHealth }
            503: { application/json: ErrorBody }
        }
    }
}

operation /unload: {
    post: {                         # Idempotent, and never fatal. Unloading nothing is a success.
        sdk: workerUnload
        response: {
            200: { application/json: WorkerHealth }
        }
    }
}

operation /terminate: {
    post: {
        # Drain and exit 0. The answer goes out before the process does, so 202 rather than 200:
        # the work is accepted, and the evidence it happened is the socket closing.
        sdk: workerTerminate
        response: {
            202:
        }
    }
}

operation /fetch: {
    post: {
        # Download a variant's weights without loading them, so a first /speak does not sit through
        # the download. Optional: an adapter that does not override fetch answers 422. protocol.md § 8.
        sdk: workerFetch
        request: {
            application/json: FetchRequest
        }
        response: {
            204:
            400: { application/json: ErrorBody }
            422: { application/json: ErrorBody }
            429: { application/json: ErrorBody }
            500: { application/json: ErrorBody }
        }
    }
}

operation /speak: {
    post: {
        # Loads on demand. It does not fail with "no model loaded" and does not require /load first.
        # Hand-written on both sides: see the note at the top of this file.
        sdk: workerSpeak
        request: {
            application/json: SpeakRequest
        }
        response: {
            200: {
                audio/wav: binary
                audio/mpeg: binary
                audio/opus: binary
                audio/flac: binary
                audio/L16: binary
            }
            400: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
            422: { application/json: ErrorBody }
            429: { application/json: ErrorBody }
            503: { application/json: ErrorBody }
        }
    }
}
