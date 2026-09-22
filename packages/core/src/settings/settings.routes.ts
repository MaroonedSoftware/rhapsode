import type { FastifyPluginAsync } from 'fastify';

import { SettingsPatch } from '@rhapsode/contract';

import { RhapsodeError } from '../errors/rhapsode.error.js';
import { isLocalCaller } from '../management/management.access.policy.js';
import { managementGuard } from '../management/management.module.js';
import { SettingsService } from './settings.service.js';

/**
 * `GET` and `PATCH /settings`. protocol.md § 10, "Settings".
 *
 * Behind the guard although the first only reads, unlike `/catalog`: it names directories on the box,
 * the origins it trusts and whether it has a token, which is a map for somebody deciding where to push.
 */
export const settingsRoutes: FastifyPluginAsync = async app => {
    app.get('/settings', { onRequest: managementGuard }, async request => request.container.get(SettingsService).document());

    app.patch('/settings', { onRequest: managementGuard, config: { body: ['application/json'] } }, async request => {
        const parsed = SettingsPatch.safeParse(request.body ?? {});
        if (!parsed.success) {
            // Named by setting, because the page shows a refusal as it stands and a person reads it.
            const reasons = parsed.error.issues.map(issue => `${issue.path.join('.') || 'the body'}: ${issue.message}`);
            throw new RhapsodeError('bad_request', `the body is not a settings patch. ${reasons.join('; ')}`);
        }
        const forwardedFor = request.headers['x-forwarded-for'];
        const settings = request.container.get(SettingsService);
        await settings.apply(parsed.data, {
            local: isLocalCaller(request.ip, Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor),
            ...(request.headers.origin === undefined ? {} : { origin: request.headers.origin }),
        });
        return settings.document();
    });
};
