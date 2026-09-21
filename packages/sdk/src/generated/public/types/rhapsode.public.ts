import type { JsonValue } from '../../sdk-options.js';

/**
 * generated from [ApiInfo](../../../../../../contracts/rhapsode.public.ck#L63)
 */
export interface ApiInfo {
    title: string;
    /** The running core's package version. Not the contract. */
    version: string;
}

/**
 * This file, `rhapsode.types.ck` and `rhapsode.openai.ck` as OpenAPI 3.1. protocol.md § 9. Only the
 * top of the document is declared: the rest is OpenAPI's own shape, and a client that wants it typed
 * already has a library that types it.
 * generated from [OpenApiDocument](../../../../../../contracts/rhapsode.public.ck#L56)
 */
export interface OpenApiDocument {
    openapi: string;
    info: ApiInfo;
    paths: Record<string, JsonValue>;
    components?: Record<string, JsonValue>;
}
