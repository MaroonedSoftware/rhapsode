import { describe, expect, it } from 'vitest';

import { models, operationGroups, properties, refName, type Schema } from '../../../src/components/reference/openapi.view';
import { openapiDocument } from '../../utils/openapi.document';

describe('operationGroups', () => {
    it('files each route under its first path segment, in document order', () => {
        const groups = operationGroups(openapiDocument);
        expect(groups.map(group => group.name)).toEqual(['/health', '/speak', '/engines']);
        expect(groups[2]?.operations[0]).toMatchObject({ key: 'POST /engines/{engine}/install', operationId: 'installEngine' });
    });

    it('marks a route that declares 403 as management, and only that one', () => {
        // § 6 reserves 403 for a management route called from somewhere it does not answer.
        const operations = operationGroups(openapiDocument).flatMap(group => group.operations);
        expect(operations.filter(operation => operation.management).map(operation => operation.key)).toEqual(['POST /engines/{engine}/install']);
    });

    it('ignores what it does not know rather than failing on it', () => {
        // § 9: a client must not fail on a field it does not recognise.
        const groups = operationGroups({ ...openapiDocument, paths: { '/odd': { summary: 'no methods', trace: {} }, '/also': 'not an object' } });
        expect(groups).toEqual([]);
    });
});

describe('properties', () => {
    it('merges an allOf into the one list a request actually takes', () => {
        const schemas = Object.fromEntries(models(openapiDocument));
        const rows = properties({ $ref: '#/components/schemas/EngineSpeakRequest' }, schemas);

        expect(rows.map(row => [row.name, row.required])).toEqual([
            ['text', true],
            ['variant', false],
            ['params', false],
            ['engine', true],
        ]);
    });

    it('stops at a model that refers to itself', () => {
        const schemas: Record<string, Schema> = { Loop: { allOf: [{ $ref: '#/components/schemas/Loop' }] } };
        expect(properties({ $ref: '#/components/schemas/Loop' }, schemas)).toEqual([]);
    });
});

describe('refName', () => {
    it('names a component schema and nothing else', () => {
        expect(refName('#/components/schemas/Voice')).toBe('Voice');
        expect(refName('https://example.com/schema.json')).toBeUndefined();
    });
});
