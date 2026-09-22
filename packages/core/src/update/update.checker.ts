import type { UpdateStatus } from '@rhapsode/contract';
import type { Logger } from '@maroonedsoftware/logger';
import { DateTime, Duration } from 'luxon';

import { CORE_VERSION } from '../core.version.js';
import type { UpdateSettings } from './update.settings.js';
import { isNewer } from './version.compare.js';

/** GitHub's own "latest": neither a draft nor a prerelease, so none is ever offered. § 9. */
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/maroonedsoftware/rhapsode/releases/latest';

/**
 * How long an answer stands. A release a day late costs nothing, and one request a box a day stays
 * far inside the 60 an hour GitHub allows an address without a token, even behind a shared NAT.
 */
const FRESH_FOR = Duration.fromObject({ hours: 24 });
/** Shorter than `FRESH_FOR`, so a box that was offline at its first check does not wait a day. */
const RETRY_AFTER = Duration.fromObject({ hours: 6 });
const TIMEOUT_MS = 10_000;
/**
 * How recent an answer `checkNow` returns rather than asking again. It is an open route, so this is
 * what bounds it: twelve requests an hour however fast it is pressed, a fifth of the sixty GitHub
 * allows an address without a token, so a box behind a shared address cannot spend its neighbours'.
 */
const ASKED_RECENTLY = Duration.fromObject({ minutes: 5 });

type Answer = { outcome: 'ok'; latest: string; releaseUrl?: string; at: DateTime } | { outcome: 'failed'; at: DateTime };

/**
 * Whether a newer release exists, asked of GitHub at most once a day and only when somebody asks.
 *
 * Lazy rather than on a timer: a timer is one more thing a shutdown has to unwind, and a box nobody
 * asks has no reason to phone out. `status()` never waits on the network. It answers with what it
 * has and, when that is missing or stale, starts one check in the background, so a first call after
 * boot reads `pending`. A failure is logged at `debug` and nothing else, because nothing about a
 * release check is worth an operator's attention in a log they read for real faults.
 */
export class UpdateChecker {
    private answer?: Answer;
    private inFlight?: Promise<void>;

    constructor(
        private readonly settings: UpdateSettings,
        private readonly logger: Logger,
        private readonly fetcher: typeof fetch = fetch,
        private readonly now: () => DateTime = () => DateTime.utc(),
        private readonly version: string = CORE_VERSION,
    ) {}

    status(): UpdateStatus {
        const base = { version: this.version, distribution: this.settings.distribution };
        if (!this.settings.check) return { ...base, check: 'off' };

        void this.refreshIfDue();
        const answer = this.answer;
        if (answer === undefined) return { ...base, check: 'pending' };
        if (answer.outcome === 'failed') return { ...base, check: 'failed' };
        return {
            ...base,
            check: 'ok',
            latest: answer.latest,
            updateAvailable: isNewer(answer.latest, this.version),
            ...(answer.releaseUrl === undefined ? {} : { releaseUrl: answer.releaseUrl }),
            checkedAt: answer.at.toISO()!,
        };
    }

    /**
     * Ask GitHub now, for a person who has just been told a release is out, and answer once it has.
     * `POST /update/check`. § 9.
     *
     * Waits on the check in flight rather than starting a second, returns an answer under five
     * minutes old as it is, and asks nothing while the check is turned off. At most the check's own
     * ten-second timeout, because a failure is an answer (`failed`) and not an error.
     */
    async checkNow(): Promise<UpdateStatus> {
        if (this.settings.check) {
            const answer = this.answer;
            if (this.inFlight !== undefined) {
                await this.inFlight;
            } else if (answer === undefined || this.now() >= answer.at.plus(ASKED_RECENTLY)) {
                this.inFlight = this.ask().finally(() => {
                    this.inFlight = undefined;
                });
                await this.inFlight;
            }
        }
        return this.status();
    }

    /** The check in flight, or a new one if the last answer has expired; undefined if neither. */
    refreshIfDue(): Promise<void> | undefined {
        if (!this.settings.check) return undefined;
        if (this.inFlight !== undefined) return this.inFlight;
        const answer = this.answer;
        if (answer !== undefined && this.now() < answer.at.plus(answer.outcome === 'ok' ? FRESH_FOR : RETRY_AFTER)) return undefined;

        this.inFlight = this.ask().finally(() => {
            this.inFlight = undefined;
        });
        return this.inFlight;
    }

    private async ask(): Promise<void> {
        try {
            const response = await this.fetcher(LATEST_RELEASE_URL, {
                headers: {
                    accept: 'application/vnd.github+json',
                    'x-github-api-version': '2022-11-28',
                    // GitHub refuses a request without one. It names the software and nothing about the box.
                    'user-agent': `rhapsode/${this.version}`,
                },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
            const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
            if (typeof body.tag_name !== 'string') throw new Error('the latest release has no tag_name');
            this.answer = {
                outcome: 'ok',
                latest: body.tag_name.replace(/^v/, ''),
                ...(typeof body.html_url === 'string' ? { releaseUrl: body.html_url } : {}),
                at: this.now(),
            };
        } catch (error) {
            this.logger.debug('update check failed', { error: error instanceof Error ? error.message : String(error) });
            this.answer = { outcome: 'failed', at: this.now() };
        }
    }
}
