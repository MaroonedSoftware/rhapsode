import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { RhapsodeJsonLogger } from '../src/logging/rhapsode.logger.js';
import { LATEST_RELEASE_URL, UpdateChecker } from '../src/update/update.checker.js';
import { resolveUpdateSettings, type UpdateSettings } from '../src/update/update.settings.js';

const silent = () => new RhapsodeJsonLogger('error', () => {});
const on: UpdateSettings = { check: true, distribution: 'docker' };

/** A clock the test moves by hand. */
function clock(start = DateTime.fromISO('2026-09-21T09:00:00Z', { zone: 'utc' })) {
    let now = start;
    return { now: () => now, advance: (hours: number) => (now = now.plus({ hours })) };
}

/** A fetch that answers from `answers` in order and records what it was asked. */
function github(...answers: Array<{ status: number; body?: unknown } | Error>) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!;
        if (answer instanceof Error) throw answer;
        return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
    }) as typeof fetch;
    return { fetcher, calls };
}

const release = (tag: string) => ({
    status: 200,
    body: { tag_name: tag, html_url: `https://github.com/maroonedsoftware/rhapsode/releases/tag/${tag}` },
});

describe('the update checker', () => {
    it('answers pending at once, then what GitHub said', async () => {
        const { fetcher } = github(release('v0.2.0'));
        const time = clock();
        const checker = new UpdateChecker(on, silent(), fetcher, time.now, '0.1.9');

        expect(checker.status()).toEqual({ version: '0.1.9', distribution: 'docker', check: 'pending' });
        await checker.refreshIfDue();

        expect(checker.status()).toEqual({
            version: '0.1.9',
            distribution: 'docker',
            check: 'ok',
            latest: '0.2.0',
            updateAvailable: true,
            releaseUrl: 'https://github.com/maroonedsoftware/rhapsode/releases/tag/v0.2.0',
            checkedAt: '2026-09-21T09:00:00.000Z',
        });
    });

    it('says there is nothing newer when the core is on the latest release', async () => {
        const checker = new UpdateChecker(on, silent(), github(release('v0.1.9')).fetcher, clock().now, '0.1.9');
        checker.status();
        await checker.refreshIfDue();

        expect(checker.status()).toMatchObject({ check: 'ok', latest: '0.1.9', updateAvailable: false });
    });

    it('asks once a day however often it is asked', async () => {
        const { fetcher, calls } = github(release('v0.2.0'));
        const time = clock();
        const checker = new UpdateChecker(on, silent(), fetcher, time.now, '0.1.9');

        checker.status();
        await checker.refreshIfDue();
        time.advance(23);
        for (let i = 0; i < 10; i += 1) checker.status();
        expect(calls).toHaveLength(1);

        time.advance(2);
        checker.status();
        await checker.refreshIfDue();
        expect(calls).toHaveLength(2);
    });

    it('asks once while a check is in flight, however many requests arrive', async () => {
        const { fetcher, calls } = github(release('v0.2.0'));
        const checker = new UpdateChecker(on, silent(), fetcher, clock().now, '0.1.9');

        const pending = [checker.status(), checker.status(), checker.status()];
        await checker.refreshIfDue();

        expect(pending.every(status => status.check === 'pending')).toBe(true);
        expect(calls).toHaveLength(1);
    });

    it('fails quietly, and tries again after six hours rather than a day', async () => {
        const { fetcher, calls } = github(new Error('getaddrinfo ENOTFOUND api.github.com'), release('v0.2.0'));
        const time = clock();
        const checker = new UpdateChecker(on, silent(), fetcher, time.now, '0.1.9');

        checker.status();
        await checker.refreshIfDue();
        expect(checker.status()).toEqual({ version: '0.1.9', distribution: 'docker', check: 'failed' });

        time.advance(5);
        expect(checker.refreshIfDue()).toBeUndefined();
        time.advance(2);
        await checker.refreshIfDue();

        expect(calls).toHaveLength(2);
        expect(checker.status()).toMatchObject({ check: 'ok', latest: '0.2.0' });
    });

    it('treats a refusal from GitHub as a failure, such as a rate limit behind a shared address', async () => {
        const checker = new UpdateChecker(
            on,
            silent(),
            github({ status: 403, body: { message: 'API rate limit exceeded' } }).fetcher,
            clock().now,
            '0.1.9',
        );
        checker.status();
        await checker.refreshIfDue();

        expect(checker.status().check).toBe('failed');
    });

    it('treats a release with no tag as a failure rather than inventing one', async () => {
        const checker = new UpdateChecker(on, silent(), github({ status: 200, body: {} }).fetcher, clock().now, '0.1.9');
        checker.status();
        await checker.refreshIfDue();

        expect(checker.status().check).toBe('failed');
    });

    it('never asks when turned off', async () => {
        const { fetcher, calls } = github(release('v0.2.0'));
        const checker = new UpdateChecker({ check: false, distribution: 'source' }, silent(), fetcher, clock().now, '0.1.9');

        expect(checker.status()).toEqual({ version: '0.1.9', distribution: 'source', check: 'off' });
        expect(checker.refreshIfDue()).toBeUndefined();
        expect(calls).toHaveLength(0);
    });

    it('asks for GitHub’s latest release naming itself and nothing about the box', async () => {
        const { fetcher, calls } = github(release('v0.2.0'));
        const checker = new UpdateChecker(on, silent(), fetcher, clock().now, '0.1.9');
        checker.status();
        await checker.refreshIfDue();

        expect(calls[0]?.url).toBe(LATEST_RELEASE_URL);
        const headers = calls[0]?.init?.headers as Record<string, string>;
        expect(headers['user-agent']).toBe('rhapsode/0.1.9');
        expect(Object.keys(headers).sort()).toEqual(['accept', 'user-agent', 'x-github-api-version']);
    });
});

describe('checking now', () => {
    it('asks at once and answers with what GitHub said, which is what the button is for', async () => {
        // The case that asked for it: 0.1.10 was out, and the answer held from before said 0.1.9 until
        // the next morning.
        const { fetcher, calls } = github(release('v0.1.9'), release('v0.1.10'));
        const time = clock();
        const checker = new UpdateChecker(on, silent(), fetcher, time.now, '0.1.9');
        checker.status();
        await checker.refreshIfDue();
        time.advance(1);

        expect(await checker.checkNow()).toMatchObject({ check: 'ok', latest: '0.1.10', updateAvailable: true });
        expect(calls).toHaveLength(2);
    });

    it('asks from nothing, without a read before it', async () => {
        const checker = new UpdateChecker(on, silent(), github(release('v0.2.0')).fetcher, clock().now, '0.1.9');

        expect(await checker.checkNow()).toMatchObject({ check: 'ok', latest: '0.2.0' });
    });

    it('returns an answer under five minutes old as it is, however often it is pressed', async () => {
        const { fetcher, calls } = github(release('v0.2.0'));
        const time = { now: DateTime.fromISO('2026-09-21T09:00:00Z', { zone: 'utc' }) };
        const checker = new UpdateChecker(on, silent(), fetcher, () => time.now, '0.1.9');

        await checker.checkNow();
        time.now = time.now.plus({ minutes: 4 });
        for (let i = 0; i < 10; i += 1) await checker.checkNow();
        expect(calls).toHaveLength(1);

        time.now = time.now.plus({ minutes: 2 });
        await checker.checkNow();
        expect(calls).toHaveLength(2);
    });

    it('waits on the check in flight rather than starting a second', async () => {
        const { fetcher, calls } = github(release('v0.2.0'));
        const checker = new UpdateChecker(on, silent(), fetcher, clock().now, '0.1.9');

        checker.status();
        const answers = await Promise.all([checker.checkNow(), checker.checkNow()]);

        expect(calls).toHaveLength(1);
        expect(answers.every(answer => answer.check === 'ok')).toBe(true);
    });

    it('answers a failure as failed, not by throwing', async () => {
        const checker = new UpdateChecker(on, silent(), github(new Error('getaddrinfo ENOTFOUND api.github.com')).fetcher, clock().now, '0.1.9');

        expect(await checker.checkNow()).toMatchObject({ check: 'failed' });
    });

    it('asks nothing when the check is off, because a button does not overrule the operator', async () => {
        const { fetcher, calls } = github(release('v0.2.0'));
        const checker = new UpdateChecker({ check: false, distribution: 'docker' }, silent(), fetcher, clock().now, '0.1.9');

        expect(await checker.checkNow()).toEqual({ version: '0.1.9', distribution: 'docker', check: 'off' });
        expect(calls).toHaveLength(0);
    });
});

describe('update settings', () => {
    it('checks by default, and the config can turn it off', () => {
        expect(resolveUpdateSettings({}, {}).check).toBe(true);
        expect(resolveUpdateSettings({ update: { check: false } }, {}).check).toBe(false);
    });

    it('lets the environment turn it off but not back on', () => {
        expect(resolveUpdateSettings({}, { RHAPSODE_UPDATE_CHECK: '0' }).check).toBe(false);
        expect(resolveUpdateSettings({}, { RHAPSODE_UPDATE_CHECK: 'Off' }).check).toBe(false);
        expect(resolveUpdateSettings({ update: { check: false } }, { RHAPSODE_UPDATE_CHECK: '1' }).check).toBe(false);
    });

    it('says docker only where the image said so', () => {
        expect(resolveUpdateSettings({}, { RHAPSODE_DISTRIBUTION: 'docker' }).distribution).toBe('docker');
        expect(resolveUpdateSettings({}, {}).distribution).toBe('source');
    });
});
