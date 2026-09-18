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
        sdk: createVoice
        request: {
            multipart/form-data: CreateVoiceForm
        }
        response: {
            201: { application/json: Voice }
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
            404: { application/json: ErrorBody }
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
