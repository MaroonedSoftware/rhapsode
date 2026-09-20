import userEvent from '@testing-library/user-event';
import { DateTime } from 'luxon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSummary, ResidencyDetail, ResidentModel } from '@maroonedsoftware/rhapsode-sdk';

import { LoadedModels } from '../../../src/components/catalog/loaded.models';
import { render, screen } from '../../utils/render';

const residency = vi.fn<() => Promise<ResidencyDetail>>();
const unloadEngine = vi.fn<(engine: string, query?: { mode?: string }) => Promise<EngineSummary>>();

vi.mock('../../../src/api/client', () => ({
    sdk: { public: { residency: () => residency(), unloadEngine: (engine: string, query?: { mode?: string }) => unloadEngine(engine, query) } },
}));

const model = (over: Partial<ResidentModel> = {}): ResidentModel => ({
    engine: 'tone',
    variant: 'plain',
    leases: 0,
    lastUsedAt: DateTime.utc().toISO()!,
    keepAliveSeconds: 300,
    ...over,
});

const detail = (models: ResidentModel[], over: Partial<ResidencyDetail> = {}): ResidencyDetail => ({
    resident: models.length,
    max: 1,
    waiting: 0,
    models,
    ...over,
});

describe('LoadedModels', () => {
    beforeEach(() => {
        residency.mockReset();
        unloadEngine.mockReset();
    });
    afterEach(() => vi.clearAllMocks());

    it('says nothing is loaded, which is not the same as being broken', async () => {
        residency.mockResolvedValue(detail([]));
        render(<LoadedModels />);

        expect(await screen.findByText(/Nothing is loaded/)).toBeInTheDocument();
    });

    it('shows what is on the card, with its size and when it goes', async () => {
        residency.mockResolvedValue(detail([model({ sizeBytes: 3_355_443_200, expiresAt: DateTime.utc().plus({ minutes: 4 }).toISO()! })]));
        render(<LoadedModels />);

        expect(await screen.findByText('tone')).toBeInTheDocument();
        expect(screen.getByText('plain')).toBeInTheDocument();
        expect(screen.getByText('3.1 GiB')).toBeInTheDocument();
        expect(screen.getByText(/in 3m|in 4m/)).toBeInTheDocument();
    });

    it('shows a dash where nothing could measure the model, rather than zero', async () => {
        // § 3 has a worker leave the field out when it cannot measure, and "0 B" would read as a
        // model that costs nothing.
        residency.mockResolvedValue(detail([model()]));
        render(<LoadedModels />);

        expect(await screen.findByText('—')).toBeInTheDocument();
    });

    it('says never for a model that has been pinned', async () => {
        residency.mockResolvedValue(detail([model({ keepAliveSeconds: -1 })]));
        render(<LoadedModels />);

        expect(await screen.findByText('never')).toBeInTheDocument();
    });

    it('will not offer to unload a model that is speaking, because the core refuses that', async () => {
        residency.mockResolvedValue(detail([model({ leases: 2 })]));
        render(<LoadedModels />);

        expect(await screen.findByText('speaking (2)')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Unload' })).toBeDisabled();
    });

    it('asks the core to free the model, and terminates by default', async () => {
        residency.mockResolvedValue(detail([model()]));
        unloadEngine.mockResolvedValue({
            id: 'tone',
            displayName: 'Tone',
            license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true },
            process: 'down',
            model: 'unloaded',
            restarts: 0,
        });
        render(<LoadedModels />);

        await userEvent.click(await screen.findByRole('button', { name: 'Unload' }));

        expect(unloadEngine).toHaveBeenCalledWith('tone', undefined);
    });

    it('says the server did not answer, rather than showing an empty card', async () => {
        residency.mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
        render(<LoadedModels />);

        expect(await screen.findByText('What is loaded did not load')).toBeInTheDocument();
    });
});
