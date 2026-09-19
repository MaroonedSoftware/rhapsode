import type { FastifyPluginAsync } from 'fastify';

import { OPENAPI_DOCUMENT, type OpenApiDocument } from '@rhapsode/contract';

import { CORE_VERSION } from '../core.version.js';

/**
 * `GET /openapi.json`: the public API, described. protocol.md § 9.
 *
 * Open to every caller, like `/health`: it says nothing a caller could not learn by trying, and
 * withholding it only sends people to a copy on the web that describes some other version. The
 * version is stamped here as well as at codegen, because the document is generated at the release
 * number and a core run from a checkout between releases is not that release.
 */
export const apiReferenceRoutes: FastifyPluginAsync = async app => {
    const document: OpenApiDocument = { ...OPENAPI_DOCUMENT, info: { ...OPENAPI_DOCUMENT.info, version: CORE_VERSION } };

    app.get('/openapi.json', async () => document);
};
