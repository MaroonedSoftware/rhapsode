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
    get: { # The core's own health, which answers even while every worker is down.
        # The core's own. It answers while every worker is down and never blocks on one, because a
        # health endpoint that waits on the thing it is reporting about is a health endpoint that
        # times out exactly when you need it.
        name: Health
        sdk: health
        response: {
            200: { application/json: CoreHealth }
        }
    }
}

operation /update: {
    get: { # Whether a newer rhapsode has been released, from a check made at most once a day.
        # Open to every caller, like /health. It never waits on the network: a first call after boot
        # answers `pending` and starts the check, which runs at most once a day. § 9.
        name: Update status
        sdk: updateStatus
        response: {
            200: { application/json: UpdateStatus }
        }
    }
}

operation /update/check: {
    post: { # Asks GitHub for the latest release now, and answers once it has.
        # Asks GitHub now rather than waiting out the day, and answers once it has, within the check's
        # ten-second timeout. Open, like the read: an answer under five minutes old is returned as it
        # is, so it cannot make the box ask more often than that. `off` stays off. § 9.
        name: Check for an update
        sdk: checkForUpdate
        response: {
            200: { application/json: UpdateStatus }
        }
    }
}

operation /residency: {
    get: { # What each engine holds in memory, how big it is and when it expires.
        # What is on the card, for an operator asking where their memory went. Reads the core's own
        # state: it spawns nothing, loads nothing and never blocks on a worker, exactly as /health
        # and /engines do not. Separate from /health because that one is polled by monitors and
        # carries every engine's licence, and this one is a different question.
        #
        # Not a thing to consult before speaking: /speak loads on demand (§ 3), and a client that
        # reads this first has rebuilt the round trip per utterance that rule exists to remove.
        name: Residency
        sdk: residency
        response: {
            200: { application/json: ResidencyDetail }
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
    get: { # This API as an OpenAPI 3.1 document, describing the core that serves it.
        # Open to every caller, like /health. The public API only: never a worker route.
        name: Self-description
        sdk: openapi
        response: {
            200: { application/json: OpenApiDocument }
        }
    }
}

operation /engines: {
    get: { # Every declared engine, running or not, with its code and weights licences.
        # Every declared engine, whether or not it is running. Never spawns one: this is the list an
        # operator reads to find out what is installed, and it carries both licences so the weights
        # licence is visible before install rather than after.
        name: Engines
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
    get: { # What the engine can do with the variant it has loaded, and what its other variants could.
        name: Engine capabilities
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
    get: { # The engine's voices, built in and cloned.
        name: Voices
        sdk: engineVoices
        response: {
            200: { application/json: array(Voice) }
            404: { application/json: ErrorBody }
        }
    }
    post: { # Creates a voice from a reference, such as a clip to clone, or from a blend of voices the engine has.
        # Management, like § 10: it writes a file on the box. Streamed to the worker, capped at 25 MB.
        name: Create a voice
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
    delete: { # Deletes a voice.
        name: Delete a voice
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
    get: { # A short sample of the voice.
        name: Voice preview
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
    post: { # Speaks a line with one engine, streamed or as a finished file.
        # The one endpoint that matters. Cues the effective variant does not claim are stripped
        # before dispatch, a delivery it did not claim is dropped, and an unknown dial is a 400
        # naming the key. Hand-written: ContractKit cannot express a streamed body.
        name: Speak
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
    post: { # A conversation between speakers in one take, on a variant that declares dialogue.
        # A conversation in one take, on a variant that declares `dialogue`. Cues are stripped per
        # turn, the ceiling is the sum of every turn's text, and one that does not declare it is
        # unsupported. Hand-written: ContractKit cannot express a streamed body.
        name: Dialogue
        sdk: dialogue
        request: {
            application/json: EngineDialogueRequest
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
    get: { # Every engine this core knows how to install, with both licences, before anything is installed.
        # Open to every caller: it only reads, and its licences are what § 4 promises before install.
        name: Catalog
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
    delete: { # Removes an engine this API installed.
        # Only an engine this API installed. One the operator configured is theirs to remove.
        name: Uninstall an engine
        sdk: uninstallEngine
        response: {
            204:
            403: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
            409: { application/json: ErrorBody }
        }
    }
}

operation /engines/{engine}/unload: {
    params: {
        engine: string
    }
    post: { # Frees the engine's model now, rather than waiting out its keep-alive.
        # Free this engine's model now, rather than waiting out its keep-alive. Idempotent: an
        # engine holding nothing is already in the state this asks for, and answers 200.
        #
        # A query rather than a body, as the install route explains. protocol.md § 3 and § 10.
        name: Unload an engine
        sdk: unloadEngine
        query: {
            # `terminate` (the default) ends the worker process, which is the only way to get back
            # the roughly 30% an unload strands. `unload` keeps the process for a faster next load.
            mode?: enum(terminate, unload)
        }
        response: {
            200: { application/json: EngineSummary }
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
    post: { # Installs an engine from the catalog, as a job to follow.
        name: Install an engine
        sdk: installEngine
        # A query rather than a body: ServerKit refuses a missing body on a route that declares
        # one, and an install with nothing else to say has always been a bare POST. protocol.md § 10.
        query: {
            pull?: string                       # A variant to fetch once registered, as step 5.
            # The weights licence, exactly as the catalog names it. Required where the weights may
            # not be used commercially, and checked wherever it is sent. protocol.md § 10.
            accept?: string
        }
        response: {
            202: { application/json: InstallJob }
            400: { application/json: ErrorBody }
            403: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
            409: { application/json: ErrorBody }
        }
    }
}

operation /engines/{engine}/reinstall: {
    params: {
        engine: string
    }
    post: { # Rebuilds an installed engine beside the old one and swaps it in once it works.
        name: Reinstall an engine
        sdk: reinstallEngine
        # Rebuilds an installed engine in its other slot and swaps it in once it imports, so the
        # engine keeps working until then and a failure changes nothing. The remedy for `outdated`.
        # Costs a cold load, and whatever was installed into the old virtualenv by hand. § 10.
        query: {
            # As for install, and needed only where the weights may not be used commercially and the
            # licence the last install accepted is not the one the catalog names now. § 10.
            accept?: string
        }
        response: {
            202: { application/json: InstallJob }
            400: { application/json: ErrorBody }
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
    post: { # Downloads a variant's weights ahead of its first load, as a job to follow.
        name: Pull weights
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
    get: { # Every install job, running and finished.
        name: Install jobs
        sdk: installJobs
        response: {
            200: { application/json: array(InstallJob) }
            403: { application/json: ErrorBody }
        }
    }
}

operation /installs/outdated: {
    post: { # Reinstalls every engine an upgrade left behind.
        name: Reinstall outdated engines
        sdk: reinstallOutdated
        # A reinstall for every `outdated` engine this API installed. Never refused as a whole: what
        # it cannot reinstall without asking is `skipped`, and nothing behind is `jobs: []`, so it can
        # end an unattended upgrade every night. § 10.
        response: {
            202: { application/json: ReinstallOutdated }
            403: { application/json: ErrorBody }
        }
    }
}

operation /installs/{job}: {
    params: {
        job: string
    }
    get: { # One install job and where it has got to.
        name: Install job
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
    get: { # An install job's progress and output as server-sent events.
        # Server-sent events, each frame's data a FeedEvent. Hand-written, like /speak: ContractKit
        # cannot express a stream, so this declares the route and the shapes and nothing more.
        name: Install job events
        sdk: installJobEvents
        response: {
            200: { text/event-stream: string }
            403: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
        }
    }
}


############################################################################################
# Settings. protocol.md § 10, "Settings". Both routes are management routes, reading included:
# the document names directories on the box and the origins it trusts.
#
# Here rather than in rhapsode.types.ck because a worker has no settings of the core's to read, and
# the types file is also the Python worker SDK's models.
############################################################################################

contract mode(loose) SettingsServer: {
    port: int
    host: string
    shutdownGraceMs: int
}

contract mode(loose) SettingsLog: {
    level: enum(error, warn, info, debug, trace)
}

contract mode(loose) SettingsResidency: {
    maxResidentModels: int
    evictionWaitSeconds: int
    keepAliveSeconds: int
}

contract mode(loose) SettingsWorkers: {
    socketDir: string
    voiceDir: string
    startupTimeoutSeconds: int
    drainGraceMs: int
    maxRestarts: int
    restartDecaySeconds: int
}

contract mode(loose) SettingsInstall: {
    venvDir: string
    sourceDir?: string                          # Absent when there is neither a setting nor a checkout to find.
    python: string
}

contract mode(loose) SettingsManagement: {
    tokenSet: boolean                           # Never the token itself, which is a root password for the box.
    origins: array(string)
}

contract mode(loose) SettingsUpdate: {
    check: boolean
}

contract mode(loose) SettingsEngine: {
    keepAliveSeconds?: int                      # Absent when the engine uses residency.keepAliveSeconds.
}

# What the running process is using. A setting waiting for a restart shows its old value here.
contract mode(loose) SettingsValues: {
    server: SettingsServer
    log: SettingsLog
    residency: SettingsResidency
    workers: SettingsWorkers
    install: SettingsInstall
    management: SettingsManagement
    update: SettingsUpdate
    engines: record(string, SettingsEngine)     # One per engine in the registry.
}

contract mode(loose) SettingField: {
    key: string                                 # Dotted: residency.keepAliveSeconds, engines.kokoro.keepAliveSeconds.
    source: enum(default, config, database)     # The layer the value in use came from.
    applies: enum(live, restart)                # Whether a change takes effect when it is written.
    saved?: json                                # A value waiting for a restart. For management.token, `true` and never the token.
}

contract mode(loose) Settings: {
    values: SettingsValues
    fields: array(SettingField)
}

# A change to some settings. Strict, so a misspelt key is refused rather than saved and ignored, and
# every member nullable: `null` clears the database's value and the file's, or the default, shows
# through again. The ranges here are the ones a value is refused outside of; § 10 lists them.
contract SettingsServerPatch: {
    port?: null | int(min=1, max=65535)
    host?: null | string(min=1)
    shutdownGraceMs?: null | int(min=0)
}

contract SettingsLogPatch: {
    level?: null | enum(error, warn, info, debug, trace)
}

contract SettingsResidencyPatch: {
    maxResidentModels?: null | int(min=1)
    evictionWaitSeconds?: null | int(min=0)
    keepAliveSeconds?: null | int(min=-1)
}

contract SettingsWorkersPatch: {
    socketDir?: null | string(min=1)
    voiceDir?: null | string(min=1)
    startupTimeoutSeconds?: null | int(min=1)
    drainGraceMs?: null | int(min=0)
    maxRestarts?: null | int(min=0)
    restartDecaySeconds?: null | int(min=0)
}

contract SettingsInstallPatch: {
    venvDir?: null | string(min=1)
    sourceDir?: null | string(min=1)
    python?: null | string(min=1)
}

contract SettingsManagementPatch: {
    token?: null | string                       # Empty is no token, even where the file has one.
    origins?: null | array(string)              # The whole list, replacing the file's rather than adding to it.
}

contract SettingsUpdatePatch: {
    check?: null | boolean
}

contract SettingsEnginePatch: {
    keepAliveSeconds?: null | int(min=-1)
}

contract SettingsPatch: {
    server?: SettingsServerPatch
    log?: SettingsLogPatch
    residency?: SettingsResidencyPatch
    workers?: SettingsWorkersPatch
    install?: SettingsInstallPatch
    management?: SettingsManagementPatch
    update?: SettingsUpdatePatch
    engines?: record(string, SettingsEnginePatch)
}

operation /settings: {
    get: { # Every setting, its value, where the value came from and whether a change applies now.
        name: Settings
        sdk: settings
        response: {
            200: { application/json: Settings }
            403: { application/json: ErrorBody }
        }
    }
    patch: { # Changes settings in one transaction, and answers the whole document after the write.
        # One transaction: a patch that is refused changes nothing. Answers the whole document after
        # the write. A change that would lock its caller out is a 409. § 10.
        name: Update settings
        sdk: updateSettings
        request: {
            application/json: SettingsPatch
        }
        response: {
            200: { application/json: Settings }
            400: { application/json: ErrorBody }
            403: { application/json: ErrorBody }
            404: { application/json: ErrorBody }
            409: { application/json: ErrorBody }
            422: { application/json: ErrorBody }
        }
    }
}
