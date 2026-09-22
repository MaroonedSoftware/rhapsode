import {
    CatalogEntry,
    EngineSummary,
    FeedEvent,
    InstallJob,
    ReinstallOutdated,
    ResidencyDetail,
    Settings,
    UpdateStatus,
    type SettingsPatch,
    type License,
} from '@rhapsode/contract';

/**
 * A client for the management routes in protocol.md § 10, and nothing else.
 *
 * The wizard holds no install logic of its own: everything it does, a web page does through the
 * same routes. That is what keeps the two from drifting, and it is why this file is small.
 */

/** A refusal the server explained, with the protocol's code. */
export class ManagementError extends Error {
    constructor(
        message: string,
        readonly code: string | undefined,
        readonly status: number,
    ) {
        super(message);
        this.name = 'ManagementError';
    }
}

/** Nothing answered. The one failure where the fix is not in the response: start the server. */
export class ServerUnreachable extends Error {
    constructor(
        readonly base: string,
        options?: { cause?: unknown },
    ) {
        super(`nothing is answering at ${base}`, options);
        this.name = 'ServerUnreachable';
    }
}

/** Loopback by address rather than `localhost`, which can resolve to an address the guard refuses. */
export const serverBase = (port: number, override?: string): string => (override ?? `http://127.0.0.1:${port}`).replace(/\/+$/, '');

/** Both licences on one line, weights named separately, because that is the one that decides. */
export const describeLicense = (license: License): string =>
    `code ${license.code}, weights ${license.weights} (${license.weightsCommercialUse ? 'commercial use allowed' : 'NOT for commercial use'})`;

/** A job's last event: a `progress` whose status is no longer `running`. The client closes on it. */
export const isFinal = (event: FeedEvent): boolean => event.kind === 'progress' && event.progress?.status !== 'running';

export interface SseFrame {
    id?: number;
    event?: string;
    data?: string;
}

/**
 * Server-sent events, parsed as they arrive.
 *
 * A chunk can end mid-frame, so what does not yet end in a blank line is held for the next one.
 * Comments (the heartbeat) produce no frame.
 */
export class SseFrames {
    private buffered = '';

    push(chunk: string): SseFrame[] {
        this.buffered += chunk.replace(/\r\n/g, '\n');
        const frames: SseFrame[] = [];
        let boundary: number;
        while ((boundary = this.buffered.indexOf('\n\n')) !== -1) {
            const block = this.buffered.slice(0, boundary);
            this.buffered = this.buffered.slice(boundary + 2);
            const frame: SseFrame = {};
            const data: string[] = [];
            for (const line of block.split('\n')) {
                if (line.startsWith(':')) continue;
                const colon = line.indexOf(':');
                const field = colon === -1 ? line : line.slice(0, colon);
                const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
                if (field === 'id') frame.id = Number(value);
                else if (field === 'event') frame.event = value;
                else if (field === 'data') data.push(value);
            }
            if (data.length > 0) frame.data = data.join('\n');
            if (frame.data !== undefined || frame.event !== undefined) frames.push(frame);
        }
        return frames;
    }
}

export class ManagementClient {
    constructor(
        readonly base: string,
        private readonly token?: string,
    ) {}

    async catalog(): Promise<CatalogEntry[]> {
        return CatalogEntry.array().parse(await this.json('GET', '/catalog'));
    }

    /** With `pull`, a variant, the same job downloads it once the engine is registered. protocol.md § 10. */
    /** `accept` is the weights licence, as the catalog names it, that a person said yes to. § 10. */
    async install(engine: string, accept: string, pull?: string): Promise<InstallJob> {
        const query = `?accept=${encodeURIComponent(accept)}${pull === undefined ? '' : `&pull=${encodeURIComponent(pull)}`}`;
        return InstallJob.parse(await this.json('POST', `/engines/${encodeURIComponent(engine)}/install${query}`));
    }

    /**
     * Rebuild an installed engine beside itself. `accept` only where the server asked for it: it
     * knows what the last install accepted, and the client does not. § 10.
     */
    async reinstall(engine: string, accept?: string): Promise<InstallJob> {
        const query = accept === undefined ? '' : `?accept=${encodeURIComponent(accept)}`;
        return InstallJob.parse(await this.json('POST', `/engines/${encodeURIComponent(engine)}/reinstall${query}`));
    }

    /** A reinstall for every outdated engine this server installed, and what it skipped. § 10. */
    async reinstallOutdated(): Promise<ReinstallOutdated> {
        return ReinstallOutdated.parse(await this.json('POST', '/installs/outdated'));
    }

    /** What this box has, each with `outdated` where the core can say. § 9. */
    async engines(): Promise<EngineSummary[]> {
        return EngineSummary.array().parse(await this.json('GET', '/engines'));
    }

    /** Whether a newer release exists, as the core last heard. Never waits on GitHub. § 9. */
    async updateStatus(): Promise<UpdateStatus> {
        return UpdateStatus.parse(await this.json('GET', '/update'));
    }

    async pull(engine: string, variant?: string): Promise<InstallJob> {
        return InstallJob.parse(await this.json('POST', `/engines/${encodeURIComponent(engine)}/pull`, variant === undefined ? {} : { variant }));
    }

    async job(id: string): Promise<InstallJob> {
        return InstallJob.parse(await this.json('GET', `/installs/${encodeURIComponent(id)}`));
    }

    /** What is on the card. A read of the core's own state: it starts nothing. protocol.md § 3. */
    async residency(): Promise<ResidencyDetail> {
        return ResidencyDetail.parse(await this.json('GET', '/residency'));
    }

    /** Free a model now. `terminate` is the only mode that gets the whole card back. § 3. */
    async unload(engine: string, mode: 'terminate' | 'unload' = 'terminate'): Promise<EngineSummary> {
        const query = mode === 'terminate' ? '' : `?mode=${mode}`;
        return EngineSummary.parse(await this.json('POST', `/engines/${encodeURIComponent(engine)}/unload${query}`));
    }

    /** Every setting, where each came from, and what waits for a restart. Never the token. § 10. */
    async settings(): Promise<Settings> {
        return Settings.parse(await this.json('GET', '/settings'));
    }

    /** Change some settings; `null` clears one. Answers every setting as it stands after. § 10. */
    async updateSettings(patch: SettingsPatch): Promise<Settings> {
        return Settings.parse(await this.json('PATCH', '/settings', patch));
    }

    /** Stream a job's events to `onEvent` until its last one, then hang up and return the job. */
    async follow(id: string, onEvent: (event: FeedEvent) => void): Promise<InstallJob> {
        const controller = new AbortController();
        const response = await this.send('GET', `/installs/${encodeURIComponent(id)}/events`, undefined, controller.signal);
        if (response.body === null) throw new ManagementError('the events stream had no body', undefined, response.status);

        const frames = new SseFrames();
        const decoder = new TextDecoder();
        try {
            for await (const chunk of response.body) {
                for (const frame of frames.push(decoder.decode(chunk, { stream: true }))) {
                    if (frame.event !== 'server.feed' || frame.data === undefined) continue;
                    const event = FeedEvent.parse(JSON.parse(frame.data));
                    onEvent(event);
                    if (isFinal(event)) return await this.job(id);
                }
            }
        } finally {
            controller.abort();
        }
        // The server closed first, which it only does on shutdown. The job says how far it got.
        return this.job(id);
    }

    private async json(method: string, path: string, body?: unknown): Promise<unknown> {
        const response = await this.send(method, path, body);
        return response.json();
    }

    private async send(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
        const headers: Record<string, string> = {};
        if (body !== undefined) headers['content-type'] = 'application/json';
        if (this.token !== undefined && this.token !== '') headers.authorization = `Bearer ${this.token}`;

        let response: Response;
        try {
            response = await fetch(`${this.base}${path}`, {
                method,
                headers,
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                ...(signal === undefined ? {} : { signal }),
            });
        } catch (error) {
            throw new ServerUnreachable(this.base, { cause: error });
        }

        if (!response.ok) {
            const parsed = (await response.json().catch(() => undefined)) as { error?: { code?: string; message?: string } } | undefined;
            throw new ManagementError(
                parsed?.error?.message ?? `${method} ${path} answered ${response.status}`,
                parsed?.error?.code,
                response.status,
            );
        }
        return response;
    }
}
