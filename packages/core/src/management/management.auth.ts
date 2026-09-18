import { timingSafeEqual } from 'node:crypto';

import { type AuthenticationHandler, type AuthenticationSession, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { DateTime } from 'luxon';

/** Who a caller that presented the management token is. There is exactly one such somebody. */
export const MANAGEMENT_SUBJECT = 'management';

/**
 * The `bearer` scheme for management routes: one shared token from `management.token`.
 *
 * Registered only when a token is configured. Without one there is no scheme to authenticate with,
 * every session stays invalid, and the access policy admits loopback callers and nobody else.
 */
export class ManagementTokenHandler implements AuthenticationHandler {
    constructor(private readonly token: string) {}

    async authenticate(_scheme: string, value: string): Promise<AuthenticationSession> {
        if (!sameToken(value, this.token)) return invalidAuthenticationSession;

        const now = DateTime.utc();
        return {
            sessionToken: '',
            subject: MANAGEMENT_SUBJECT,
            issuedAt: now,
            lastAccessedAt: now,
            // A token is checked on every request rather than exchanged for a session, so this
            // session lives exactly as long as the request that carried it.
            expiresAt: now,
            factors: [],
            claims: {},
        };
    }
}

/**
 * Compare in constant time, so a caller cannot learn the token a byte at a time from how long a
 * refusal takes. The same six lines as ServerKit's `compareMcpToken`, which is not exported from a
 * package this core depends on.
 */
export function sameToken(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}
