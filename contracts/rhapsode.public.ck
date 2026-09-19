options {
    keys: {
        area: public
    }
}

# The public API. A client author reads this file and `rhapsode.types.ck`, and should never learn
# that workers exist. protocol.md § 1.
#
# Every operation here has a counterpart in `rhapsode.worker.ck` scoped to one engine, and both
# reference the same models, which is the seam the whole design is built on. The paths differ
# because ContractKit has no prefix mechanism; the shapes do not, and the shapes are the contract.

operation /health: {
    get: {
        # The core's own. It answers while every worker is down and never blocks on one, because a
        # health endpoint that waits on the thing it is reporting about is a health endpoint that
        # times out exactly when you need it.
        sdk: health
        response: {
            200: { application/json: CoreHealth }
        }
    }
}

# This file, `rhapsode.types.ck` and `rhapsode.openai.ck` as OpenAPI 3.1. protocol.md § 9. Only the
# top of the document is declared: the rest is OpenAPI's own shape, and a client that wants it typed
# already has a library that types it.
contract mode(loose) OpenApiDocument: {
    openapi: string
    info: ApiInfo
    paths: record(string, json)
    components?: record(string, json)
}

contract mode(loose) ApiInfo: {
    title: string
    version: string                     # The running core's package version. Not the contract.
}

operation /openapi.json: {
    get: {
        # Open to every caller, like /health. The public API only: never a worker route.
        sdk: openapi
        response: {
            200: { application/json: OpenApiDocument }
        }
    }
}

operation /engines: {
    get: {
        # Every declared engine, whether or not it is running. Never spawns one: this is the list an
        # operator reads to find out what is installed, and it carries both licences so the weights
        # licence is visible before install rather than after.
        sdk: engines
        response: {
            200: { application/json: array(EngineSummary) }
        }
    }
}

operation /engines/{engine}/capabilities: {
    params: {
        engine: string
    }
    get: {
        sdk: engineCapabilities
        response: {
            200: { application/json: Capabilities }
            404: { application/json: ErrorBody }
            503: { application/json: ErrorBody }
        }
    }
}

operation /engines/{engine}/voices: {
    params: {
        engine: string
    }
    get: {
        sdk: engineVoices
        response: {
            200: { application/json: array(Voice) }
            404: { application/json: ErrorBody }
        }
    }
    post: {
        # Management, like § 10: it writes a file on the box. Streamed to the worker, capped at 25 MB.
        sdk: createVoice
        request: {
            multipart/form-data: CreateVoiceForm
        }
        response: {
            201: { application/json: Voice }
            400: { application/json: ErrorBody }
            403: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
            422: { application/json: ErrorBody }
        }
    }
}

operation /engines/{engine}/voices/{voice}: {
    params: {
        engine: string
        voice: string
    }
    delete: {
        sdk: deleteVoice
        response: {
            204:
            400: { application/json: ErrorBody }
            403: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
            422: { application/json: ErrorBody }
        }
    }
}

operation /engines/{engine}/voices/{voice}/preview: {
    params: {
        engine: string
        voice: string
    }
    get: {
        sdk: voicePreview
        response: {
            200: {
                audio/wav: binary
            }
            404: { application/json: ErrorBody }
        }
    }
}

operation /speak: {
    post: {
        # The one endpoint that matters. Cues the effective variant does not claim are stripped
        # before dispatch, a delivery it did not claim is dropped, and an unknown dial is a 400
        # naming the key. Hand-written: ContractKit cannot express a streamed body.
        sdk: speak
        request: {
            application/json: EngineSpeakRequest
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

operation /engines/{engine}/dialogue: {
    params: {
        engine: string
    }
    post: {
        # A conversation in one take, on a variant that declares `dialogue`. Cues are stripped per
        # turn, the ceiling is the sum of every turn's text, and one that does not declare it is
        # unsupported. Hand-written: ContractKit cannot express a streamed body.
        sdk: dialogue
        request: {
            application/json: DialogueRequest
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

############################################################################################
# Managing engines. protocol.md § 10. Everything below except /catalog answers loopback callers,
# or a bearer token when one is configured, and nobody else.
############################################################################################

operation /catalog: {
    get: {
        # Open to every caller: it only reads, and its licences are what § 4 promises before install.
        sdk: catalog
        response: {
            200: { application/json: array(CatalogEntry) }
        }
    }
}

operation /engines/{engine}: {
    params: {
        engine: string
    }
    delete: {
        # Only an engine this API installed. One the operator configured is theirs to remove.
        sdk: uninstallEngine
        response: {
            204:
            403: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
            409: { application/json: ErrorBody }
        }
    }
}

operation /engines/{engine}/install: {
    params: {
        engine: string
    }
    post: {
        sdk: installEngine
        # A query rather than a body: ServerKit refuses a missing body on a route that declares
        # one, and an install with nothing else to say has always been a bare POST. protocol.md § 10.
        query: {
            pull?: string                       # A variant to fetch once registered, as step 5.
        }
        response: {
            202: { application/json: InstallJob }
            403: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
            409: { application/json: ErrorBody }
        }
    }
}

operation /engines/{engine}/pull: {
    params: {
        engine: string
    }
    post: {
        sdk: pullEngine
        request: {
            application/json: PullRequest
        }
        response: {
            202: { application/json: InstallJob }
            403: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
            409: { application/json: ErrorBody }
        }
    }
}

operation /installs: {
    get: {
        sdk: installJobs
        response: {
            200: { application/json: array(InstallJob) }
            403: { application/json: ErrorBody }
        }
    }
}

operation /installs/{job}: {
    params: {
        job: string
    }
    get: {
        sdk: installJob
        response: {
            200: { application/json: InstallJob }
            403: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
        }
    }
}

operation /installs/{job}/events: {
    params: {
        job: string
    }
    get: {
        # Server-sent events, each frame's data a FeedEvent. Hand-written, like /speak: ContractKit
        # cannot express a stream, so this declares the route and the shapes and nothing more.
        sdk: installJobEvents
        response: {
            200: { text/event-stream: string }
            403: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
        }
    }
}

