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

    /**
     * @name Health
     * @description The core's own health, which answers even while every worker is down.
     */
    async health(): Promise<CoreHealth> {
        const result = await this.fetch(`/health`, { method: 'GET' });
        return await parseJson<CoreHealth>(result);
    }

    /**
     * @name Update status
     * @description Whether a newer rhapsode has been released, from a check made at most once a day.
     */
    async updateStatus(): Promise<UpdateStatus> {
        const result = await this.fetch(`/update`, { method: 'GET' });
        return await parseJson<UpdateStatus>(result);
    }

    /**
     * @name Check for an update
     * @description Asks GitHub for the latest release now, and answers once it has.
     */
    async checkForUpdate(): Promise<UpdateStatus> {
        const result = await this.fetch(`/update/check`, { method: 'POST' });
        return await parseJson<UpdateStatus>(result);
    }

    /**
     * @name Residency
     * @description What each engine holds in memory, how big it is and when it expires.
     */
    async residency(): Promise<ResidencyDetail> {
        const result = await this.fetch(`/residency`, { method: 'GET' });
        return await parseJson<ResidencyDetail>(result);
    }

    /**
     * @name OpenAPI document
     * @description This API as an OpenAPI 3.1 document, describing the core that serves it.
     */
    async openapi(): Promise<OpenApiDocument> {
        const result = await this.fetch(`/openapi.json`, { method: 'GET' });
        return await parseJson<OpenApiDocument>(result);
    }

    /**
     * @name Engines
     * @description Every declared engine, running or not, with its code and weights licences.
     */
    async engines(): Promise<EngineSummary[]> {
        const result = await this.fetch(`/engines`, { method: 'GET' });
        return await parseJson<EngineSummary[]>(result);
    }

    /**
     * @name Engine capabilities
     * @description What the engine can do with the variant it has loaded, and what its other variants could.
     */
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

    /**
     * @name Voices
     * @description The engine's voices, built in and cloned.
     */
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

    /**
     * @name Create a voice
     * @description Creates a voice from a reference, such as a clip to clone, or from a blend of voices the engine has.
     */
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

    /**
     * @name Delete a voice
     * @description Deletes a voice.
     */
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

    /**
     * @name Voice preview
     * @description A short sample of the voice.
     */
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

    /**
     * @name Speak
     * @description Speaks a line with one engine, streamed or as a finished file.
     */
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

    /**
     * @name Dialogue
     * @description A conversation between speakers in one take, on a variant that declares dialogue.
     */
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

    /**
     * @name Catalog
     * @description Every engine this core knows how to install, with both licences, before anything is installed.
     */
    async catalog(): Promise<CatalogEntry[]> {
        const result = await this.fetch(`/catalog`, { method: 'GET' });
        return await parseJson<CatalogEntry[]>(result);
    }

    /**
     * @name Uninstall an engine
     * @description Removes an engine this API installed.
     */
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

    /**
     * @name Unload an engine
     * @description Frees the engine's model now, rather than waiting out its keep-alive.
     */
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

    /**
     * @name Install an engine
     * @description Installs an engine from the catalog, as a job to follow.
     */
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

    /**
     * @name Reinstall an engine
     * @description Rebuilds an installed engine beside the old one and swaps it in once it works.
     */
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

    /**
     * @name Pull weights
     * @description Downloads a variant's weights ahead of its first load, as a job to follow.
     */
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

    /**
     * @name Install jobs
     * @description Every install job, running and finished.
     */
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

    /**
     * @name Reinstall outdated engines
     * @description Reinstalls every engine an upgrade left behind.
     */
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

    /**
     * @name Install job
     * @description One install job and where it has got to.
     */
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

    /**
     * @name Install job events
     * @description An install job's progress and output as server-sent events.
     */
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

    /**
     * @name Settings
     * @description Every setting, its value, where the value came from and whether a change applies now.
     */
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

    /**
     * @name Update settings
     * @description Changes settings in one transaction, and answers the whole document after the write.
     */
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
