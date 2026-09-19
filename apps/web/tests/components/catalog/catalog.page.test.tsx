import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '@maroonedsoftware/rhapsode-sdk';

import { CatalogPage } from '../../../src/components/catalog/catalog.page';
import { render, screen } from '../../utils/render';

const catalog = vi.fn<() => Promise<CatalogEntry[]>>();

vi.mock('../../../src/api/client', () => ({ sdk: { public: { catalog: () => catalog() } } }));

const chatterbox: CatalogEntry = {
    id: 'chatterbox',
    displayName: 'Chatterbox',
    license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true, notes: 'https://github.com/resemble-ai/chatterbox' },
    package: 'rhapsode-engine-chatterbox',
    defaultVariant: 'turbo',
    installed: 'no',
    managed: false,
};

describe('CatalogPage', () => {
    // Braces, not an expression: vitest runs a function returned from beforeEach as a teardown, and
    // mockReset returns the mock, so the bare form called the catalog once more after every test.
    beforeEach(() => {
        catalog.mockReset();
    });
    afterEach(() => vi.clearAllMocks());

    it('names both licences for every engine, before anything is installed', async () => {
        catalog.mockResolvedValue([chatterbox]);
        render(<CatalogPage />);

        expect(await screen.findByText('Chatterbox')).toBeInTheDocument();
        expect(screen.getByText('rhapsode-engine-chatterbox')).toBeInTheDocument();
        expect(screen.getByText(/Weights/)).toBeInTheDocument();
        expect(screen.getByText('Not installed')).toBeInTheDocument();
    });

    it('says so when the weights may not be used commercially', async () => {
        catalog.mockResolvedValue([{ ...chatterbox, license: { code: 'Apache-2.0', weights: 'CC-BY-NC-4.0', weightsCommercialUse: false } }]);
        render(<CatalogPage />);

        expect(await screen.findByText('Not for commercial use')).toBeInTheDocument();
    });

    it('marks an engine the operator configured by hand as theirs', async () => {
        catalog.mockResolvedValue([{ ...chatterbox, installed: 'yes', managed: false }]);
        render(<CatalogPage />);

        expect(await screen.findByText('Configured by hand')).toBeInTheDocument();
        expect(screen.getByText('Installed')).toBeInTheDocument();
    });

    it('says the server did not answer, rather than showing an empty catalog', async () => {
        catalog.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
        render(<CatalogPage />);

        expect(await screen.findByText('The catalog did not load')).toBeInTheDocument();
        expect(screen.getByText('The rhapsode server did not answer.')).toBeInTheDocument();
    });
});
