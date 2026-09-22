import type { FastifyPluginAsync } from 'fastify';

import { managementGuard } from '../management/management.module.js';
import { SettingsService } from './settings.service.js';

/**
 * `GET /settings`. protocol.md § 10, "Settings".
 *
 * Behind the guard although it only reads, unlike `/catalog`: it names directories on the box, the
 * origins it trusts and whether it has a token, which is a map for somebody deciding where to push.
 */
export const settingsRoutes: FastifyPluginAsync = async app => {
    app.get('/settings', { onRequest: managementGuard }, async request => request.container.get(SettingsService).document());
};
