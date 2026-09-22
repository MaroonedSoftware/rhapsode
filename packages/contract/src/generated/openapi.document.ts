// Generated from docs/openapi.yaml by scripts/openapi.document.mjs. Do not edit manually.
// The public API as the core serves it at GET /openapi.json. protocol.md § 9.

import type { OpenApiDocument } from './rhapsode.public.schema.js';

export const OPENAPI_DOCUMENT: OpenApiDocument = {
    "openapi": "3.1.0",
    "info": {
        "title": "Rhapsode",
        "version": "0.1.10"
    },
    "paths": {
        "/health": {
            "get": {
                "operationId": "health",
                "description": "The core's own. It answers while every worker is down and never blocks on one, because a",
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/CoreHealth"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/update": {
            "get": {
                "operationId": "updateStatus",
                "description": "Open to every caller, like /health. It never waits on the network: a first call after boot",
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/UpdateStatus"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/residency": {
            "get": {
                "operationId": "residency",
                "description": "What is on the card, for an operator asking where their memory went. Reads the core's own",
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ResidencyDetail"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/openapi.json": {
            "get": {
                "operationId": "openapi",
                "description": "Open to every caller, like /health. The public API only: never a worker route.",
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/OpenApiDocument"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/engines": {
            "get": {
                "operationId": "engines",
                "description": "Every declared engine, whether or not it is running. Never spawns one: this is the list an",
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/components/schemas/EngineSummary"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        "/engines/{engine}/capabilities": {
            "get": {
                "operationId": "engineCapabilities",
                "parameters": [
                    {
                        "name": "engine",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/Capabilities"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "503": {
                        "description": "Response 503",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/engines/{engine}/voices": {
            "get": {
                "operationId": "engineVoices",
                "parameters": [
                    {
                        "name": "engine",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/components/schemas/Voice"
                                    }
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            },
            "post": {
                "operationId": "createVoice",
                "description": "Management, like § 10: it writes a file on the box. Streamed to the worker, capped at 25 MB.",
                "parameters": [
                    {
                        "name": "engine",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "requestBody": {
                    "required": true,
                    "content": {
                        "multipart/form-data": {
                            "schema": {
                                "$ref": "#/components/schemas/CreateVoiceForm"
                            }
                        }
                    }
                },
                "responses": {
                    "201": {
                        "description": "Created",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/Voice"
                                }
                            }
                        }
                    },
                    "400": {
                        "description": "Bad request",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "403": {
                        "description": "Forbidden",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "422": {
                        "description": "Unprocessable entity",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/engines/{engine}/voices/{voice}": {
            "delete": {
                "operationId": "deleteVoice",
                "parameters": [
                    {
                        "name": "engine",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    },
                    {
                        "name": "voice",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "responses": {
                    "204": {
                        "description": "No content"
                    },
                    "400": {
                        "description": "Bad request",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "403": {
                        "description": "Forbidden",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "422": {
                        "description": "Unprocessable entity",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/engines/{engine}/voices/{voice}/preview": {
            "get": {
                "operationId": "voicePreview",
                "parameters": [
                    {
                        "name": "engine",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    },
                    {
                        "name": "voice",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "audio/wav": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/speak": {
            "post": {
                "operationId": "speak",
                "description": "The one endpoint that matters. Cues the effective variant does not claim are stripped",
                "requestBody": {
                    "required": true,
                    "content": {
                        "application/json": {
                            "schema": {
                                "$ref": "#/components/schemas/EngineSpeakRequest"
                            }
                        }
                    }
                },
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "audio/wav": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/mpeg": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/opus": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/flac": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/l16": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            }
                        }
                    },
                    "400": {
                        "description": "Bad request",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "422": {
                        "description": "Unprocessable entity",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "429": {
                        "description": "Response 429",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "503": {
                        "description": "Response 503",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/engines/{engine}/dialogue": {
            "post": {
                "operationId": "dialogue",
                "description": "A conversation in one take, on a variant that declares `dialogue`. Cues are stripped per",
                "parameters": [
                    {
                        "name": "engine",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "requestBody": {
                    "required": true,
                    "content": {
                        "application/json": {
                            "schema": {
                                "$ref": "#/components/schemas/EngineDialogueRequest"
                            }
                        }
                    }
                },
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "audio/wav": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/mpeg": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/opus": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/flac": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/l16": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            }
                        }
                    },
                    "400": {
                        "description": "Bad request",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "422": {
                        "description": "Unprocessable entity",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "429": {
                        "description": "Response 429",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "503": {
                        "description": "Response 503",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/catalog": {
            "get": {
                "operationId": "catalog",
                "description": "Open to every caller: it only reads, and its licences are what § 4 promises before install.",
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/components/schemas/CatalogEntry"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        "/engines/{engine}": {
            "delete": {
                "operationId": "uninstallEngine",
                "description": "Only an engine this API installed. One the operator configured is theirs to remove.",
                "parameters": [
                    {
                        "name": "engine",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "responses": {
                    "204": {
                        "description": "No content"
                    },
                    "403": {
                        "description": "Forbidden",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "409": {
                        "description": "Conflict",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/engines/{engine}/unload": {
            "post": {
                "operationId": "unloadEngine",
                "description": "Free this engine's model now, rather than waiting out its keep-alive. Idempotent: an",
                "parameters": [
                    {
                        "name": "engine",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    },
                    {
                        "name": "mode",
                        "in": "query",
                        "required": false,
                        "schema": {
                            "type": "string",
                            "enum": [
                                "terminate",
                                "unload"
                            ]
                        }
                    }
                ],
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/EngineSummary"
                                }
                            }
                        }
                    },
                    "403": {
                        "description": "Forbidden",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "409": {
                        "description": "Conflict",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/engines/{engine}/install": {
            "post": {
                "operationId": "installEngine",
                "parameters": [
                    {
                        "name": "engine",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    },
                    {
                        "name": "pull",
                        "in": "query",
                        "required": false,
                        "schema": {
                            "type": "string"
                        }
                    },
                    {
                        "name": "accept",
                        "in": "query",
                        "required": false,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "responses": {
                    "202": {
                        "description": "Response 202",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/InstallJob"
                                }
                            }
                        }
                    },
                    "400": {
                        "description": "Bad request",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "403": {
                        "description": "Forbidden",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "409": {
                        "description": "Conflict",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/engines/{engine}/reinstall": {
            "post": {
                "operationId": "reinstallEngine",
                "parameters": [
                    {
                        "name": "engine",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    },
                    {
                        "name": "accept",
                        "in": "query",
                        "required": false,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "responses": {
                    "202": {
                        "description": "Response 202",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/InstallJob"
                                }
                            }
                        }
                    },
                    "400": {
                        "description": "Bad request",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "403": {
                        "description": "Forbidden",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "409": {
                        "description": "Conflict",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/engines/{engine}/pull": {
            "post": {
                "operationId": "pullEngine",
                "parameters": [
                    {
                        "name": "engine",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "requestBody": {
                    "required": true,
                    "content": {
                        "application/json": {
                            "schema": {
                                "$ref": "#/components/schemas/PullRequest"
                            }
                        }
                    }
                },
                "responses": {
                    "202": {
                        "description": "Response 202",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/InstallJob"
                                }
                            }
                        }
                    },
                    "403": {
                        "description": "Forbidden",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "409": {
                        "description": "Conflict",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/installs": {
            "get": {
                "operationId": "installJobs",
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "array",
                                    "items": {
                                        "$ref": "#/components/schemas/InstallJob"
                                    }
                                }
                            }
                        }
                    },
                    "403": {
                        "description": "Forbidden",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/installs/outdated": {
            "post": {
                "operationId": "reinstallOutdated",
                "responses": {
                    "202": {
                        "description": "Response 202",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ReinstallOutdated"
                                }
                            }
                        }
                    },
                    "403": {
                        "description": "Forbidden",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/installs/{job}": {
            "get": {
                "operationId": "installJob",
                "parameters": [
                    {
                        "name": "job",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/InstallJob"
                                }
                            }
                        }
                    },
                    "403": {
                        "description": "Forbidden",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/installs/{job}/events": {
            "get": {
                "operationId": "installJobEvents",
                "description": "Server-sent events, each frame's data a FeedEvent. Hand-written, like /speak: ContractKit",
                "parameters": [
                    {
                        "name": "job",
                        "in": "path",
                        "required": true,
                        "schema": {
                            "type": "string"
                        }
                    }
                ],
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "text/event-stream": {
                                "schema": {
                                    "type": "string"
                                }
                            }
                        }
                    },
                    "403": {
                        "description": "Forbidden",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        },
        "/v1/audio/speech": {
            "post": {
                "operationId": "openaiSpeech",
                "description": "Hand-written, like /speak. Every error carries `x-should-retry`, set from `retryable`.",
                "requestBody": {
                    "required": true,
                    "content": {
                        "application/json": {
                            "schema": {
                                "$ref": "#/components/schemas/OpenAISpeechRequest"
                            }
                        }
                    }
                },
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "audio/mpeg": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/opus": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/flac": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/wav": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            },
                            "audio/l16": {
                                "schema": {
                                    "type": "string",
                                    "format": "binary"
                                }
                            }
                        }
                    },
                    "400": {
                        "description": "Bad request",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/OpenAIErrorBody"
                                }
                            }
                        }
                    },
                    "404": {
                        "description": "Not found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/OpenAIErrorBody"
                                }
                            }
                        }
                    },
                    "422": {
                        "description": "Unprocessable entity",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/OpenAIErrorBody"
                                }
                            }
                        }
                    },
                    "429": {
                        "description": "Response 429",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/OpenAIErrorBody"
                                }
                            }
                        }
                    },
                    "500": {
                        "description": "Internal server error",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/OpenAIErrorBody"
                                }
                            }
                        }
                    },
                    "503": {
                        "description": "Response 503",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/OpenAIErrorBody"
                                }
                            }
                        }
                    }
                }
            }
        }
    },
    "components": {
        "schemas": {
            "Dial": {
                "type": "object",
                "properties": {
                    "min": {
                        "type": "number",
                        "description": "Inclusive."
                    },
                    "max": {
                        "type": "number",
                        "description": "Inclusive."
                    },
                    "default": {
                        "type": "number",
                        "description": "What the engine uses when the request says nothing."
                    }
                },
                "required": [
                    "min",
                    "max",
                    "default"
                ]
            },
            "Variant": {
                "type": "object",
                "properties": {
                    "cues": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        },
                        "description": "A subset of the standard vocabulary, § 5."
                    },
                    "deliveries": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        },
                        "description": "Ditto. Not an enum: § 9 forbids failing on an unknown one."
                    },
                    "dials": {
                        "type": "object",
                        "additionalProperties": {
                            "$ref": "#/components/schemas/Dial"
                        },
                        "description": "Engine-specific numbers, named by the adapter."
                    },
                    "languages": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    },
                    "maxCharacters": {
                        "type": "integer",
                        "description": "Overrides the engine's own ceiling for this build."
                    },
                    "cloning": {
                        "$ref": "#/components/schemas/Cloning",
                        "description": "Optional only because contract 1 shipped without it. § 4."
                    },
                    "blending": {
                        "$ref": "#/components/schemas/Blending",
                        "description": "Beside cloning, for the same reason: it needs no model. § 7."
                    },
                    "segmentation": {
                        "$ref": "#/components/schemas/Segmentation",
                        "description": "Whether long text is split into several generations. § 8."
                    },
                    "dialogue": {
                        "$ref": "#/components/schemas/Dialogue",
                        "description": "Present only where this build answers /dialogue. § 6."
                    }
                },
                "required": [
                    "cues",
                    "deliveries",
                    "dials"
                ],
                "description": "What one build of an engine can perform. Capabilities depend on which build is loaded, which is\nthe whole reason this document has two levels: chatterbox `turbo` performs the paralinguistic\ntags and discards the dials, while `original` is the other way round."
            },
            "Dialogue": {
                "type": "object",
                "properties": {
                    "maxSpeakers": {
                        "type": "integer"
                    }
                },
                "required": [
                    "maxSpeakers"
                ],
                "description": "A build that speaks a conversation in one pass. protocol.md § 6."
            },
            "Cloning": {
                "type": "object",
                "properties": {
                    "supported": {
                        "type": "boolean"
                    },
                    "referenceSeconds": {
                        "type": "array",
                        "items": {
                            "type": "number"
                        },
                        "description": "[min, max] of usable reference audio."
                    },
                    "formats": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        },
                        "description": "File types a `reference` may be. § 7."
                    }
                },
                "required": [
                    "supported"
                ]
            },
            "Blending": {
                "type": "object",
                "properties": {
                    "supported": {
                        "type": "boolean"
                    }
                },
                "required": [
                    "supported"
                ],
                "description": "Whether a create may carry a `blend` recipe instead of a `reference`. § 7."
            },
            "Segmentation": {
                "type": "object",
                "properties": {
                    "supported": {
                        "type": "boolean"
                    },
                    "segmentCharacters": {
                        "type": "integer",
                        "description": "The most one generation gets. Absent where nothing splits."
                    }
                },
                "required": [
                    "supported"
                ],
                "description": "Whether text longer than one generation is split rather than refused. protocol.md § 8.\n\nDeclared because a client cannot see the split and is affected by it: a `seed` reproduces a\ngeneration, so a request split four ways is four seeded generations, and prosody carries across a\njoint only where the engine carries it."
            },
            "Streaming": {
                "type": "object",
                "properties": {
                    "supported": {
                        "type": "boolean"
                    },
                    "granularity": {
                        "type": "string",
                        "enum": [
                            "chunk",
                            "sentence"
                        ]
                    }
                },
                "required": [
                    "supported"
                ]
            },
            "NativeFormat": {
                "type": "object",
                "properties": {
                    "encoding": {
                        "type": "string",
                        "description": "v1 accepts pcm_s16le and nothing else."
                    },
                    "sampleRate": {
                        "type": "integer"
                    },
                    "channels": {
                        "type": "integer"
                    }
                },
                "required": [
                    "encoding",
                    "sampleRate",
                    "channels"
                ]
            },
            "CurrentVariant": {
                "allOf": [
                    {
                        "$ref": "#/components/schemas/Variant"
                    },
                    {
                        "type": "object",
                        "properties": {
                            "variant": {
                                "type": "string"
                            },
                            "cloning": {
                                "$ref": "#/components/schemas/Cloning"
                            },
                            "blending": {
                                "$ref": "#/components/schemas/Blending",
                                "description": "Absent means no, so a worker that predates it is read correctly."
                            },
                            "streaming": {
                                "$ref": "#/components/schemas/Streaming"
                            },
                            "nativeFormat": {
                                "$ref": "#/components/schemas/NativeFormat"
                            }
                        },
                        "required": [
                            "variant",
                            "cloning",
                            "streaming",
                            "nativeFormat"
                        ]
                    }
                ]
            },
            "EngineIdentity": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string"
                    },
                    "displayName": {
                        "type": "string"
                    },
                    "adapterVersion": {
                        "type": "string"
                    },
                    "upstreamVersion": {
                        "type": "string"
                    }
                },
                "required": [
                    "id",
                    "displayName",
                    "adapterVersion"
                ]
            },
            "License": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string"
                    },
                    "weights": {
                        "type": "string"
                    },
                    "weightsCommercialUse": {
                        "type": "boolean"
                    },
                    "notes": {
                        "type": "string"
                    }
                },
                "required": [
                    "code",
                    "weights",
                    "weightsCommercialUse"
                ],
                "description": "Code and weights separately, because the weights licence is the one package metadata never reveals\nand the one that decides whether a commercial user may ship. A scanner reads the package, reports\nthe code licence, and is wrong in the way that matters."
            },
            "Device": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "cuda",
                            "rocm",
                            "mps",
                            "cpu"
                        ]
                    },
                    "name": {
                        "type": "string"
                    },
                    "vramBytes": {
                        "type": "integer"
                    }
                },
                "required": [
                    "type",
                    "name"
                ]
            },
            "Capabilities": {
                "type": "object",
                "properties": {
                    "contract": {
                        "type": "integer",
                        "description": "The contract major this worker settled on. § 9."
                    },
                    "engine": {
                        "$ref": "#/components/schemas/EngineIdentity"
                    },
                    "license": {
                        "$ref": "#/components/schemas/License"
                    },
                    "device": {
                        "$ref": "#/components/schemas/Device"
                    },
                    "current": {
                        "$ref": "#/components/schemas/CurrentVariant"
                    },
                    "variants": {
                        "type": "object",
                        "additionalProperties": {
                            "$ref": "#/components/schemas/Variant"
                        }
                    },
                    "formats": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        },
                        "description": "What this worker can actually encode, here and now."
                    }
                },
                "required": [
                    "contract",
                    "engine",
                    "license",
                    "device",
                    "variants",
                    "formats"
                ]
            },
            "Voice": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string"
                    },
                    "label": {
                        "type": "string"
                    },
                    "description": {
                        "type": "string"
                    },
                    "spec": {
                        "type": "string",
                        "description": "Opaque. Changes whenever the rendering would. Never parse it."
                    },
                    "tags": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    },
                    "previewUrl": {
                        "type": "string",
                        "description": "Worker-scoped; the core rewrites it on the way out."
                    }
                },
                "required": [
                    "id",
                    "label",
                    "spec"
                ]
            },
            "CreateVoiceForm": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string"
                    },
                    "label": {
                        "type": "string"
                    },
                    "reference": {
                        "type": "string",
                        "format": "binary",
                        "description": "Exactly one of `reference` and `blend`. § 7."
                    },
                    "blend": {
                        "type": "string",
                        "description": "A recipe, `name(weight)+name(weight)`, over voices the engine has."
                    },
                    "transcript": {
                        "type": "string",
                        "description": "The words spoken in the reference. Required by an engine that continues from it."
                    }
                },
                "required": [
                    "id"
                ]
            },
            "SpeakRequest": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "minLength": 1
                    },
                    "voice": {
                        "type": "string"
                    },
                    "variant": {
                        "type": "string",
                        "description": "Absent means whatever is loaded."
                    },
                    "format": {
                        "type": "string",
                        "enum": [
                            "wav",
                            "mp3",
                            "opus",
                            "flac",
                            "pcm"
                        ]
                    },
                    "language": {
                        "type": "string",
                        "description": "From the effective variant's `languages`."
                    },
                    "delivery": {
                        "type": "string",
                        "enum": [
                            "hushed",
                            "frantic"
                        ],
                        "description": "Closed, and deliberately has no word for \"ordinary\"."
                    },
                    "params": {
                        "type": "object",
                        "additionalProperties": {
                            "type": "number"
                        },
                        "description": "Validated against the effective variant's dials."
                    },
                    "seed": {
                        "type": "integer"
                    },
                    "stream": {
                        "type": "boolean"
                    }
                },
                "required": [
                    "text"
                ]
            },
            "EngineSpeakRequest": {
                "allOf": [
                    {
                        "$ref": "#/components/schemas/SpeakRequest"
                    },
                    {
                        "type": "object",
                        "properties": {
                            "engine": {
                                "type": "string"
                            },
                            "keepAliveSeconds": {
                                "type": "integer",
                                "minimum": -1,
                                "description": "-1 never expires, 0 frees on release."
                            }
                        },
                        "required": [
                            "engine"
                        ]
                    }
                ]
            },
            "DialogueTurn": {
                "type": "object",
                "properties": {
                    "speaker": {
                        "type": "string",
                        "minLength": 1
                    },
                    "text": {
                        "type": "string",
                        "minLength": 1
                    }
                },
                "required": [
                    "speaker",
                    "text"
                ],
                "description": "One speaker's line in a conversation. `speaker` is a label the request makes up, not a voice."
            },
            "DialogueRequest": {
                "type": "object",
                "properties": {
                    "turns": {
                        "type": "array",
                        "items": {
                            "$ref": "#/components/schemas/DialogueTurn"
                        }
                    },
                    "voices": {
                        "type": "object",
                        "additionalProperties": {
                            "type": "string"
                        },
                        "description": "Speaker label to voice id."
                    },
                    "variant": {
                        "type": "string"
                    },
                    "format": {
                        "type": "string",
                        "enum": [
                            "wav",
                            "mp3",
                            "opus",
                            "flac",
                            "pcm"
                        ]
                    },
                    "language": {
                        "type": "string"
                    },
                    "params": {
                        "type": "object",
                        "additionalProperties": {
                            "type": "number"
                        }
                    },
                    "seed": {
                        "type": "integer"
                    },
                    "stream": {
                        "type": "boolean"
                    }
                },
                "required": [
                    "turns"
                ],
                "description": "A conversation in one take. protocol.md § 6. `/speak`'s fields except `text`, `voice` and\n`delivery`: a delivery reads a whole line one way, and a dialogue has more than one reader."
            },
            "EngineDialogueRequest": {
                "allOf": [
                    {
                        "$ref": "#/components/schemas/DialogueRequest"
                    },
                    {
                        "type": "object",
                        "properties": {
                            "keepAliveSeconds": {
                                "type": "integer",
                                "minimum": -1
                            }
                        }
                    }
                ]
            },
            "ErrorDetail": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "enum": [
                            "bad_request",
                            "unknown_engine",
                            "unknown_voice",
                            "unsupported",
                            "model_unavailable",
                            "oom",
                            "overloaded",
                            "internal",
                            "forbidden",
                            "conflict"
                        ],
                        "description": "A closed set that § 9 grows at the end. A reader that meets a code from a newer contract must\nnot lose the envelope over it: `message` and `retryable` are the two fields that decide what\nthe caller does next, and they parse fine. The core falls back to `internal` for the code and\nkeeps the rest, rather than reporting a parse failure in place of the real error."
                    },
                    "message": {
                        "type": "string"
                    },
                    "retryable": {
                        "type": "boolean"
                    }
                },
                "required": [
                    "code",
                    "message",
                    "retryable"
                ],
                "description": "`retryable` is a field rather than something the client infers from the status, because the\ndistinction that matters is between \"this request was wrong\" and \"this request was fine and the\nserver was not\". A caller that conflates them either retries a permanent failure forever or\ndiscards work that would have succeeded on the next pass."
            },
            "ErrorBody": {
                "type": "object",
                "properties": {
                    "error": {
                        "$ref": "#/components/schemas/ErrorDetail"
                    }
                },
                "required": [
                    "error"
                ]
            },
            "EngineSummary": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string"
                    },
                    "displayName": {
                        "type": "string"
                    },
                    "license": {
                        "$ref": "#/components/schemas/License"
                    },
                    "process": {
                        "type": "string",
                        "enum": [
                            "down",
                            "starting",
                            "up",
                            "draining",
                            "failed"
                        ]
                    },
                    "model": {
                        "type": "string",
                        "enum": [
                            "unloaded",
                            "loading",
                            "loaded",
                            "unloading"
                        ]
                    },
                    "variant": {
                        "type": "string"
                    },
                    "lastError": {
                        "type": "string"
                    },
                    "restarts": {
                        "type": "integer"
                    },
                    "workerVersion": {
                        "type": "string",
                        "description": "`rhapsode-worker` as installed in this engine's venv, read from the venv rather than asked of\nthe worker so that a `down` engine still answers. A diagnostic, never negotiation: one that\ndiffers from the core's version is a pin an upgrade broke. Absent where nothing can say, which\nincludes every remote engine. protocol.md § 9."
                    },
                    "outdated": {
                        "type": "boolean",
                        "description": "Whether `workerVersion` differs from this core's version, so no client compares the two.\nAbsent exactly when `workerVersion` is. A warning, never a refusal. protocol.md § 9."
                    }
                },
                "required": [
                    "id",
                    "displayName",
                    "license",
                    "process",
                    "model",
                    "restarts"
                ]
            },
            "ResidencySummary": {
                "type": "object",
                "properties": {
                    "resident": {
                        "type": "integer"
                    },
                    "max": {
                        "type": "integer"
                    },
                    "waiting": {
                        "type": "integer"
                    },
                    "blockedBy": {
                        "type": "string",
                        "description": "Named, because a wait at maxResidentModels 1 looks exactly like a hang."
                    }
                },
                "required": [
                    "resident",
                    "max",
                    "waiting"
                ]
            },
            "ResidentModel": {
                "type": "object",
                "properties": {
                    "engine": {
                        "type": "string"
                    },
                    "variant": {
                        "type": "string"
                    },
                    "leases": {
                        "type": "integer",
                        "description": "Requests still speaking it. A model with leases is not evictable."
                    },
                    "lastUsedAt": {
                        "type": "string",
                        "description": "ISO 8601, UTC."
                    },
                    "expiresAt": {
                        "type": "string",
                        "description": "Absent while it is speaking, or when its keep-alive says never."
                    },
                    "keepAliveSeconds": {
                        "type": "integer",
                        "description": "The one in force here: request, then engine, then server."
                    },
                    "sizeBytes": {
                        "type": "integer",
                        "description": "What the worker measured the model taking, where it could."
                    }
                },
                "required": [
                    "engine",
                    "variant",
                    "leases",
                    "lastUsedAt",
                    "keepAliveSeconds"
                ],
                "description": "One model on the card, and what the core knows about it. protocol.md § 3."
            },
            "ResidencyDetail": {
                "allOf": [
                    {
                        "$ref": "#/components/schemas/ResidencySummary"
                    },
                    {
                        "type": "object",
                        "properties": {
                            "models": {
                                "type": "array",
                                "items": {
                                    "$ref": "#/components/schemas/ResidentModel"
                                }
                            }
                        },
                        "required": [
                            "models"
                        ]
                    }
                ]
            },
            "CoreHealth": {
                "type": "object",
                "properties": {
                    "contract": {
                        "type": "integer"
                    },
                    "version": {
                        "type": "string",
                        "description": "The running core's package version, for display. Not the contract. § 9."
                    },
                    "status": {
                        "type": "string",
                        "enum": [
                            "ok",
                            "degraded"
                        ]
                    },
                    "engines": {
                        "type": "array",
                        "items": {
                            "$ref": "#/components/schemas/EngineSummary"
                        }
                    },
                    "residency": {
                        "$ref": "#/components/schemas/ResidencySummary"
                    }
                },
                "required": [
                    "contract",
                    "version",
                    "status",
                    "engines",
                    "residency"
                ]
            },
            "UpdateStatus": {
                "type": "object",
                "properties": {
                    "version": {
                        "type": "string",
                        "description": "This core."
                    },
                    "check": {
                        "type": "string",
                        "enum": [
                            "off",
                            "pending",
                            "ok",
                            "failed"
                        ],
                        "description": "off: turned off. pending: no answer yet. failed: the last attempt got none."
                    },
                    "latest": {
                        "type": "string",
                        "description": "The latest release, without its `v`. Present with `ok`."
                    },
                    "updateAvailable": {
                        "type": "boolean",
                        "description": "Whether `latest` is newer than this core. Present with `ok`."
                    },
                    "releaseUrl": {
                        "type": "string",
                        "description": "The release's page, for its notes."
                    },
                    "checkedAt": {
                        "type": "string",
                        "description": "ISO 8601, UTC. When `latest` was read."
                    },
                    "distribution": {
                        "type": "string",
                        "enum": [
                            "docker",
                            "source"
                        ],
                        "description": "Which upgrade instructions apply."
                    }
                },
                "required": [
                    "version",
                    "check",
                    "distribution"
                ],
                "description": "Whether a newer release exists, asked by the core so that no client orders versions. § 9."
            },
            "CatalogEntry": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string"
                    },
                    "displayName": {
                        "type": "string"
                    },
                    "license": {
                        "$ref": "#/components/schemas/License"
                    },
                    "package": {
                        "type": "string",
                        "description": "The Python distribution the installer installs."
                    },
                    "defaultVariant": {
                        "type": "string"
                    },
                    "installed": {
                        "type": "string",
                        "enum": [
                            "no",
                            "installing",
                            "yes"
                        ]
                    },
                    "managed": {
                        "type": "boolean",
                        "description": "Installed through the API, so removable by it."
                    },
                    "workerVersion": {
                        "type": "string",
                        "description": "As on EngineSummary, for an installed engine. § 9."
                    },
                    "outdated": {
                        "type": "boolean",
                        "description": "As on EngineSummary. § 9."
                    }
                },
                "required": [
                    "id",
                    "displayName",
                    "license",
                    "package",
                    "installed",
                    "managed"
                ],
                "description": "What exists, installed or not. `/engines` is what this box has; this is what it could have, with\nboth licences, because the weights licence is only worth reading before the install."
            },
            "InstallJob": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string"
                    },
                    "engine": {
                        "type": "string"
                    },
                    "kind": {
                        "type": "string",
                        "enum": [
                            "install",
                            "pull",
                            "reinstall"
                        ]
                    },
                    "variant": {
                        "type": "string",
                        "description": "What a pull fetches, or an install fetches in step 5."
                    },
                    "state": {
                        "type": "string",
                        "enum": [
                            "queued",
                            "running",
                            "succeeded",
                            "failed"
                        ]
                    },
                    "step": {
                        "type": "string",
                        "enum": [
                            "venv",
                            "packages",
                            "verify",
                            "register",
                            "weights"
                        ]
                    },
                    "createdAt": {
                        "type": "string",
                        "description": "ISO 8601, UTC."
                    },
                    "startedAt": {
                        "type": "string"
                    },
                    "finishedAt": {
                        "type": "string"
                    },
                    "error": {
                        "$ref": "#/components/schemas/ErrorDetail",
                        "description": "Present exactly when `state` is `failed`."
                    }
                },
                "required": [
                    "id",
                    "engine",
                    "kind",
                    "state",
                    "createdAt"
                ]
            },
            "ReinstallSkipped": {
                "type": "object",
                "properties": {
                    "engine": {
                        "type": "string"
                    },
                    "reason": {
                        "type": "string",
                        "enum": [
                            "licence",
                            "busy",
                            "uncatalogued"
                        ],
                        "description": "Needs `accept`; has a job already; the catalog no longer has it."
                    }
                },
                "required": [
                    "engine",
                    "reason"
                ],
                "description": "An outdated engine `POST /installs/outdated` did not queue, and why: each is one a single\nreinstall would have to ask somebody about. § 10."
            },
            "ReinstallOutdated": {
                "type": "object",
                "properties": {
                    "jobs": {
                        "type": "array",
                        "items": {
                            "$ref": "#/components/schemas/InstallJob"
                        },
                        "description": "One reinstall per outdated engine this API installed, in id order."
                    },
                    "skipped": {
                        "type": "array",
                        "items": {
                            "$ref": "#/components/schemas/ReinstallSkipped"
                        }
                    }
                },
                "required": [
                    "jobs",
                    "skipped"
                ]
            },
            "PullRequest": {
                "type": "object",
                "properties": {
                    "variant": {
                        "type": "string",
                        "description": "Absent means the engine's default variant."
                    }
                }
            },
            "OpenApiDocument": {
                "type": "object",
                "properties": {
                    "openapi": {
                        "type": "string"
                    },
                    "info": {
                        "$ref": "#/components/schemas/ApiInfo"
                    },
                    "paths": {
                        "type": "object",
                        "additionalProperties": {}
                    },
                    "components": {
                        "type": "object",
                        "additionalProperties": {}
                    }
                },
                "required": [
                    "openapi",
                    "info",
                    "paths"
                ],
                "description": "This file, `rhapsode.types.ck` and `rhapsode.openai.ck` as OpenAPI 3.1. protocol.md § 9. Only the\ntop of the document is declared: the rest is OpenAPI's own shape, and a client that wants it typed\nalready has a library that types it."
            },
            "ApiInfo": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string"
                    },
                    "version": {
                        "type": "string",
                        "description": "The running core's package version. Not the contract."
                    }
                },
                "required": [
                    "title",
                    "version"
                ]
            },
            "OpenAISpeechRequest": {
                "type": "object",
                "properties": {
                    "model": {
                        "type": "string",
                        "minLength": 1,
                        "description": "An engine id, or `engine:variant`."
                    },
                    "input": {
                        "type": "string",
                        "minLength": 1
                    },
                    "voice": {
                        "type": "string",
                        "description": "Absent means the engine's default."
                    },
                    "response_format": {
                        "type": "string",
                        "enum": [
                            "mp3",
                            "opus",
                            "aac",
                            "flac",
                            "wav",
                            "pcm"
                        ],
                        "description": "Absent means mp3. aac is always refused."
                    },
                    "speed": {
                        "type": "number",
                        "description": "Carried by a `speed` dial, or refused."
                    },
                    "instructions": {
                        "type": "string",
                        "description": "Refused unless empty."
                    },
                    "stream_format": {
                        "type": "string",
                        "enum": [
                            "audio",
                            "sse"
                        ],
                        "description": "sse is always refused."
                    }
                },
                "required": [
                    "model",
                    "input"
                ],
                "description": "Strict, like every request here: OpenAI's own API refuses a field it does not recognise with a 400,\nso a refusal holds a client to nothing it was not already held to."
            },
            "OpenAIErrorDetail": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string"
                    },
                    "type": {
                        "type": "string",
                        "enum": [
                            "invalid_request_error",
                            "server_error"
                        ]
                    },
                    "param": {
                        "type": "string",
                        "description": "The request field the failure is about."
                    },
                    "code": {
                        "type": "string",
                        "description": "The taxonomy code from protocol.md § 6. A string rather than the enum, so a code from a newer\ncontract does not cost a client the envelope. § 9."
                    },
                    "retryable": {
                        "type": "boolean"
                    }
                },
                "required": [
                    "message",
                    "type",
                    "code",
                    "retryable"
                ]
            },
            "OpenAIErrorBody": {
                "type": "object",
                "properties": {
                    "error": {
                        "$ref": "#/components/schemas/OpenAIErrorDetail"
                    }
                },
                "required": [
                    "error"
                ]
            }
        }
    }
};
