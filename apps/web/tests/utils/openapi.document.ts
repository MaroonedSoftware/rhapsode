import type { OpenApiDocument } from '@maroonedsoftware/rhapsode-sdk';

const errorBody = { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } };

/**
 * A trimmed copy of what the core serves at `/openapi.json`: one open route, one request with an
 * `allOf` body, and one management route. The shapes are the generator's own, copied from
 * `docs/openapi.yaml`, so the page is tested against what it will actually be given.
 */
export const openapiDocument: OpenApiDocument = {
    openapi: '3.1.0',
    info: { title: 'Rhapsode', version: '0.1.1' },
    paths: {
        '/health': {
            get: {
                operationId: 'health',
                description: "The core's own.",
                responses: {
                    '200': {
                        description: 'Successful response',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/CoreHealth' } } },
                    },
                },
            },
        },
        '/speak': {
            post: {
                operationId: 'speak',
                description: 'The one endpoint that matters.',
                requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/EngineSpeakRequest' } } } },
                responses: {
                    '200': { description: 'Successful response', content: { 'audio/wav': { schema: { type: 'string', format: 'binary' } } } },
                    '400': { description: 'Bad request', content: errorBody },
                },
            },
        },
        '/engines/{engine}/install': {
            post: {
                operationId: 'installEngine',
                parameters: [{ name: 'engine', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '202': { description: 'Accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/InstallJob' } } } },
                    '403': { description: 'Forbidden', content: errorBody },
                },
            },
        },
    },
    components: {
        schemas: {
            CoreHealth: {
                type: 'object',
                properties: { contract: { type: 'integer' }, status: { type: 'string', enum: ['ok', 'degraded'] } },
                required: ['contract', 'status'],
            },
            SpeakRequest: {
                type: 'object',
                properties: {
                    text: { type: 'string', minLength: 1 },
                    variant: { type: 'string', description: 'Absent means whatever is loaded.' },
                    params: {
                        type: 'object',
                        additionalProperties: { type: 'number' },
                        description: "Validated against the effective variant's dials.",
                    },
                },
                required: ['text'],
            },
            EngineSpeakRequest: {
                allOf: [
                    { $ref: '#/components/schemas/SpeakRequest' },
                    { type: 'object', properties: { engine: { type: 'string' } }, required: ['engine'] },
                ],
            },
            InstallJob: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
            ErrorBody: { type: 'object', properties: { error: { type: 'object' } }, required: ['error'] },
        },
    },
};
