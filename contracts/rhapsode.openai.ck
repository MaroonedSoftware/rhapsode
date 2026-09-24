options {
    keys: {
        area: openai
    }
}

# The OpenAI shim. protocol.md § 11.
#
# OpenAI's request and error shapes, as far as this server answers them. The shim translates into
# `/speak` rather than reimplementing it, so these shapes are the only thing in the file that is new.
# Kept out of the SDK and the Python client on purpose: a client that wants these shapes already has
# OpenAI's own SDK, and the point of the shim is that it needs nothing else.

# Strict, like every request here: OpenAI's own API refuses a field it does not recognise with a 400,
# so a refusal holds a client to nothing it was not already held to.
contract OpenAISpeechRequest: {
    model: string(min=1)                                    # An engine id, or `engine:variant`.
    input: string(min=1)
    voice?: string                                          # Absent means the engine's default.
    response_format?: enum(mp3, opus, aac, flac, wav, pcm)  # Absent means mp3. aac is always refused.
    speed?: number                                          # Carried by a `speed` dial, or refused.
    instructions?: string                                   # Refused unless empty.
    stream_format?: enum(audio, sse)                        # sse is always refused.
}

contract mode(loose) OpenAIErrorDetail: {
    message: string
    type: enum(invalid_request_error, server_error)
    param?: string                                          # The request field the failure is about.
    # The taxonomy code from protocol.md § 6. A string rather than the enum, so a code from a newer
    # contract does not cost a client the envelope. § 9.
    code: string
    retryable: boolean
}

contract mode(loose) OpenAIErrorBody: {
    error: OpenAIErrorDetail
}

operation /v1/audio/speech: {
    post: { # OpenAI's speech route, where the model names an engine or engine:variant.
        # Hand-written, like /speak. Every error carries `x-should-retry`, set from `retryable`.
        name: OpenAI speech
        sdk: openaiSpeech
        request: {
            application/json: OpenAISpeechRequest
        }
        response: {
            200: {
                audio/mpeg: binary
                audio/opus: binary
                audio/flac: binary
                audio/wav: binary
                audio/L16: binary
            }
            400: { application/json: OpenAIErrorBody }
            404: { application/json: OpenAIErrorBody }
            422: { application/json: OpenAIErrorBody }
            429: { application/json: OpenAIErrorBody }
            500: { application/json: OpenAIErrorBody }
            503: { application/json: OpenAIErrorBody }
        }
    }
}
