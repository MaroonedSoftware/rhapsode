import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogEntry, InstallJob } from '@maroonedsoftware/rhapsode-sdk';

import { CatalogPage } from '../../../src/components/catalog/catalog.page';
import { FakeEventSource } from '../../utils/event.source';
import { render, screen, setupUser, waitFor, within } from '../../utils/render';

// Hoisted with the mock below, which vitest lifts above every import and declaration.
const api = vi.hoisted(() => ({
    catalog: vi.fn<() => Promise<CatalogEntry[]>>(),
    installJobs: vi.fn(),
    installJob: vi.fn(),
    installEngine: vi.fn(),
    pullEngine: vi.fn(),
    uninstallEngine: vi.fn(),
    reinstallEngine: vi.fn(),
    reinstallOutdated: vi.fn(),
    engines: vi.fn(),
    engineCapabilities: vi.fn(),
    warmEngine: vi.fn(),
}));

// An installed engine's card links to Try it, and these tests render with no router around it.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, search, children, ...props }: { to: string; search?: { engine?: string }; children?: ReactNode }) => (
        <a href={search?.engine === undefined ? to : `${to}?engine=${search.engine}`} {...props}>
            {children}
        </a>
    ),
}));

vi.mock('../../../src/api/client', () => ({ BASE_URL: '/api', sdk: { public: api } }));

const chatterbox: CatalogEntry = {
    id: 'chatterbox',
    displayName: 'Chatterbox',
    license: { code: 'MIT', weights: 'MIT', weightsCommercialUse: true },
    package: 'rhapsode-engine-chatterbox',
    defaultVariant: 'turbo',
    installed: 'no',
    managed: false,
};

const job = (overrides: Partial<InstallJob> = {}): InstallJob => ({
    id: 'j1',
    engine: 'chatterbox',
    kind: 'install',
    state: 'running',
    createdAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
});

const envelope = (code: string, message: string) => ({ error: { code, message, retryable: false } });

describe('installing from the page', () => {
    let jobs: InstallJob[];

    beforeEach(() => {
        FakeEventSource.install();
        jobs = [];
        for (const mock of Object.values(api)) mock.mockReset();
        api.catalog.mockResolvedValue([chatterbox]);
        api.installJobs.mockImplementation(async () => ({ status: 200, data: jobs }));
        api.installJob.mockImplementation(async (id: string) => ({ status: 200, data: jobs.find(candidate => candidate.id === id) }));
        api.engines.mockResolvedValue([]);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('shows both licences before installing, then follows the job to its end', async () => {
        const user = setupUser();
        api.installEngine.mockImplementation(async () => {
            jobs = [job()];
            return { status: 202, data: jobs[0] };
        });
        render(<CatalogPage />);

        await user.click(await screen.findByRole('button', { name: 'Install' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/Weights/)).toBeInTheDocument();
        await user.click(within(dialog).getByRole('checkbox', { name: 'Download the turbo weights too' }));
        await user.click(within(dialog).getByRole('button', { name: 'Install under these licences' }));

        expect(api.installEngine).toHaveBeenCalledWith('chatterbox', { accept: 'MIT' });
        expect(await screen.findByText('Installing Chatterbox')).toBeInTheDocument();
        await waitFor(() => expect(FakeEventSource.latest().url).toBe('/api/installs/j1/events'));

        const stream = FakeEventSource.latest();
        act(() => {
            stream.emit({ kind: 'progress', correlationId: 'j1', progress: { phase: 'packages', index: 2, total: 4, status: 'running' } });
            stream.emit({ kind: 'log', correlationId: 'j1', message: 'Successfully installed rhapsode-engine-chatterbox-0.0.0' });
        });
        expect(await screen.findByText(/Successfully installed rhapsode-engine-chatterbox/)).toBeInTheDocument();
        // A screen reader hears the step, which the stepper shows only in colour, and the started job has focus.
        expect(screen.getByRole('status')).toHaveTextContent('Installing Chatterbox: Packages');
        expect(screen.getByRole('generic', { name: 'The job shown' })).toHaveFocus();

        jobs = [job({ state: 'succeeded', step: 'register' })];
        api.catalog.mockResolvedValue([{ ...chatterbox, installed: 'yes', managed: true }]);
        act(() => {
            stream.emit({ kind: 'progress', correlationId: 'j1', progress: { phase: 'register', index: 4, total: 4, status: 'done' } });
        });

        expect(await screen.findByText('Chatterbox is ready.', { exact: false })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Install Chatterbox: Done');
        expect(stream.closed).toBe(true);
        expect(await screen.findByRole('button', { name: 'Uninstall' })).toBeInTheDocument();
    });

    it('downloads the default weights in the same job unless told not to, and shows it as a fifth step', async () => {
        const user = setupUser();
        api.installEngine.mockImplementation(async () => {
            jobs = [job({ variant: 'turbo', step: 'weights' })];
            return { status: 202, data: jobs[0] };
        });
        render(<CatalogPage />);

        await user.click(await screen.findByRole('button', { name: 'Install' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('checkbox', { name: 'Download the turbo weights too' })).toBeChecked();
        await user.click(within(dialog).getByRole('button', { name: 'Install under these licences' }));

        expect(api.installEngine).toHaveBeenCalledWith('chatterbox', { pull: 'turbo', accept: 'MIT' });
        expect(await screen.findByText('Weights')).toBeInTheDocument();

        jobs = [job({ variant: 'turbo', step: 'weights', state: 'succeeded' })];
        act(() => {
            FakeEventSource.latest().emit({
                kind: 'progress',
                correlationId: 'j1',
                progress: { phase: 'weights', index: 5, total: 5, status: 'done' },
            });
        });
        expect(await screen.findByText(/with the turbo weights on this machine/)).toBeInTheDocument();
    });

    it('says the engine is installed when only its download failed', async () => {
        jobs = [
            job({
                variant: 'turbo',
                state: 'failed',
                step: 'weights',
                error: { code: 'model_unavailable', message: 'the worker did not answer POST /fetch', retryable: true },
            }),
        ];
        render(<CatalogPage />);

        expect(await screen.findByText('Failed at the weights step')).toBeInTheDocument();
        expect(screen.getByText(/Chatterbox is installed; download the weights again from its card/)).toBeInTheDocument();
    });

    it('shows a sixth step once the job warms a variant that compiles, and says it is compiled', async () => {
        jobs = [job({ variant: 'full', step: 'warm', state: 'succeeded' })];
        render(<CatalogPage />);

        expect(await screen.findByText('Warm')).toBeInTheDocument();
        expect(screen.getByText(/with the full weights on this machine and compiled/)).toBeInTheDocument();
    });

    it('names a warm job, and says the variant is compiled once it is', async () => {
        jobs = [job({ kind: 'warm', variant: 'full', step: 'warm', state: 'succeeded' })];
        render(<CatalogPage />);

        expect(await screen.findByText('Warm Chatterbox full')).toBeInTheDocument();
        expect(await screen.findByText(/Chatterbox full is compiled, so its first request loads it from the cache/)).toBeInTheDocument();
    });

    it('says the engine is installed with its weights when only its warm failed', async () => {
        jobs = [
            job({
                variant: 'full',
                state: 'failed',
                step: 'warm',
                error: { code: 'model_unavailable', message: 'No available memory for the cache blocks', retryable: true },
            }),
        ];
        render(<CatalogPage />);

        expect(await screen.findByText('Failed at the warm step')).toBeInTheDocument();
        expect(screen.getByText(/Chatterbox is installed with its weights; its first request tries that load again/)).toBeInTheDocument();
    });

    it('shows the core’s own reason when a job fails', async () => {
        jobs = [
            job({
                state: 'failed',
                step: 'packages',
                error: { code: 'internal', message: 'pip exited 1: No matching distribution found', retryable: false },
            }),
        ];
        render(<CatalogPage />);

        expect(await screen.findByText('Failed at the packages step')).toBeInTheDocument();
        expect(screen.getByText('pip exited 1: No matching distribution found')).toBeInTheDocument();
    });

    it('warns about weights that may not be used commercially, and accepts their licence by name', async () => {
        const user = setupUser();
        api.catalog.mockResolvedValue([{ ...chatterbox, license: { code: 'MIT', weights: 'CC-BY-NC-4.0', weightsCommercialUse: false } }]);
        api.installEngine.mockImplementation(async () => {
            jobs = [job()];
            return { status: 202, data: jobs[0] };
        });
        render(<CatalogPage />);

        await user.click(await screen.findByRole('button', { name: 'Install' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Check the weights licence')).toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: 'Install under these licences' }));

        expect(api.installEngine).toHaveBeenCalledWith('chatterbox', { pull: 'turbo', accept: 'CC-BY-NC-4.0' });
    });

    it('keeps the dialog open with the refusal when the install does not start', async () => {
        const user = setupUser();
        api.installEngine.mockResolvedValue({ status: 409, data: envelope('conflict', '"chatterbox" is configured in the operator\'s config file') });
        render(<CatalogPage />);

        await user.click(await screen.findByRole('button', { name: 'Install' }));
        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Install under these licences' }));

        expect(await within(screen.getByRole('dialog')).findByText(/configured in the operator's config file/)).toBeInTheDocument();
    });

    it('offers no install buttons to a page the core will not take them from, and says why', async () => {
        api.installJobs.mockResolvedValue({ status: 403, data: envelope('forbidden', 'management routes answer loopback callers') });
        render(<CatalogPage />);

        expect(await screen.findByText('Installing is only for the machine running rhapsode')).toBeInTheDocument();
        expect(screen.getByText('management routes answer loopback callers')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    });

    it('offers uninstall only for an engine this page installed', async () => {
        api.catalog.mockResolvedValue([{ ...chatterbox, installed: 'yes', managed: false }]);
        render(<CatalogPage />);

        expect(await screen.findByRole('button', { name: 'Download turbo weights' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Uninstall' })).not.toBeInTheDocument();
    });

    it('asks before uninstalling, and says the weights stay', async () => {
        const user = setupUser();
        api.catalog.mockResolvedValue([{ ...chatterbox, installed: 'yes', managed: true }]);
        api.uninstallEngine.mockResolvedValue({ status: 204 });
        render(<CatalogPage />);

        await user.click(await screen.findByRole('button', { name: 'Uninstall' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/Downloaded weights stay/)).toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));

        await waitFor(() => expect(api.uninstallEngine).toHaveBeenCalledWith('chatterbox'));
    });

    it('says an engine that does not fetch ahead of time needed nothing, rather than that it failed', async () => {
        jobs = [
            job({
                kind: 'pull',
                variant: 'plain',
                engine: 'tone',
                state: 'failed',
                step: 'weights',
                error: { code: 'unsupported', message: 'no', retryable: false },
            }),
        ];
        render(<CatalogPage />);

        expect(await screen.findByText('Nothing to download ahead of time')).toBeInTheDocument();
        expect(screen.queryByText('Failed at the weights step')).not.toBeInTheDocument();
    });

    describe('warming a variant that compiles', () => {
        const installed: CatalogEntry = { ...chatterbox, installed: 'yes', managed: true };
        const variant = (compiles?: boolean) => ({ cues: [], deliveries: [], dials: {}, ...(compiles ? { compiles } : {}) });
        const capabilities = { status: 200, data: { variants: { turbo: variant(true), original: variant() } } };

        beforeEach(() => {
            api.engineCapabilities.mockResolvedValue(capabilities);
        });

        it('offers it on the card of an engine whose worker is up, and warms it once the dialog has said what it costs', async () => {
            const user = setupUser();
            api.catalog.mockResolvedValue([installed]);
            api.engines.mockResolvedValue([{ id: 'chatterbox', process: 'up', model: 'unloaded' }]);
            api.warmEngine.mockImplementation(async () => {
                jobs = [job({ kind: 'warm', variant: 'turbo', step: 'warm' })];
                return { status: 202, data: jobs[0] };
            });
            render(<CatalogPage />);

            await user.click(await screen.findByRole('button', { name: 'Warm turbo' }));
            const dialog = await screen.findByRole('dialog');
            expect(within(dialog).getByText(/evicting an idle model/)).toBeInTheDocument();
            await user.click(within(dialog).getByRole('button', { name: 'Warm' }));

            await waitFor(() => expect(api.warmEngine).toHaveBeenCalledWith('chatterbox', { variant: 'turbo' }));
            expect((await screen.findAllByText('Warming Chatterbox turbo')).length).toBeGreaterThan(0);
        });

        it('starts no worker to ask: an engine whose worker is down offers nothing', async () => {
            api.catalog.mockResolvedValue([installed]);
            api.engines.mockResolvedValue([{ id: 'chatterbox', process: 'down', model: 'unloaded' }]);
            render(<CatalogPage />);

            expect(await screen.findByRole('button', { name: 'Uninstall' })).toBeInTheDocument();
            expect(api.engineCapabilities).not.toHaveBeenCalled();
            expect(screen.queryByRole('button', { name: /^Warm/ })).not.toBeInTheDocument();
        });

        it('offers nothing for what was warmed, or for an engine configured by hand', async () => {
            api.catalog.mockResolvedValue([
                { ...installed, warmed: ['turbo'] },
                { ...chatterbox, id: 'mine', displayName: 'Mine', installed: 'yes', managed: false },
            ]);
            api.engines.mockResolvedValue([
                { id: 'chatterbox', process: 'up', model: 'unloaded' },
                { id: 'mine', process: 'up', model: 'unloaded' },
            ]);
            render(<CatalogPage />);

            await waitFor(() => expect(api.engineCapabilities).toHaveBeenCalledWith('chatterbox'));
            expect(api.engineCapabilities).not.toHaveBeenCalledWith('mine');
            expect(screen.queryByRole('button', { name: /^Warm/ })).not.toBeInTheDocument();
        });

        it('offers it once a reinstall succeeds, whose new worker the card cannot see', async () => {
            api.catalog.mockResolvedValue([installed]);
            jobs = [job({ kind: 'reinstall', state: 'succeeded', step: 'register' })];
            render(<CatalogPage />);

            expect(await screen.findByText(/now runs from a virtualenv this server built/)).toBeInTheDocument();
            expect(await screen.findByRole('button', { name: 'Warm turbo' })).toBeInTheDocument();
        });
    });

    describe('reinstalling what an upgrade left behind', () => {
        const stale: CatalogEntry = { ...chatterbox, installed: 'yes', managed: true, workerVersion: '0.1.2', outdated: true };

        it('marks the engine, and reinstalls it once the dialog has said what it costs', async () => {
            const user = setupUser();
            api.catalog.mockResolvedValue([stale]);
            api.reinstallEngine.mockImplementation(async () => {
                jobs = [job({ kind: 'reinstall' })];
                return { status: 202, data: jobs[0] };
            });
            render(<CatalogPage />);

            expect(await screen.findByText('Behind this server')).toBeInTheDocument();
            expect(screen.getByText(/Its worker is from rhapsode 0.1.2/)).toBeInTheDocument();
            const card = screen.getByText('rhapsode-engine-chatterbox').closest('.mantine-Card-root') as HTMLElement;
            await user.click(within(card).getByRole('button', { name: 'Reinstall' }));

            const dialog = await screen.findByRole('dialog');
            expect(within(dialog).getByText(/Its next request loads the model again/)).toBeInTheDocument();
            await user.click(within(dialog).getByRole('button', { name: 'Reinstall' }));

            expect(api.reinstallEngine).toHaveBeenCalledWith('chatterbox', { accept: 'MIT' });
            expect(await screen.findByText('Reinstalling Chatterbox')).toBeInTheDocument();
        });

        it('shows weights that may not be used commercially before a reinstall accepts them', async () => {
            const user = setupUser();
            const license = { code: 'MIT', weights: 'CC-BY-NC-4.0', weightsCommercialUse: false };
            api.catalog.mockResolvedValue([{ ...stale, license }]);
            api.reinstallEngine.mockResolvedValue({ status: 202, data: job({ kind: 'reinstall' }) });
            render(<CatalogPage />);

            const card = (await screen.findByText('rhapsode-engine-chatterbox')).closest('.mantine-Card-root') as HTMLElement;
            await user.click(within(card).getByRole('button', { name: 'Reinstall' }));
            const dialog = await screen.findByRole('dialog');
            expect(within(dialog).getByText('Reinstalling accepts the weights licence as it stands now.')).toBeInTheDocument();
            await user.click(within(dialog).getByRole('button', { name: 'Reinstall' }));

            expect(api.reinstallEngine).toHaveBeenCalledWith('chatterbox', { accept: 'CC-BY-NC-4.0' });
        });

        it('reinstalls everything behind with one request, and follows the first job', async () => {
            const user = setupUser();
            api.catalog.mockResolvedValue([stale]);
            api.reinstallOutdated.mockImplementation(async () => {
                jobs = [job({ kind: 'reinstall', state: 'queued' })];
                return { status: 202, data: { jobs, skipped: [] } };
            });
            render(<CatalogPage />);

            expect(await screen.findByText('One engine was installed by an earlier release')).toBeInTheDocument();
            await user.click(screen.getByRole('button', { name: 'Reinstall all' }));
            // Asked first, like the one reinstall it is several of.
            expect(api.reinstallOutdated).not.toHaveBeenCalled();
            const dialog = await screen.findByRole('dialog');
            expect(within(dialog).getByText(/Chatterbox: each gets a new virtualenv/)).toBeInTheDocument();
            await user.click(within(dialog).getByRole('button', { name: 'Reinstall all' }));

            expect(api.reinstallOutdated).toHaveBeenCalledTimes(1);
            expect(await screen.findByText('Reinstalling Chatterbox')).toBeInTheDocument();
        });

        it('offers nothing for an engine the operator configured, and says whose it is', async () => {
            api.catalog.mockResolvedValue([{ ...stale, managed: false }]);
            render(<CatalogPage />);

            expect(await screen.findByText(/rebuilding it is the operator’s to do/)).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Reinstall' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Reinstall all' })).not.toBeInTheDocument();
        });

        it('does not claim the old virtualenv is running when only the warm after the swap failed', async () => {
            api.catalog.mockResolvedValue([stale]);
            jobs = [job({ kind: 'reinstall', state: 'failed', step: 'warm', error: { code: 'internal', message: 'load failed', retryable: false } })];
            render(<CatalogPage />);

            expect(await screen.findByText(/Chatterbox is reinstalled; its first request tries that load again/)).toBeInTheDocument();
            expect(screen.queryByText(/is still running from its previous virtualenv/)).not.toBeInTheDocument();
        });

        it('says a failed reinstall left the engine running as it was', async () => {
            api.catalog.mockResolvedValue([stale]);
            jobs = [
                job({
                    kind: 'reinstall',
                    state: 'failed',
                    step: 'packages',
                    error: { code: 'internal', message: 'pip exited 1', retryable: false },
                }),
            ];
            render(<CatalogPage />);

            expect(await screen.findByText(/is still running from its previous virtualenv/)).toBeInTheDocument();
        });
    });
});
