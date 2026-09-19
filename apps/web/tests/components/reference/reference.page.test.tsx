import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenApiDocument } from '@maroonedsoftware/rhapsode-sdk';

import { ReferencePage } from '../../../src/components/reference/reference.page';
import { openapiDocument } from '../../utils/openapi.document';
import { render, screen, setupUser, within } from '../../utils/render';

const api = vi.hoisted(() => ({ openapi: vi.fn<() => Promise<OpenApiDocument>>() }));

vi.mock('../../../src/api/client', () => ({ BASE_URL: '/api', sdk: { public: api } }));

describe('ReferencePage', () => {
    beforeEach(() => {
        api.openapi.mockReset();
    });
    afterEach(() => vi.clearAllMocks());

    it('lists every route the core describes, with the version it is running', async () => {
        api.openapi.mockResolvedValue(openapiDocument);
        render(<ReferencePage />);

        expect(await screen.findByText('/speak', { selector: 'code' })).toBeInTheDocument();
        expect(screen.getByText('/engines/{engine}/install')).toBeInTheDocument();
        expect(screen.getByText('0.1.1')).toBeInTheDocument();
        // The raw document, for a generator or a person who wants the file.
        expect(screen.getByRole('link', { name: 'openapi.json' })).toHaveAttribute('href', '/api/openapi.json');
    });

    it('marks the management routes', async () => {
        api.openapi.mockResolvedValue(openapiDocument);
        render(<ReferencePage />);

        const install = (await screen.findByText('/engines/{engine}/install')).closest('button')!;
        expect(within(install).getByText('Management')).toBeInTheDocument();
        expect(within(screen.getByText('/health', { selector: 'code' }).closest('button')!).queryByText('Management')).toBeNull();
    });

    it('shows the fields a request takes, its allOf merged', async () => {
        api.openapi.mockResolvedValue(openapiDocument);
        const user = setupUser();
        render(<ReferencePage />);

        await user.click((await screen.findByText('/speak', { selector: 'code' })).closest('button')!);

        const request = screen.getByText('Request body').parentElement!;
        for (const field of ['text', 'variant', 'params', 'engine']) expect(within(request).getByText(field)).toBeInTheDocument();
        expect(within(request).getByText('map of string to')).toBeInTheDocument();
    });

    it('opens a model from a link to it', async () => {
        api.openapi.mockResolvedValue(openapiDocument);
        const user = setupUser();
        render(<ReferencePage />);

        await user.click((await screen.findByText('/health', { selector: 'code' })).closest('button')!);
        // findBy: the panel is open at once but shown only once its Collapse has run.
        await user.click(await screen.findByRole('link', { name: 'CoreHealth' }));

        const model = screen.getByText('CoreHealth', { selector: 'code' }).closest('button')!;
        expect(model).toHaveAttribute('aria-expanded', 'true');
    });

    it('filters routes by what a person would type', async () => {
        api.openapi.mockResolvedValue(openapiDocument);
        const user = setupUser();
        render(<ReferencePage />);

        await user.type(await screen.findByRole('textbox', { name: 'Filter routes' }), 'install');

        expect(screen.getByText('/engines/{engine}/install')).toBeInTheDocument();
        expect(screen.queryByText('/speak', { selector: 'code' })).toBeNull();
    });

    it('says the server did not answer, rather than showing an empty reference', async () => {
        api.openapi.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
        render(<ReferencePage />);

        expect(await screen.findByText('The API description did not load')).toBeInTheDocument();
        expect(screen.getByText('The rhapsode server did not answer.')).toBeInTheDocument();
    });
});
