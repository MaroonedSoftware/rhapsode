import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson, buildQueryString, readContentType } from '../sdk-options.js';
import type {
    Capabilities,
    CatalogEntry,
    CoreHealth,
    EngineDialogueRequest,
    EngineSpeakRequest,
    EngineSummary,
    ErrorBody,
    InstallJob,
    PullRequest,
    ReinstallOutdated,
    ResidencyDetail,
    UpdateStatus,
    Voice,
} from '../rhapsode/types/rhapsode.types.js';
import type { OpenApiDocument, Settings, SettingsPatch } from './types/rhapsode.public.js';

export class PublicClient {
    constructor(private fetch: SdkFetch) {}

    /** @description The core's own. It answers while every worker is down and never blocks on one, because a */
    async health(): Promise<CoreHealth> {
        const result = await this.fetch(`/health`, { method: 'GET' });
        return await parseJson<CoreHealth>(result);
    }

    /** @description Open to every caller, like /health. It never waits on the network: a first call after boot */
    async updateStatus(): Promise<UpdateStatus> {
        const result = await this.fetch(`/update`, { method: 'GET' });
        return await parseJson<UpdateStatus>(result);
    }

    /** @description What is on the card, for an operator asking where their memory went. Reads the core's own */
    async residency(): Promise<ResidencyDetail> {
        const result = await this.fetch(`/residency`, { method: 'GET' });
        return await parseJson<ResidencyDetail>(result);
    }

    /** @description Open to every caller, like /health. The public API only: never a worker route. */
    async openapi(): Promise<OpenApiDocument> {
        const result = await this.fetch(`/openapi.json`, { method: 'GET' });
        return await parseJson<OpenApiDocument>(result);
    }

    /** @description Every declared engine, whether or not it is running. Never spawns one: this is the list an */
    async engines(): Promise<EngineSummary[]> {
        const result = await this.fetch(`/engines`, { method: 'GET' });
        return await parseJson<EngineSummary[]>(result);
    }

    async engineCapabilities(
        engine: string,
    ): Promise<
        | { status: 200; contentType: 'application/json'; data: Capabilities }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
        | { status: 503; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/engines/${encodeURIComponent(engine)}/capabilities`, {
            method: 'GET',
            expectStatuses: [404, 503],
        });
        switch (result.status) {
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 503:
                return { status: 503, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 200, contentType: 'application/json', data: await parseJson<Capabilities>(result) };
        }
    }

    async engineVoices(
        engine: string,
    ): Promise<{ status: 200; contentType: 'application/json'; data: Voice[] } | { status: 404; contentType: 'application/json'; data: ErrorBody }> {
        const result = await this.fetch(`/engines/${encodeURIComponent(engine)}/voices`, {
            method: 'GET',
            expectStatuses: [404],
        });
        switch (result.status) {
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 200, contentType: 'application/json', data: await parseJson<Voice[]>(result) };
        }
    }

    /** @description Management, like § 10: it writes a file on the box. Streamed to the worker, capped at 25 MB. */
    async createVoice(
        engine: string,
        body: FormData,
    ): Promise<
        | { status: 201; contentType: 'application/json'; data: Voice }
        | { status: 400; contentType: 'application/json'; data: ErrorBody }
        | { status: 403; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
        | { status: 422; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/engines/${encodeURIComponent(engine)}/voices`, {
            method: 'POST',
            body: body,
            expectStatuses: [400, 403, 404, 422],
        });
        switch (result.status) {
            case 400:
                return { status: 400, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 422:
                return { status: 422, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 201, contentType: 'application/json', data: await parseJson<Voice>(result) };
        }
    }

    async deleteVoice(
        engine: string,
        voice: string,
    ): Promise<
        | { status: 204 }
        | { status: 400; contentType: 'application/json'; data: ErrorBody }
        | { status: 403; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
        | { status: 422; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/engines/${encodeURIComponent(engine)}/voices/${encodeURIComponent(voice)}`, {
            method: 'DELETE',
            expectStatuses: [400, 403, 404, 422],
        });
        switch (result.status) {
            case 400:
                return { status: 400, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 422:
                return { status: 422, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 204 };
        }
    }

    async voicePreview(
        engine: string,
        voice: string,
    ): Promise<{ status: 200; contentType: 'audio/wav'; data: Blob } | { status: 404; contentType: 'application/json'; data: ErrorBody }> {
        const result = await this.fetch(`/engines/${encodeURIComponent(engine)}/voices/${encodeURIComponent(voice)}/preview`, {
            method: 'GET',
            expectStatuses: [404],
        });
        switch (result.status) {
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 200, contentType: 'audio/wav', data: await result.blob() };
        }
    }

    /** @description The one endpoint that matters. Cues the effective variant does not claim are stripped */
    async speak(
        body: EngineSpeakRequest,
    ): Promise<
        | { status: 200; contentType: 'audio/wav' | 'audio/mpeg' | 'audio/opus' | 'audio/flac' | 'audio/l16'; data: Blob }
        | { status: 400; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
        | { status: 422; contentType: 'application/json'; data: ErrorBody }
        | { status: 429; contentType: 'application/json'; data: ErrorBody }
        | { status: 503; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/speak`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
            expectStatuses: [400, 404, 422, 429, 503],
        });
        switch (result.status) {
            case 400:
                return { status: 400, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 422:
                return { status: 422, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 429:
                return { status: 429, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 503:
                return { status: 503, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return {
                    status: 200,
                    contentType: readContentType(result) as 'audio/wav' | 'audio/mpeg' | 'audio/opus' | 'audio/flac' | 'audio/l16',
                    data: await result.blob(),
                };
        }
    }

    /** @description A conversation in one take, on a variant that declares `dialogue`. Cues are stripped per */
    async dialogue(
        engine: string,
        body: EngineDialogueRequest,
    ): Promise<
        | { status: 200; contentType: 'audio/wav' | 'audio/mpeg' | 'audio/opus' | 'audio/flac' | 'audio/l16'; data: Blob }
        | { status: 400; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
        | { status: 422; contentType: 'application/json'; data: ErrorBody }
        | { status: 429; contentType: 'application/json'; data: ErrorBody }
        | { status: 503; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/engines/${encodeURIComponent(engine)}/dialogue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
            expectStatuses: [400, 404, 422, 429, 503],
        });
        switch (result.status) {
            case 400:
                return { status: 400, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 422:
                return { status: 422, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 429:
                return { status: 429, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 503:
                return { status: 503, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return {
                    status: 200,
                    contentType: readContentType(result) as 'audio/wav' | 'audio/mpeg' | 'audio/opus' | 'audio/flac' | 'audio/l16',
                    data: await result.blob(),
                };
        }
    }

    /** @description Open to every caller: it only reads, and its licences are what § 4 promises before install. */
    async catalog(): Promise<CatalogEntry[]> {
        const result = await this.fetch(`/catalog`, { method: 'GET' });
        return await parseJson<CatalogEntry[]>(result);
    }

    /** @description Only an engine this API installed. One the operator configured is theirs to remove. */
    async uninstallEngine(
        engine: string,
    ): Promise<
        | { status: 204 }
        | { status: 403; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
        | { status: 409; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/engines/${encodeURIComponent(engine)}`, {
            method: 'DELETE',
            expectStatuses: [403, 404, 409],
        });
        switch (result.status) {
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 409:
                return { status: 409, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 204 };
        }
    }

    /** @description Free this engine's model now, rather than waiting out its keep-alive. Idempotent: an */
    async unloadEngine(
        engine: string,
        query?: { mode?: 'terminate' | 'unload' },
    ): Promise<
        | { status: 200; contentType: 'application/json'; data: EngineSummary }
        | { status: 403; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
        | { status: 409; contentType: 'application/json'; data: ErrorBody }
    > {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/engines/${encodeURIComponent(engine)}/unload${qs}`, {
            method: 'POST',
            expectStatuses: [403, 404, 409],
        });
        switch (result.status) {
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 409:
                return { status: 409, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 200, contentType: 'application/json', data: await parseJson<EngineSummary>(result) };
        }
    }

    async installEngine(
        engine: string,
        query?: { pull?: string; accept?: string },
    ): Promise<
        | { status: 202; contentType: 'application/json'; data: InstallJob }
        | { status: 400; contentType: 'application/json'; data: ErrorBody }
        | { status: 403; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
        | { status: 409; contentType: 'application/json'; data: ErrorBody }
    > {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/engines/${encodeURIComponent(engine)}/install${qs}`, {
            method: 'POST',
            expectStatuses: [400, 403, 404, 409],
        });
        switch (result.status) {
            case 400:
                return { status: 400, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 409:
                return { status: 409, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 202, contentType: 'application/json', data: await parseJson<InstallJob>(result) };
        }
    }

    async reinstallEngine(
        engine: string,
        query?: { accept?: string },
    ): Promise<
        | { status: 202; contentType: 'application/json'; data: InstallJob }
        | { status: 400; contentType: 'application/json'; data: ErrorBody }
        | { status: 403; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
        | { status: 409; contentType: 'application/json'; data: ErrorBody }
    > {
        const qs = buildQueryString(query);
        const result = await this.fetch(`/engines/${encodeURIComponent(engine)}/reinstall${qs}`, {
            method: 'POST',
            expectStatuses: [400, 403, 404, 409],
        });
        switch (result.status) {
            case 400:
                return { status: 400, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 409:
                return { status: 409, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 202, contentType: 'application/json', data: await parseJson<InstallJob>(result) };
        }
    }

    async pullEngine(
        engine: string,
        body: PullRequest,
    ): Promise<
        | { status: 202; contentType: 'application/json'; data: InstallJob }
        | { status: 403; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
        | { status: 409; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/engines/${encodeURIComponent(engine)}/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
            expectStatuses: [403, 404, 409],
        });
        switch (result.status) {
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 409:
                return { status: 409, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 202, contentType: 'application/json', data: await parseJson<InstallJob>(result) };
        }
    }

    async installJobs(): Promise<
        { status: 200; contentType: 'application/json'; data: InstallJob[] } | { status: 403; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/installs`, {
            method: 'GET',
            expectStatuses: [403],
        });
        switch (result.status) {
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 200, contentType: 'application/json', data: await parseJson<InstallJob[]>(result) };
        }
    }

    async reinstallOutdated(): Promise<
        { status: 202; contentType: 'application/json'; data: ReinstallOutdated } | { status: 403; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/installs/outdated`, {
            method: 'POST',
            expectStatuses: [403],
        });
        switch (result.status) {
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 202, contentType: 'application/json', data: await parseJson<ReinstallOutdated>(result) };
        }
    }

    async installJob(
        job: string,
    ): Promise<
        | { status: 200; contentType: 'application/json'; data: InstallJob }
        | { status: 403; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/installs/${encodeURIComponent(job)}`, {
            method: 'GET',
            expectStatuses: [403, 404],
        });
        switch (result.status) {
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 200, contentType: 'application/json', data: await parseJson<InstallJob>(result) };
        }
    }

    /** @description Server-sent events, each frame's data a FeedEvent. Hand-written, like /speak: ContractKit */
    async installJobEvents(
        job: string,
    ): Promise<
        | { status: 200; contentType: 'text/event-stream'; data: string }
        | { status: 403; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/installs/${encodeURIComponent(job)}/events`, {
            method: 'GET',
            expectStatuses: [403, 404],
        });
        switch (result.status) {
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 200, contentType: 'text/event-stream', data: await result.text() };
        }
    }

    async settings(): Promise<
        { status: 200; contentType: 'application/json'; data: Settings } | { status: 403; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/settings`, {
            method: 'GET',
            expectStatuses: [403],
        });
        switch (result.status) {
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 200, contentType: 'application/json', data: await parseJson<Settings>(result) };
        }
    }

    /** @description One transaction: a patch that is refused changes nothing. Answers the whole document after */
    async updateSettings(
        body: SettingsPatch,
    ): Promise<
        | { status: 200; contentType: 'application/json'; data: Settings }
        | { status: 400; contentType: 'application/json'; data: ErrorBody }
        | { status: 403; contentType: 'application/json'; data: ErrorBody }
        | { status: 404; contentType: 'application/json'; data: ErrorBody }
        | { status: 409; contentType: 'application/json'; data: ErrorBody }
        | { status: 422; contentType: 'application/json'; data: ErrorBody }
    > {
        const result = await this.fetch(`/settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
            expectStatuses: [400, 403, 404, 409, 422],
        });
        switch (result.status) {
            case 400:
                return { status: 400, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 403:
                return { status: 403, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 404:
                return { status: 404, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 409:
                return { status: 409, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            case 422:
                return { status: 422, contentType: 'application/json', data: await parseJson<ErrorBody>(result) };
            default:
                return { status: 200, contentType: 'application/json', data: await parseJson<Settings>(result) };
        }
    }
}
