import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../../packages/core/src/registry/engines.catalog';
import { ENGINES } from '../src/engines';

// The front page lists what the catalog installs. A page that still offers an engine the catalog
// dropped, or states a licence it changed, is the site making a promise the server does not keep.
describe('the engines the site lists', () => {
    it('are the catalog, no more and no fewer', () => {
        expect(ENGINES.map(engine => engine.id).sort()).toEqual(Object.keys(CATALOG).sort());
    });

    it('carry the catalog names and licences', () => {
        for (const engine of ENGINES) {
            const record = CATALOG[engine.id];
            expect({ name: engine.name, ...engine.license }).toEqual({
                name: record?.displayName,
                code: record?.license.code,
                weights: record?.license.weights,
            });
        }
    });
});
